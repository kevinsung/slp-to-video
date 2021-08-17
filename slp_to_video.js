// Copyright (C) 2020 Kevin J. Sung
//
// This program is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation; either version 2 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License along
// with this program; if not, write to the Free Software Foundation, Inc.,
// 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.

const { spawn } = require("child_process")
const crypto = require("crypto")
const fs = require("fs")
const fsPromises = require("fs").promises
const os = require("os")
const path = require("path")
const readline = require("readline")
const dir = require("node-dir")
const { default: SlippiGame } = require("slp-parser-js")

const EFB_SCALE = {
  "1x": 2,
  "2x": 4,
  "3x": 6,
  "4x": 7,
  "5x": 8,
  "6x": 9,
}

const generateReplayConfigs = async (replays, basedir) => {
  const dirname = path.join(
    basedir,
    `tmp-${crypto.randomBytes(12).toString("hex")}`
  )
  await fsPromises.mkdir(dirname)
  await fsPromises.writeFile(
    path.join(dirname, "outputPath.txt"),
    replays.outputPath
  )
  await fsPromises.mkdir(dirname, { recursive: true })
  for (const [index, replay] of replays.queue.entries()) {
    generateReplayConfig(replay, index, dirname)
  }
}

const generateReplayConfig = async (replay, index, basedir) => {
  const game = new SlippiGame(replay.path)
  const metadata = game.getMetadata()
  const config = {
    mode: "normal",
    replay: replay.path,
    startFrame: replay.startFrame != null ? replay.startFrame : -123,
    endFrame: replay.endFrame != null ? replay.endFrame : metadata.lastFrame,
    isRealTimeMode: false,
    commandId: `${crypto.randomBytes(12).toString("hex")}`,
    overlayPath: replay.overlayPath,
  }
  const configFn = path.join(basedir, `${index}.json`)
  await fsPromises.writeFile(configFn, JSON.stringify(config))
}

const exit = (process) =>
  new Promise((resolve, reject) => {
    process.on("exit", (code, signal) => {
      resolve(code, signal)
    })
  })

const close = (stream) =>
  new Promise((resolve, reject) => {
    stream.on("close", (code, signal) => {
      resolve(code, signal)
    })
  })

const executeFunctionInQueue = async (func, argsArray, numWorkers) => {
  const numTasks = argsArray.length
  let count = 0
  if (process.stdout.isTTY) process.stdout.write(`${count}/${numTasks}`)
  const worker = async () => {
    let args
    while ((args = argsArray.pop()) !== undefined) {
      await func(args)
      count++
      if (process.stdout.isTTY) {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        process.stdout.write(`${count}/${numTasks}`)
      }
    }
  }
  const workers = []
  while (workers.length < numWorkers) {
    workers.push(worker())
  }
  while (workers.length > 0) {
    await workers.pop()
  }
  if (process.stdout.isTTY) process.stdout.write("\n")
}

const executeCommandsInQueue = async (
  command,
  argsArray,
  numWorkers,
  options,
  onSpawn
) => {
  const numTasks = argsArray.length
  let count = 0
  if (process.stdout.isTTY) process.stdout.write(`${count}/${numTasks}`)
  const worker = async () => {
    let args
    while ((args = argsArray.pop()) !== undefined) {
      const process_ = spawn(command, args, options)
      const exitPromise = exit(process_)
      if (onSpawn) {
        await onSpawn(process_, args)
      }
      await exitPromise
      count++
      if (process.stdout.isTTY) {
        process.stdout.clearLine()
        process.stdout.cursorTo(0)
        process.stdout.write(`${count}/${numTasks}`)
      }
    }
  }
  const workers = []
  while (workers.length < numWorkers) {
    workers.push(worker())
  }
  while (workers.length > 0) {
    await workers.pop()
  }
  if (process.stdout.isTTY) process.stdout.write("\n")
}

const killDolphinOnEndFrame = (process) => {
  let endFrame = Infinity
  process.stdout.setEncoding("utf8")
  process.stdout.on("data", (data) => {
    const lines = data.split("\r\n")
    lines.forEach((line) => {
      if (line.includes(`[PLAYBACK_END_FRAME]`)) {
        const regex = /\[PLAYBACK_END_FRAME\] ([0-9]*)/
        const match = regex.exec(line)
        endFrame = match[1]
      } else if (line.includes(`[CURRENT_FRAME] ${endFrame}`)) {
        process.kill()
      }
    })
  })
}

