#!/bin/bash -e

git clone https://github.com/kevinsung/Ishiiruka.git
pushd Ishiiruka
git checkout 6fcbd55952f4f1d4521eddc1a9811227bbb6925c
if [ -e "build/" ]; then
	rm -rf build/
	mkdir build
else
	mkdir build
fi
pushd build
cmake -DLINUX_LOCAL_DEV=true ../
make -j3
popd
touch build/Binaries/portable.txt
cp -R Overwrite/* build/Binaries/
popd
cp -R Overwrite/* Ishiiruka/build/Binaries/
