# slp-to-video
Convert Slippi replay files to video.

Takes sequences of Slippi replay files with optional start and end frames and
overlay images, and stitches these sequences together, producing AVI video files.
Useful for creating combo videos or converting sets to video.
See [here](https://github.com/kevinsung/slp-to-video/blob/master/example_input.json)
for an example of the input file format.

## Setup (GNU/Linux)

1. Install Dolphin build dependencies. See
[here](https://wiki.dolphin-emu.org/index.php?title=Building_Dolphin_on_Linux)
or [here](https://github.com/project-slippi/Slippi-FM-installer)
for instructions.

2. Clone this repository and install our special version of Dolphin.
```
git clone https://github.com/kevinsung/slp-to-video.git
cd slp-to-video
./build-dolphin.sh
```

## Usage
```
node slp_to_video.js INPUT_FILE

Convert .slp files to video in AVI format.

Positionals:
  INPUT_FILE  Describes the input .slp files and output filenames. See
              example_input.json for an example.                        [string]

Options:
  --help            Show help                                          [boolean]
  --version         Show version number                                [boolean]
  --num-processes   The number of processes to use.        [number] [default: 1]
  --dolphin-path    Path to the Dolphin executable.
                      [string] [default: "Ishiiruka/build/Binaries/dolphin-emu"]
  --ssbm-iso-path   Path to the SSBM ISO image.   [string] [default: "SSBM.iso"]
  --game-music-on   Turn game music on.                                [boolean]
  --hide-hud        Hide percentage and stock icons.                   [boolean]
  --widescreen-off  Turn off widescreen.                               [boolean]
  --bitrate-kbps    Bitrate in kbps.                   [number] [default: 15000]
  --resolution      Internal resolution multiplier.     [string] [default: "2x"]
  --tmpdir          Temporary directory to use (temporary files may be large).
                         [string] [default: "/tmp/tmp-648638048a6c4e1c6476a623"]
```
