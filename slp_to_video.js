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
const readline = require('readline')
const dir = require('node-dir')
const { default: SlippiGame } = require('slp-parser-js')
const argv = require('yargs')
  .command(
    '$0 INPUT_FILE',
    'Convert .slp files to video in AVI format.',
    (yargs) => {
      yargs.positional('INPUT_FILE', {
        describe: ('Describes the input .slp files and output filenames. ' +
                   'See example_input.json for an example.'),
        type: 'string'
      })
      yargs.option('num-cpus', {
        describe: 'The number of processes to use.',
        default: 1,
        type: 'number'
      })
      yargs.option('dolphin-path', {
        describe: 'Path to the Dolphin executable.',
        default: path.join('Ishiiruka', 'build', 'Binaries', 'dolphin-emu'),
        type: 'string'
      })
      yargs.option('ssbm-iso-path', {
        describe: 'Path to the SSBM ISO image.',
        default: 'SSBM.iso',
        type: 'string'
      })
      yargs.option('game-music-on', {
        describe: 'Turn game music on.',
        type: 'boolean'
      })
      yargs.option('hide-hud', {
        describe: 'Hide percentage and stock icons.',
        type: 'boolean'
      })
      yargs.option('widescreen-off', {
        describe: 'Turn off widescreen.',
        type: 'boolean'
      })
      yargs.option('tmpdir', {
        describe: 'Temporary directory to use (temporary files may be large).',
        default: path.join(os.tmpdir(),
                           `tmp-${crypto.randomBytes(12).toString('hex')}`),
        type: 'string'
      })
    }).argv

let INPUT_FILE = path.resolve(argv.INPUT_FILE)
let NUM_PROCESSES = argv.numCpus
let DOLPHIN_PATH = path.resolve(argv.dolphinPath)
let SSBM_ISO_PATH = path.resolve(argv.ssbmIsoPath)
let TMPDIR = path.resolve(argv.tmpdir)
let GAME_MUSIC_ON = argv.gameMusicOn
let HIDE_HUD = argv.hideHud
let WIDESCREEN_OFF = argv.widescreenOff
let EVENT_TRACKER = { emit: argv.verbose ? (tag,msg)=>{
  if( tag === 'primaryEventMsg') console.log(msg)
  if( tag === 'count' ) process.stdout.write(`${COUNT}/${TOTAL_REPLAYS}`)
} : () => {}}
let TOTAL_REPLAYS = 0
let COUNT = 0

const generateReplayConfigs = async (replays, basedir) => {
  const dirname = path.join(basedir,
                            `tmp-${crypto.randomBytes(12).toString('hex')}`)
  await fsPromises.mkdir(dirname)
  await fsPromises.writeFile(path.join(dirname, 'outputPath.txt'),
    replays.outputPath)
  await fsPromises.mkdir(dirname, { recursive: true })
  for (const [index, replay] of replays.replays.entries()) {
    generateReplayConfig(replay, index, dirname)
  }
}

const generateReplayConfig = async (replay, index, basedir) => {
  const game = new SlippiGame(replay.replay)
  const metadata = game.getMetadata()
  const config = {
    mode: 'normal',
    replay: replay.replay,
    startFrame: replay.startFrame != null ? replay.startFrame : -123,
    endFrame: replay.endFrame != null ? replay.endFrame : metadata.lastFrame,
    isRealTimeMode: false,
    commandId: `${crypto.randomBytes(12).toString('hex')}`,
    overlayPath: replay.overlayPath
  }
  const configFn = path.join(basedir, `${index}.json`)
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
  const ffmpegTrimArgsArray = []
  const ffmpegOverlayArgsArray = []
  const replaysWithOverlays = []
  let promises = []

  // Construct arguments to commands
  files.forEach((file) => {
    const promise = fsPromises.readFile(file)
      .then((contents) => {
        const overlayPath = JSON.parse(contents).overlayPath
        const basename = path.join(path.dirname(file),
          path.basename(file, '.json'))
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
          '-max_muxing_queue_size', '9999',
          '-f', 'null', '-'
        ])
        if (overlayPath) {
          ffmpegOverlayArgsArray.push([
            '-i', `${basename}-trimmed.avi`,
            '-i', overlayPath,
            '-b:v', '15M',
            '-filter_complex',
            '[0:v][1:v] overlay',
            `${basename}-overlaid.avi`
          ])
          replaysWithOverlays.push(basename)
        }
      })
    promises.push(promise)
  })
  await Promise.all(promises)

  // Dump frames to video and audio
  EVENT_TRACKER.emit('primaryEventMsg','Generating videos...')
  COUNT = 0;
  await executeCommandsInQueue(DOLPHIN_PATH, dolphinArgsArray, NUM_PROCESSES,
    killDolphinOnEndFrame)

  // Merge video and audio files
  EVENT_TRACKER.emit('primaryEventMsg','Merging video and audio...')
  COUNT = 0;
  await executeCommandsInQueue('ffmpeg', ffmpegMergeArgsArray, NUM_PROCESSES)

  // Delete unmerged video and audio files to save space
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    promises.push(fsPromises.unlink(`${basename}.avi`))
    promises.push(fsPromises.unlink(`${basename}.wav`))
  })
  await Promise.all(promises)

  // Find black frames
  EVENT_TRACKER.emit('primaryEventMsg','Detecting black frames...')
  COUNT = 0;
  await executeCommandsInQueue('ffmpeg', ffmpegBlackDetectArgsArray,
    NUM_PROCESSES, saveBlackFrames)

  // Trim black frames
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    const promise = fsPromises.readFile(`${basename}-merged-blackdetect.json`,
      { encoding: 'utf8' })
      .then((contents) => {
        const blackFrames = JSON.parse(contents)
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

  // Delete untrimmed video files to save space
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    promises.push(fsPromises.unlink(`${basename}-merged.avi`))
  })
  await Promise.all(promises)

  // Add overlay
  EVENT_TRACKER.emit('primaryEventMsg','Adding Overlays...')
  COUNT = 0;
  await executeCommandsInQueue('ffmpeg', ffmpegOverlayArgsArray, NUM_PROCESSES)

  // Delete non-overlaid video files
  promises = []
  replaysWithOverlays.forEach((basename) => {
    promises.push(fsPromises.unlink(`${basename}-trimmed.avi`))
  })
  await Promise.all(promises)
}

