//   Copyright 2020 Kevin J. Sung
//
//   Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const fsPromises = require('fs').promises
const os = require('os')
const path = require('path')
const dir = require('node-dir')
const { default: SlippiGame } = require('slp-parser-js')
const argv = require('yargs').argv

const INPUT_FILE = path.resolve(argv.input)
const DOLPHIN_PATH = path.resolve(argv.dolphin_path)
const SSBM_ISO_PATH = path.resolve(argv.ssbm_iso_path)
const NUM_PROCESSES = argv.num_cpus

const generateReplayConfigs = async (replays, basedir) => {
  const dirname = path.join(basedir,
                            `tmp-${crypto.randomBytes(12).toString('hex')}`)
  await fsPromises.mkdir(dirname)
  await fsPromises.writeFile(path.join(dirname, 'outputPath.txt'),
    replays.outputPath)
  await fsPromises.mkdir(dirname, { recursive: true })
    .then(() => replays.replays.forEach(
      (replay) => generateReplayConfig(replay, dirname)
    ))
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
        setTimeout(() => process.kill(), 1000)
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
      '-f', 'null', '-'
    ])
  })

  // Dump frames to video and audio
  await executeCommandsInQueue(DOLPHIN_PATH, dolphinArgsArray, NUM_PROCESSES,
    killDolphinOnEndFrame)

  // Merge video and audio files
  await executeCommandsInQueue('ffmpeg', ffmpegMergeArgsArray, NUM_PROCESSES)

  // Delete files to save space
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    fs.unlinkSync(`${basename}.avi`)
    fs.unlinkSync(`${basename}.wav`)
  })

  // Find black frames
  await executeCommandsInQueue('ffmpeg', ffmpegBlackDetectArgsArray,
    NUM_PROCESSES, saveBlackFrames)

  // Trim black frames
  const ffmpegTrimArgsArray = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    const blackFrames = JSON.parse(
      fs.readFileSync(`${basename}-merged-blackdetect.json`, 'utf8'))
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
  await executeCommandsInQueue('ffmpeg', ffmpegTrimArgsArray, NUM_PROCESSES)
}

const concatenateVideos = (dir) => {
  fsPromises.readFile(path.join(dir, 'outputPath.txt'), { encoding: 'utf8' })
    .then((outputPath) => {
      console.log(outputPath)
      fs.readdir(dir, async (err, files) => {
        if (err) throw err
        files = files.filter((file) => file.endsWith('trimmed.avi'))
        if (!files.length) return
        files.sort()
        const concatFn = path.join(dir, 'concat.txt')
        const stream = fs.createWriteStream(concatFn)
        files.forEach((file) => {
          stream.write(`file '${path.join(dir, file)}'\n`)
        })
        stream.end()
        const args = ['-f', 'concat', '-safe', '0',
          '-i', concatFn,
          '-c', 'copy',
          outputPath]
        const process = spawn('ffmpeg', args)
        await exit(process)
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

const main = () => {
  const tmpdirname = path.join(os.tmpdir(),
                               `tmp-${crypto.randomBytes(12).toString('hex')}`)
  fsPromises.mkdir(tmpdirname)
    .then(() => fsPromises.readFile(INPUT_FILE))
    .then(async (contents) => {
      const promises = []
      JSON.parse(contents).forEach(
        (replays) => promises.push(generateReplayConfigs(replays, tmpdirname))
      )
      await Promise.all(promises)
    })
    .then(() => files(tmpdirname))
    .then(async (files) => {
      files = files.filter((file) => path.extname(file) === '.json')
      await processReplayConfigs(files)
    })
    .then(() => subdirs(tmpdirname))
    .then((subdirs) => {
      subdirs.forEach(concatenateVideos)
    })
}

if (module === require.main) {
  main()
}