const processReplayConfigs = async (files, config) => {
  const dolphinArgsArray = []
  const ffmpegMergeArgsArray = []
  const ffmpegOverlayArgsArray = []
  const replaysWithOverlays = []
  let promises = []

  // Construct arguments to commands
  files.forEach((file) => {
    const promise = fsPromises.readFile(file).then((contents) => {
      const overlayPath = JSON.parse(contents).overlayPath
      const { dir, name } = path.parse(file)
      const basename = path.join(dir, name)
      // Arguments to Dolphin
      dolphinArgsArray.push([
        "-i",
        file,
        "-o",
        name,
        `--output-directory=${dir}`,
        "-b",
        "-e",
        config.ssbmIsoPath,
        "--cout",
      ])
      // Arguments for ffmpeg merging
      const ffmpegMergeArgs = [
        "-i",
        `${basename}.avi`,
        "-i",
        `${basename}.wav`,
        "-b:v",
        `${config.bitrateKbps}k`,
      ]
      if (config.resolution === "2x" && !config.widescreenOff) {
        // Slightly upscale to 1920x1080
        ffmpegMergeArgs.push("-vf")
        ffmpegMergeArgs.push("scale=1920:1080")
      }
      ffmpegMergeArgs.push(`${basename}-merged.avi`)
      ffmpegMergeArgsArray.push(ffmpegMergeArgs)
      // Arguments for adding overlays
      if (overlayPath) {
        ffmpegOverlayArgsArray.push([
          "-i",
          `${basename}-merged.avi`,
          "-i",
          overlayPath,
          "-b:v",
          `${config.bitrateKbps}k`,
          "-filter_complex",
          "[0:v][1:v] overlay",
          `${basename}-overlaid.avi`,
        ])
        replaysWithOverlays.push(basename)
      }
    })
    promises.push(promise)
  })
  await Promise.all(promises)

  // Dump frames to video and audio
  console.log("Dumping video frames and audio...")
  await executeCommandsInQueue(
    config.dolphinPath,
    dolphinArgsArray,
    config.numProcesses,
    {},
    killDolphinOnEndFrame
  )

  // Merge video and audio files
  console.log("Merging video and audio...")
  await executeCommandsInQueue(
    "ffmpeg",
    ffmpegMergeArgsArray,
    config.numProcesses,
    { stdio: "ignore" }
  )

  // Delete unmerged video and audio files to save space
  promises = []
  files.forEach((file) => {
    const basename = path.join(path.dirname(file), path.basename(file, ".json"))
    promises.push(fsPromises.unlink(`${basename}.avi`))
    promises.push(fsPromises.unlink(`${basename}.wav`))
  })
  await Promise.all(promises)

  // Add overlay
  console.log("Adding overlays...")
  await executeCommandsInQueue(
    "ffmpeg",
    ffmpegOverlayArgsArray,
    config.numProcesses,
    { stdio: "ignore" }
  )

  // Delete non-overlaid video files
  promises = []
  replaysWithOverlays.forEach((basename) => {
    promises.push(fsPromises.unlink(`${basename}-merged.avi`))
  })
  await Promise.all(promises)
}

const getMinimumDuration = async (videoFile) => {
  const audioArgs = [
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=duration",
    videoFile,
  ]
  const videoArgs = [
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=duration",
    videoFile,
  ]
  const audioProcess = spawn("ffprobe", audioArgs)
  const audioClose = close(audioProcess.stdout)
  const videoProcess = spawn("ffprobe", videoArgs)
  const videoClose = close(videoProcess.stdout)
  audioProcess.stdout.setEncoding("utf8")
  videoProcess.stdout.setEncoding("utf8")
  const regex = /duration=([0-9]*\.[0-9]*)/
  let audioDuration
  let videoDuration
  audioProcess.stdout.on("data", (data) => {
    const match = regex.exec(data)
    audioDuration = match[1]
  })
  videoProcess.stdout.on("data", (data) => {
    const match = regex.exec(data)
    videoDuration = match[1]
  })
  await audioClose
  await videoClose
  return Math.min(audioDuration, videoDuration)
}

