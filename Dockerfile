FROM fedora:31

# Install dependencies
RUN dnf install -y curl
RUN dnf install -y git
RUN dnf install -y make
RUN dnf install -y nodejs
RUN dnf install -y npm
RUN dnf install -y xorg-x11-server-Xvfb
# Dolphin build dependencies
RUN dnf install -y cmake
RUN dnf install -y gcc-c++
RUN dnf install -y libXext-devel
RUN dnf install -y libgudev
RUN dnf install -y libXi-devel
RUN dnf install -y libSM-devel
RUN dnf install -y gtk2-devel
RUN dnf install -y wxGTK3-devel
RUN dnf install -y systemd-devel
RUN dnf install -y openal-soft-devel
RUN dnf install -y libevdev-devel
RUN dnf install -y libao-devel
RUN dnf install -y SOIL-devel
RUN dnf install -y libXrandr-devel
RUN dnf install -y pulseaudio-libs-devel
RUN dnf install -y bluez-libs-devel
RUN dnf install -y libusb-devel
# From RPM Fusion
RUN dnf install -y https://download1.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm
RUN dnf install -y ffmpeg

# Clone repository
WORKDIR /usr/src
RUN git clone https://github.com/kevinsung/slp-to-video.git
WORKDIR /usr/src/slp-to-video

# Copy SSBM iso
COPY SSBM.iso .
# REMOVE THIS
COPY generate_set_videos.js .
COPY entrypoint.sh .

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
#ENTRYPOINT ["bash", "entrypoint.sh"]
