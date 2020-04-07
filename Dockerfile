FROM debian:10

# Install dependencies
RUN apt update
RUN apt install -y make
RUN apt install -y g++
RUN apt install -y curl
RUN apt install -y ffmpeg
RUN apt install -y xvfb
RUN apt install -y nodejs
RUN apt install -y npm
# Dolphin build dependencies
RUN apt install -y cmake
RUN apt install -y pkg-config
RUN apt install -y git
RUN apt install -y libao-dev
RUN apt install -y libasound2-dev
RUN apt install -y libavcodec-dev
RUN apt install -y libavformat-dev
RUN apt install -y libbluetooth-dev
RUN apt install -y libenet-dev
RUN apt install -y libgtk2.0-dev
RUN apt install -y liblzo2-dev
RUN apt install -y libminiupnpc-dev
RUN apt install -y libopenal-dev
RUN apt install -y libpulse-dev
RUN apt install -y libreadline-dev
RUN apt install -y libsfml-dev
RUN apt install -y libsoil-dev
RUN apt install -y libsoundtouch-dev
RUN apt install -y libswscale-dev
RUN apt install -y libusb-1.0-0-dev
RUN apt install -y libwxbase3.0-dev
RUN apt install -y libwxgtk3.0-dev
RUN apt install -y libxext-dev
RUN apt install -y libxrandr-dev
RUN apt install -y portaudio19-dev
RUN apt install -y zlib1g-dev
RUN apt install -y libudev-dev
RUN apt install -y libevdev-dev
RUN apt install -y "libpolarssl-dev|libmbedtls-dev"
RUN apt install -y libcurl4-openssl-dev
RUN apt install -y libegl1-mesa-dev
RUN apt install -y libpng-dev
RUN apt install -y qtbase5-private-dev

# Clone repository
WORKDIR /usr/src
RUN git clone https://github.com/kevinsung/slp-to-video.git
WORKDIR /usr/src/slp-to-video

# Copy SSBM iso
COPY SSBM.iso SSBM.iso

# Compile and configure Dolphin
RUN git clone https://github.com/kevinsung/Ishiiruka.git
WORKDIR /usr/src/slp-to-video/Ishiiruka
RUN git checkout 6fcbd55952f4f1d4521eddc1a9811227bbb6925c
RUN mkdir build
WORKDIR /usr/src/slp-to-video/Ishiiruka/build
RUN cmake -DLINUX_LOCAL_DEV=true ../
RUN make -j63
RUN touch Binaries/portable.txt
RUN cp -R ../Overwrite/* Binaries/
RUN curl -L -o config.tar.gz https://github.com/project-slippi/Slippi-FM-installer/raw/master/slippi-r18-playback-config.tar.gz
RUN tar -xzf config.tar.gz
RUN rm config.tar.gz
WORKDIR /usr/src/slp-to-video/Ishiiruka/build/Binaries
RUN curl -L -o config.tar.gz https://github.com/kevinsung/slippi-dolphin-playback-config/raw/master/r18-config.tar.gz
RUN tar -xzf config.tar.gz
RUN rm config.tar.gz

# Install package
RUN npm install

# Entrypoint
WORKDIR /usr/src/slp-to-video
ENTRYPOINT ["node", "generate_set_videos.js",\
            "--dolphin_path",\
            "/usr/src/slp-to-video/Ishiiruka/build/Binaries/dolphin-emu",\
            "--ssbm_iso_path",\
            "SSBM.iso"]