const concatenateVideos = async (dir, config) => {
  await fsPromises.readdir(dir).then(async (files) => {
    // Get sorted list of video files to concatenate
    let replayVideos = files.filter((file) => file.endsWith("merged.avi"))
    replayVideos = replayVideos.concat(
      files.filter((file) => file.endsWith("overlaid.avi"))
    )
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
      const promise = getMinimumDuration(path.join(dir, file)).then(
        (duration) => {
          durations[file] = duration
        }
      )
      promises.push(promise)
    })
    await Promise.all(promises)
    // Generate ffmpeg input file
    const concatFn = path.join(dir, "concat.txt")
    const stream = fs.createWriteStream(concatFn)
    replayVideos.forEach((file) => {
      stream.write(`file '${path.join(dir, file)}'\n`)
      stream.write("inpoint 0.0\n")
      stream.write(`outpoint ${durations[file]}\n`)
    })
    stream.end()
    // Concatenate
    await fsPromises
      .readFile(path.join(dir, "outputPath.txt"), { encoding: "utf8" })
      .then(async (outputPath) => {
        const args = [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-segment_time_metadata",
          "1",
          "-i",
          concatFn,
          "-vf",
          "select=concatdec_select",
          "-af",
          "aselect=concatdec_select,aresample=async=1",
          "-b:v",
          `${config.bitrateKbps}k`,
          outputPath,
        ]
        const process = spawn("ffmpeg", args, { stdio: "ignore" })
        await exit(process)
      })
  })
}

const files = (rootdir) =>
  new Promise((resolve, reject) => {
    dir.files(rootdir, (err, files) => {
      if (err) reject(err)
      resolve(files)
    })
  })

const subdirs = (rootdir) =>
  new Promise((resolve, reject) => {
    dir.subdirs(rootdir, (err, subdirs) => {
      if (err) reject(err)
      resolve(subdirs)
    })
  })

const configureDolphin = async (config) => {
  const dolphinDirname = path.dirname(config.dolphinPath)
  const gameSettingsFilename = path.join(
    dolphinDirname,
    "User",
    "GameSettings",
    "GALE01.ini"
  )
  const graphicsSettingsFilename = path.join(
    dolphinDirname,
    "User",
    "Config",
    "GFX.ini"
  )

  // Game settings
  let rl = readline.createInterface({
    input: fs.createReadStream(gameSettingsFilename),
    crlfDelay: Infinity,
  })
  let newSettings = []
  for await (const line of rl) {
    if (
      !(
        line.startsWith("$Optional: Game Music") ||
        line.startsWith("$Optional: Hide HUD") ||
        line.startsWith("$Optional: Hide Tags") ||
        line.startsWith("$Optional: Prevent Character Crowd Chants") ||
        line.startsWith("$Optional: Fixed Camera Always") ||
        line.startsWith("$Optional: Widescreen")
      )
    ) {
      newSettings.push(line)
    }
  }
  if (!config.gameMusicOn) newSettings.push("$Optional: Game Music OFF")
  if (config.hideHud) newSettings.push("$Optional: Hide HUD")
  if (config.hideTags) newSettings.push("$Optional: Hide Tags")
  if (config.disableChants)
    newSettings.push("$Optional: Prevent Character Crowd Chants")
  if (config.fixedCamera) newSettings.push("$Optional: Fixed Camera Always")
  if (!config.widescreenOff) newSettings.push("$Optional: Widescreen 16:9")
  await fsPromises.writeFile(gameSettingsFilename, newSettings.join("\n"))

  // Graphics settings
  rl = readline.createInterface({
    input: fs.createReadStream(graphicsSettingsFilename),
    crlfDelay: Infinity,
  })
  newSettings = []
  const aspectRatioSetting = config.widescreenOff ? 5 : 6
  for await (const line of rl) {
    if (line.startsWith("AspectRatio")) {
      newSettings.push(`AspectRatio = ${aspectRatioSetting}`)
    } else if (line.startsWith("BitrateKbps")) {
      newSettings.push(`BitrateKbps = ${config.bitrateKbps}`)
    } else if (line.startsWith("EFBScale")) {
      newSettings.push(`EFBScale = ${EFB_SCALE[config.resolution]}`)
    } else {
      newSettings.push(line)
    }
  }
  await fsPromises.writeFile(graphicsSettingsFilename, newSettings.join("\n"))
}

