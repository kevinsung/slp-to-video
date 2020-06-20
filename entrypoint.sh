#!/bin/bash

Xvfb :1 &
XVFB_PID=$!
export DISPLAY=:1
node generate_set_videos.js --dolphin_path /usr/src/slp-to-video/Ishiiruka/build/Binaries/dolphin-emu --ssbm_iso_path /usr/src/slp-to-video/SSBM.iso --input $1 --output $2 --num_cpus $3
kill $XVFB_PID
