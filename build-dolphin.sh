#!/bin/bash -e

CMAKE_FLAGS='-DLINUX_LOCAL_DEV=true -DIS_PLAYBACK=true'

# Clone Dolphin
git clone https://github.com/project-slippi/Ishiiruka.git
pushd Ishiiruka
git checkout ba24f6c3ab8c493efe8b026b333769720cda7f27

# Move into the build directory, run CMake, and compile the project
mkdir -p build
pushd build
cmake ${CMAKE_FLAGS} ../
make -j$(nproc)
popd

# Copy the Sys folder in
cp -r -n Data/Sys/ build/Binaries/

# Update Sys dir with playback codes
git clone https://github.com/project-slippi/slippi-desktop-app
pushd slippi-desktop-app
git checkout e41e11a7ee60b6160de8c97c0f0d2ae56ea0eedb
popd
cp -r slippi-desktop-app/app/dolphin-dev/overwrite/Sys build/Binaries

touch ./build/Binaries/portable.txt
popd

# Copy configuration files
cp -r Overwrite/* Ishiiruka/build/Binaries/

# Add custom codes
echo >> Ishiiruka/build/Binaries/Sys/GameSettings/GALE01r2.ini
cat gecko_codes.txt >> Ishiiruka/build/Binaries/Sys/GameSettings/GALE01r2.ini
