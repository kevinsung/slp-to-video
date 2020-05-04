// Copyright (c) 2020 Kevin J. Sung
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const fsPromises = require('fs').promises
const os = require('os')
const path = require('path')
const dir = require('node-dir')
const { default: SlippiGame } = require('slp-parser-js')
const argv = require('yargs').argv

let INPUT_FILE = argv.input ? path.resolve(argv.input) : null
let DOLPHIN_PATH = argv.dolphin_path ? path.resolve(argv.dolphin_path) : null
let SSBM_ISO_PATH = argv.ssbm_iso_path ? path.resolve(argv.ssbm_iso_path) : null
let NUM_PROCESSES = argv.num_cpus ? argv.num_cpus : null
let EVENT_TRACKER = {emit:()=>{}}
let COUNT = 0

const generateReplayConfigs = async (replays, basedir) => {
  const dirname = path.join(basedir,
                            `tmp-${crypto.randomBytes(12).toString('hex')}`)
  await fsPromises.mkdir(dirname)
  await fsPromises.writeFile(path.join(dirname, 'outputPath.txt'),
    replays.outputPath)
  await fsPromises.mkdir(dirname, { recursive: true })
  replays.replays.forEach(
    (replay) => generateReplayConfig(replay, dirname)
  )
}

const generateReplayConfig = async (replay, basedir) => {
  const game = new SlippiGame(replay.replay)
  const metadata = game.getMetadata()
  const config = {
    mode: 'normal',
    replay: replay.replay,
    startFrame: replay.startFrame != null ? replay.startFrame : -123,
    endFrame: replay.endFrame != null ? replay.endFrame : metadata.lastFrame,
    isRealTimeMode: false,
    commandId: `${crypto.randomBytes(12).toString('hex')}`
  }
  const configFn = path.join(basedir,
                             `${metadata.startAt.replace(/:/g, '')}.json`)
  await fsPromises.writeFile(configFn, JSON.stringify(config))
}

const exit = (process) => new Promise((resolve, reject) => {
  process.on('exit', (code, signal) => {
    resolve(code, signal)
  })
})

const close = (stream) => new Promise((resolve, reject) => {
  stream.on('close', (code, signal) => {
    resolve(code, signal)
  })
})

const executeCommandsInQueue = async (command, argsArray, numWorkers,
  onSpawn) => {
  const worker = async () => {
    let args
    while ((args = argsArray.pop()) !== undefined) {
      const process = spawn(command, args)
      const exitPromise = exit(process)
      if (onSpawn) {
        await onSpawn(process, args)
      }
      await exitPromise
      EVENT_TRACKER.emit('count',COUNT++)
    }
  }
  const workers = []
  while (workers.length < NUM_PROCESSES) {
    workers.push(worker())
  }
  while (workers.length > 0) {
    await workers.pop()
  }
}

const killDolphinOnEndFrame = (process) => {
  process.stdout.setEncoding('utf8')
  process.stdout.on('data', (data) => {
    const lines = data.split('\r\n')
    lines.forEach((line) => {
      if (line.includes('[END_FRAME]')) {
        setTimeout(() => process.kill(), 5000)
      }
    })
  })
}

const saveBlackFrames = async (process, args) => {
  const basename = path.join(path.dirname(args[1]),
    path.basename(args[1], '.avi'))
  const blackFrameData = []
  process.stderr.setEncoding('utf8')
  process.stderr.on('data', (data) => {
    const regex = /black_start:(.+) black_end:(.+) /g
    let match
    while ((match = regex.exec(data)) != null) {
      blackFrameData.push({ blackStart: match[1], blackEnd: match[2] })
    }
  })
  await close(process.stderr)
  await fsPromises.writeFile(`${basename}-blackdetect.json`,
    JSON.stringify(blackFrameData))
}

