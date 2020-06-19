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

const executeCommandsInQueue = async (command, argsArray, numWorkers, options,
  onSpawn) => {
  const worker = async () => {
    let args
    while ((args = argsArray.pop()) !== undefined) {
      const process = spawn(command, args, options)
      const exitPromise = exit(process)
      if (onSpawn) {
        await onSpawn(process, args)
      }
      await exitPromise
    }
  }
  const workers = []
  while (workers.length < numWorkers) {
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
  const stderrClose = close(process.stderr)
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
  await stderrClose
  await fsPromises.writeFile(`${basename}-blackdetect.json`,
    JSON.stringify(blackFrameData))
}

const processReplayConfigs = async (files, config) => {
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
          '-b', '-e', config.ssbmIsoPath
        ])
        ffmpegMergeArgsArray.push([
          '-i', `${basename}.avi`,
          '-i', `${basename}.wav`,
          '-b:v', `${config.bitrateKbps}k`,
          '-vf', `scale=${config.widescreenOff ? '1280:1056' : '1920:1080'}`,
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
            '-b:v', `${config.bitrateKbps}k`,
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
  await executeCommandsInQueue(config.dolphinPath, dolphinArgsArray,
    config.numProcesses,
    {}, killDolphinOnEndFrame)

  // Merge video and audio files
  await executeCommandsInQueue('ffmpeg', ffmpegMergeArgsArray,
    config.numProcesses,
    { stdio: 'ignore' })

  // Delete unmerged video and audio files to save space
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    promises.push(fsPromises.unlink(`${basename}.avi`))
    promises.push(fsPromises.unlink(`${basename}.wav`))
  })
  await Promise.all(promises)

  // Find black frames
  await executeCommandsInQueue('ffmpeg', ffmpegBlackDetectArgsArray,
    config.numProcesses, {}, saveBlackFrames)

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
          '-b:v', `${config.bitrateKbps}k`,
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
  await executeCommandsInQueue('ffmpeg', ffmpegTrimArgsArray,
    config.numProcesses, { stdio: 'ignore' })

  // Delete untrimmed video files to save space
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, '.json'))
    promises.push(fsPromises.unlink(`${basename}-merged.avi`))
  })
  await Promise.all(promises)

  // Add overlay
  await executeCommandsInQueue('ffmpeg', ffmpegOverlayArgsArray,
    config.numProcesses, { stdio: 'ignore' })

  // Delete non-overlaid video files
  promises = []
  replaysWithOverlays.forEach((basename) => {
    promises.push(fsPromises.unlink(`${basename}-trimmed.avi`))
  })
  await Promise.all(promises)
}

const getMinimumDuration = async (videoFile) => {
  const audioArgs = ['-select_streams', 'a:0', '-show_entries',
    'stream=duration', videoFile]
  const videoArgs = ['-select_streams', 'v:0', '-show_entries',
    'stream=duration', videoFile]
  const audioProcess = spawn('ffprobe', audioArgs)
  const audioClose = close(audioProcess.stdout)
  const videoProcess = spawn('ffprobe', videoArgs)
  const videoClose = close(videoProcess.stdout)
  audioProcess.stdout.setEncoding('utf8')
  videoProcess.stdout.setEncoding('utf8')
  const regex = /duration=([0-9]*\.[0-9]*)/
  let audioDuration
  let videoDuration
  audioProcess.stdout.on('data', (data) => {
    const match = regex.exec(data)
    audioDuration = match[1]
  })
  videoProcess.stdout.on('data', (data) => {
    const match = regex.exec(data)
    videoDuration = match[1]
  })
  await audioClose
  await videoClose
  return Math.min(audioDuration, videoDuration)
}