const slpToVideo = async (replayLists, config) => {
  await fsPromises
    .access(config.ssbmIsoPath)
    .catch((err) => {
      if (err.code === "ENOENT") {
        throw new Error(
          `Could not read SSBM iso from path ${config.ssbmIsoPath}. ` +
            "Did you forget to specify the --ssbm-iso-path option?"
        )
      } else {
        throw err
      }
    })
    .then(() => fsPromises.access(config.dolphinPath))
    .catch((err) => {
      if (err.code === "ENOENT") {
        throw new Error(
          `Could not open Dolphin from path ${config.dolphinPath}. ` +
            "Did you forget to specify the --dolphin-path option?"
        )
      } else {
        throw err
      }
    })
    .then(() => configureDolphin(config))
    .then(() => fsPromises.mkdir(config.tmpdir))
    .then(async () => {
      const promises = []
      replayLists.forEach((replays) =>
        promises.push(generateReplayConfigs(replays, config.tmpdir))
      )
      await Promise.all(promises)
    })
    .then(() => files(config.tmpdir))
    .then(async (files) => {
      files = files.filter((file) => path.extname(file) === ".json")
      await processReplayConfigs(files, config)
    })
    .then(() => subdirs(config.tmpdir))
    .then(async (subdirs) => {
      console.log("Concatenating videos...")
      await executeFunctionInQueue(
        (dir) => concatenateVideos(dir, config),
        subdirs,
        config.numProcesses
      )
      console.log("Done.")
    })
    .then(() => fsPromises.rm(config.tmpdir, { recursive: true }))
    .catch((err) => {
      console.error(err)
    })
}

const main = () => {
  const argv = require("yargs").command(
    "$0 INPUT_FILE",
    "Convert .slp files to video in AVI format.",
    (yargs) => {
      yargs.positional("INPUT_FILE", {
        describe:
          "Describes the input .slp files and output filenames. " +
          "See example_input.json for an example.",
        type: "string",
      })
      yargs.option("num-processes", {
        describe: "The number of processes to use.",
        default: 1,
        type: "number",
      })
      yargs.option("dolphin-path", {
        describe: "Path to the Dolphin executable.",
        default: path.join("Ishiiruka", "build", "Binaries", "dolphin-emu"),
        type: "string",
      })
      yargs.option("ssbm-iso-path", {
        describe: "Path to the SSBM ISO image.",
        default: "SSBM.iso",
        type: "string",
      })
      yargs.option("game-music-on", {
        describe: "Turn game music on.",
        type: "boolean",
      })
      yargs.option("hide-hud", {
        describe: "Hide percentage and stock icons.",
        type: "boolean",
      })
      yargs.option("hide-tags", {
        describe: "Always hide tags.",
        type: "boolean",
      })
      yargs.option("disable-chants", {
        describe: "Disable character crowd chants.",
        type: "boolean",
      })
      yargs.option("fixed-camera", {
        describe: "Fixed camera mode.",
        type: "boolean",
      })
      yargs.option("widescreen-off", {
        describe: "Turn off widescreen.",
        type: "boolean",
      })
      yargs.option("bitrate-kbps", {
        describe: "Bitrate in kbps.",
        default: 15000,
        type: "number",
      })
      yargs.option("resolution", {
        describe: "Internal resolution multiplier.",
        default: "2x",
        type: "string",
      })
      yargs.option("tmpdir", {
        describe: "Temporary directory to use (temporary files may be large).",
        default: path.join(
          os.tmpdir(),
          `tmp-${crypto.randomBytes(12).toString("hex")}`
        ),
        type: "string",
      })
    }
  ).argv
  const config = {
    numProcesses: argv.numProcesses,
    dolphinPath: path.resolve(argv.dolphinPath),
    ssbmIsoPath: path.resolve(argv.ssbmIsoPath),
    tmpdir: path.resolve(argv.tmpdir),
    gameMusicOn: argv.gameMusicOn,
    hideHud: argv.hideHud,
    hideTags: argv.hideTags,
    disableChants: argv.disableChants,
    fixedCamera: argv.fixedCamera,
    widescreenOff: argv.widescreenOff,
    bitrateKbps: argv.bitrateKbps,
    resolution: argv.resolution,
  }
  fsPromises
    .readFile(path.resolve(argv.INPUT_FILE))
    .then((contents) => JSON.parse(contents))
    .then((replays) =>
      slpToVideo(Array.isArray(replays) ? replays : [replays], config)
    )
}

if (module === require.main) {
  main()
}

module.exports = slpToVideo