const processReplayConfigs = async (files) => {
  const dolphinArgsArray = []
  const ffmpegMergeArgsArray = []
  const ffmpegBlackDetectArgsArray = []

  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    dolphinArgsArray.push([
      '-i', file,
      '-o', basename,
      '-b', '-e', SSBM_ISO_PATH
    ])
    ffmpegMergeArgsArray.push([
      '-i', `${basename}.avi`,
      '-i', `${basename}.wav`,
      '-b:v', '15M',
      `${basename}-merged.avi`
    ])
    ffmpegBlackDetectArgsArray.push([
      '-i', `${basename}-merged.avi`,
      '-vf', 'blackdetect=d=0.01:pix_th=0.01',
      '-max_muxing_queue_size', '1024',
      '-f', 'null', '-'
    ])
  })

  // Dump frames to video and audio
  EVENT_TRACKER.emit('primaryEventMsg','Generating videos...')
  COUNT = 0;
  await executeCommandsInQueue(DOLPHIN_PATH, dolphinArgsArray, NUM_PROCESSES,
    killDolphinOnEndFrame)

  // Merge video and audio files
  EVENT_TRACKER.emit('primaryEventMsg','Merging video and audio...')
  COUNT = 0;
  await executeCommandsInQueue('ffmpeg', ffmpegMergeArgsArray, NUM_PROCESSES)

  // Delete files to save space
  // let promises = []
  // files.forEach((file) => {
  //   const basename = path.join(path.dirname(file), path.basename(file, '.json'))
  //   promises.push(fsPromises.unlink(`${basename}.avi`))
  //   promises.push(fsPromises.unlink(`${basename}.wav`))
  // })
  // await Promise.all(promises)

  // Find black frames
  EVENT_TRACKER.emit('primaryEventMsg','Detecting black frames...')
  COUNT = 0;
  await executeCommandsInQueue('ffmpeg', ffmpegBlackDetectArgsArray,
    NUM_PROCESSES, saveBlackFrames)

  // Trim black frames
  EVENT_TRACKER.emit('primaryEventMsg','Generating black frame trim arguments...')
  COUNT = 0;
  const ffmpegTrimArgsArray = []
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    const promise = fsPromises.readFile(`${basename}-merged-blackdetect.json`,
      { encoding: 'utf8' })
      .then((contents) => {
        const blackFrames = JSON.parse(contents)
        if(!blackFrames[0]){
          EVENT_TRACKER.emit('errorEventMsg',{msg:`No black frames found in ${file}`,file});
          return;
        }
        let trimParameters = `start=${blackFrames[0].blackEnd}`
        if (blackFrames.length > 1) {
          trimParameters = trimParameters.concat(
            `:end=${blackFrames[1].blackStart}`)
        }
        ffmpegTrimArgsArray.push([
          '-i', `${basename}-merged.avi`,
          '-b:v', '15M',
          '-filter_complex',
          `[0:v]trim=${trimParameters},setpts=PTS-STARTPTS[v1];` +
          `[0:a]atrim=${trimParameters},asetpts=PTS-STARTPTS[a1]`,
          '-map', '[v1]', '-map', '[a1]',
          `${basename}-trimmed.avi`
        ])
      })
    promises.push(promise)
  })
  await Promise.all(promises)
  EVENT_TRACKER.emit('primaryEventMsg','Trimming black frames...')
  COUNT = 0;
  await executeCommandsInQueue('ffmpeg', ffmpegTrimArgsArray, NUM_PROCESSES)
}

const concatenateVideos = async (dir) => {
  await fsPromises.readdir(dir)
    .then(async (files) => {
      files = files.filter((file) => file.endsWith('trimmed.avi'))
      if (!files.length) return
      files.sort()
      const concatFn = path.join(dir, 'concat.txt')
      const stream = fs.createWriteStream(concatFn)
      files.forEach((file) => {
        stream.write(`file '${path.join(dir, file)}'\n`)
      })
      stream.end()
      await fsPromises.readFile(path.join(dir, 'outputPath.txt'),
        { encoding: 'utf8' })
        .then(async (outputPath) => {
          const args = ['-y',
            '-f', 'concat', '-safe', '0',
            '-i', concatFn,
            '-c', 'copy',
            outputPath]
          const process = spawn('ffmpeg', args)
          await exit(process)
          EVENT_TRACKER.emit('count',COUNT++)
        })
    })
}

const files = (rootdir) => new Promise((resolve, reject) => {
  dir.files(rootdir, (err, files) => {
    if (err) reject(err)
    resolve(files)
  })
})

const subdirs = (rootdir) => new Promise((resolve, reject) => {
  dir.subdirs(rootdir, (err, subdirs) => {
    if (err) reject(err)
    resolve(subdirs)
  })
})

const main = (config) => {
  return new Promise((resolve,reject) => {
    try {
      if(config){
        INPUT_FILE = config.INPUT_FILE
        DOLPHIN_PATH = config.DOLPHIN_PATH
        SSBM_ISO_PATH = config.SSBM_ISO_PATH
        NUM_PROCESSES = config.NUM_PROCESSES
        EVENT_TRACKER = config.EVENT_TRACKER;
      }
      
      EVENT_TRACKER.emit('primaryEventMsg','Creating tmp directory...')
      const tmpdir = path.join(os.tmpdir(),
                              `tmp-${crypto.randomBytes(12).toString('hex')}`)
      
      fsPromises.mkdir(tmpdir)
        .then(() => {
          EVENT_TRACKER.emit('primaryEventMsg','Reading input file...')
          return fsPromises.readFile(INPUT_FILE)
        })
        .then(async (contents) => {
          const promises = []
          EVENT_TRACKER.emit('primaryEventMsg','Generating replay configs...')
          JSON.parse(contents).forEach(
            (replays) => promises.push(generateReplayConfigs(replays, tmpdir))
          )
          await Promise.all(promises)
        })
        .then(() => files(tmpdir))
        .then(async (files) => {
          files = files.filter((file) => path.extname(file) === '.json')
          EVENT_TRACKER.emit('primaryEventMsg','Processing replay configs...')
          await processReplayConfigs(files)
        })
        .then(() => subdirs(tmpdir))
        .then(async (subdirs) => {
          const promises = []
          subdirs.forEach((dir) => promises.push(concatenateVideos(dir)))
          EVENT_TRACKER.emit('primaryEventMsg','Concatenating videos...')
          COUNT = 0;
          await Promise.all(promises)
        })
        .then(() => {
          fsPromises.rmdir(tmpdir, { recursive: true })
          resolve();
        })
    } catch(err){
      reject(err);
    }
    
  })
}

if (module === require.main) {
  main()
}

module.exports = main