# slp-to-video
Convert Slippi replay files to video using Dolphin.

## Installation
```
git clone https://github.com/kevinsung/slp-to-video.git
cd slp-to-video
./setup.sh
```

## Usage
```
slp_to_video.js INPUT_FILE

Convert .slp files to video in AVI format.

Positionals:
  INPUT_FILE  Describes the input .slp files and output filenames. See
              example_input.json for an example.                        [string]

Options:
  --help            Show help                                          [boolean]
  --version         Show version number                                [boolean]
  --num-cpus        The number of processes to use.        [number] [default: 1]
  --dolphin-path    Path to the Dolphin executable.
                      [string] [default: "Ishiiruka/build/Binaries/dolphin-emu"]
  --ssbm-iso-path   Path to the SSBM ISO image.   [string] [default: "SSBM.iso"]
  --game-music-on   Turn game music on.                                [boolean]
  --hide-hud        Hide percentage and stock icons.                   [boolean]
  --widescreen-off  Turn off widescreen.                               [boolean]
  --tmpdir          Temporary directory to use (temporary files may be large).
                         [string] [default: "/tmp/tmp-{a long random string}"]
```
