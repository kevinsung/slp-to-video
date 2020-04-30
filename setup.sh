git clone https://github.com/kevinsung/Ishiiruka.git
cd Ishiiruka
git checkout 6fcbd55952f4f1d4521eddc1a9811227bbb6925c

if [ -e "build/" ]; then
	rm -rf build/
	mkdir build
else
	mkdir build
fi
cd build
cmake -DLINUX_LOCAL_DEV=true ../
make -j3
touch Binaries/portable.txt
cp -R ../Overwrite/* Binaries/

curl -L -o config.tar.gz https://github.com/project-slippi/Slippi-FM-installer/raw/master/slippi-r18-playback-config.tar.gz
tar -xzf config.tar.gz
rm config.tar.gz

cd Binaries
curl -L -o config.tar.gz https://github.com/kevinsung/slippi-dolphin-playback-config/raw/master/r18-config.tar.gz
tar -xzf config.tar.gz
rm config.tar.gz