const concatenateVideos = async (dir) => {
  await fsPromises.readdir(dir)
    .then(async (files) => {
      let replayVideos = files.filter((file) => file.endsWith('trimmed.avi'))
      replayVideos = replayVideos.concat(
        files.filter((file) => file.endsWith('overlaid.avi')))
      if (!replayVideos.length) return
      replayVideos.sort()
      const concatFn = path.join(dir, 'concat.txt')
      const stream = fs.createWriteStream(concatFn)
      replayVideos.forEach((file) => {
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

const configureDolphin = async () => {
  const dolphinDirname = path.dirname(DOLPHIN_PATH)
  const gameSettingsFilename = path.join(dolphinDirname, 'User', 'GameSettings',
    'GALE01.ini')
  const graphicsSettingsFilename = path.join(dolphinDirname, 'User', 'Config',
    'GFX.ini')

  // Game settings
  let rl = readline.createInterface({
    input: fs.createReadStream(gameSettingsFilename),
    crlfDelay: Infinity
  })
  let newSettings = []
  for await (const line of rl) {
    if (!(line.startsWith('$Game Music') ||
          line.startsWith('$Hide HUD') ||
          line.startsWith('$Widescreen'))) {
      newSettings.push(line)
    }
  }
  const gameMusicSetting = GAME_MUSIC_ON ? 'ON' : 'OFF'
  newSettings.push(`$Game Music ${gameMusicSetting}`)
  if (HIDE_HUD) newSettings.push('$Hide HUD')
  if (!WIDESCREEN_OFF) newSettings.push('$Widescreen 16:9')
  await fsPromises.writeFile(gameSettingsFilename, newSettings.join('\n'))

  // Graphics settings
  rl = readline.createInterface({
    input: fs.createReadStream(graphicsSettingsFilename),
    crlfDelay: Infinity
  })
  newSettings = []
  const aspectRatioSetting = WIDESCREEN_OFF ? 5 : 6
  for await (const line of rl) {
    if (line.startsWith('AspectRatio')) {
      newSettings.push(`AspectRatio = ${aspectRatioSetting}`)
    } else {
      newSettings.push(line)
    }
  }
  await fsPromises.writeFile(graphicsSettingsFilename,
    newSettings.join('\n'))
}

const main = async (config) => {
  if(config){
    INPUT_FILE = config.INPUT_FILE
    DOLPHIN_PATH = config.DOLPHIN_PATH
    SSBM_ISO_PATH = config.SSBM_ISO_PATH
    NUM_PROCESSES = config.NUM_PROCESSES
    EVENT_TRACKER = config.EVENT_TRACKER
    TMPDIR = config.TMPDIR ? config.TMPDIR : TMPDIR
    GAME_MUSIC_ON = config.GAME_MUSIC_ON
    HIDE_HUD = config.HID_HUD
    WIDESCREEN_OFF = config.WIDESCREEN_OFF
  }
  await configureDolphin()
  process.on('exit', (code) => fs.rmdirSync(TMPDIR, { recursive: true }))
  fsPromises.mkdir(TMPDIR)
    .then(() => fsPromises.readFile(INPUT_FILE))
    .then(async (contents) => {
      const promises = []
      JSON.parse(contents).forEach(
        (replays) => {
          TOTAL_REPLAYS += replays.length
          promises.push(generateReplayConfigs(replays, TMPDIR))
        }
      )
      EVENT_TRACKER.emit('primaryEventMsg','Generating replay configs...')
      await Promise.all(promises)
    })
    .then(() => files(TMPDIR))
    .then(async (files) => {
      files = files.filter((file) => path.extname(file) === '.json')
      EVENT_TRACKER.emit('primaryEventMsg','Processing replay configs...')
      await processReplayConfigs(files)
    })
    .then(() => subdirs(TMPDIR))
    .then(async (subdirs) => {
      const promises = []
      subdirs.forEach((dir) => promises.push(concatenateVideos(dir)))
      EVENT_TRACKER.emit('primaryEventMsg','Concatenating videos...')
      await Promise.all(promises)
    })
}

if (module === require.main) {
  main()
}

module.exports = main