const concatenateVideos = async (dir) => {
  await fsPromises.readdir(dir)
    .then(async (files) => {
      // Get sorted list of video files to concatenate
      let replayVideos = files.filter((file) => file.endsWith('trimmed.avi'))
      replayVideos = replayVideos.concat(
        files.filter((file) => file.endsWith('overlaid.avi')))
      if (!replayVideos.length) return
      const regex = /([0-9]*).*/
      replayVideos.sort((file1, file2) => {
        const index1 = regex.exec(file1)[1]
        const index2 = regex.exec(file2)[1]
        return index1 - index2
      })
      // Compute correct video durations (minimum of audio and video streams)
      const durations = {}
      const promises = []
      replayVideos.forEach((file) => {
        const promise = getMinimumDuration(path.join(dir, file))
          .then((duration) => { durations[file] = duration })
        promises.push(promise)
      })
      await Promise.all(promises)
      // Generate ffmpeg input file
      const concatFn = path.join(dir, 'concat.txt')
      const stream = fs.createWriteStream(concatFn)
      replayVideos.forEach((file) => {
        stream.write(`file '${path.join(dir, file)}'\n`)
        stream.write('inpoint 0.0\n')
        stream.write(`outpoint ${durations[file]}\n`)
      })
      stream.end()
      // Concatenate
      await fsPromises.readFile(path.join(dir, 'outputPath.txt'),
        { encoding: 'utf8' })
        .then(async (outputPath) => {
          const args = ['-y',
            '-f', 'concat', '-safe', '0',
            '-i', concatFn,
            '-c', 'copy',
            outputPath]
          const process = spawn('ffmpeg', args, { stdio: 'ignore' })
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

const configureDolphin = async (config) => {
  const dolphinDirname = path.dirname(config.dolphinPath)
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
  const gameMusicSetting = config.gameMusicOn ? 'ON' : 'OFF'
  newSettings.push(`$Game Music ${gameMusicSetting}`)
  if (config.hideHud) newSettings.push('$Hide HUD')
  if (!config.widescreenOff) newSettings.push('$Widescreen 16:9')
  await fsPromises.writeFile(gameSettingsFilename, newSettings.join('\n'))

  // Graphics settings
  rl = readline.createInterface({
    input: fs.createReadStream(graphicsSettingsFilename),
    crlfDelay: Infinity
  })
  newSettings = []
  const aspectRatioSetting = config.widescreenOff ? 5 : 6
  for await (const line of rl) {
    if (line.startsWith('AspectRatio')) {
      newSettings.push(`AspectRatio = ${aspectRatioSetting}`)
    } else if (line.startsWith('BitrateKbps')) {
      newSettings.push(`BitrateKbps = ${config.bitrateKbps}`)
    } else {
      newSettings.push(line)
    }
  }
  await fsPromises.writeFile(graphicsSettingsFilename,
    newSettings.join('\n'))
}

const slpToVideo = async (replayLists, config) => {
  await configureDolphin(config)
  process.on('exit', (code) => fs.rmdirSync(config.tmpdir, { recursive: true }))
  fsPromises.mkdir(config.tmpdir)
    .then(async () => {
      const promises = []
      replayLists.forEach(
        (replays) => promises.push(
          generateReplayConfigs(replays, config.tmpdir))
      )
      await Promise.all(promises)
    })
    .then(() => files(config.tmpdir))
    .then(async (files) => {
      files = files.filter((file) => path.extname(file) === '.json')
      await processReplayConfigs(files, config)
    })
    .then(() => subdirs(config.tmpdir))
    .then(async (subdirs) => {
      const promises = []
      subdirs.forEach((dir) => promises.push(concatenateVideos(dir)))
      await Promise.all(promises)
    })
}

const main = () => {
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
        yargs.option('bitrate-kbps', {
          describe: 'Bitrate in kbps.',
          default: 15000,
          type: 'number'
        })
        yargs.option('tmpdir', {
          describe:
            'Temporary directory to use (temporary files may be large).',
          default: path.join(os.tmpdir(),
                             `tmp-${crypto.randomBytes(12).toString('hex')}`),
          type: 'string'
        })
      }).argv
  const config = {
    numProcesses: argv.numCpus,
    dolphinPath: path.resolve(argv.dolphinPath),
    ssbmIsoPath: path.resolve(argv.ssbmIsoPath),
    tmpdir: path.resolve(argv.tmpdir),
    gameMusicOn: argv.gameMusicOn,
    hideHud: argv.hideHud,
    widescreenOff: argv.widescreenOff,
    bitrateKbps: argv.bitrateKbps
  }
  fsPromises.readFile(path.resolve(argv.INPUT_FILE))
    .then((contents) => JSON.parse(contents))
    .then((replayLists) => slpToVideo(replayLists, config))
}

if (module === require.main) {
  main()
}
