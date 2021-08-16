#!/bin/bash -e

VERSION=2.3.2

if [ -e "Ishiiruka/" ]; then
    rm -rf Ishiiruka/
fi

if [ -e "Ishiiruka-$VERSION.tar.gz" ]; then
    rm Ishiiruka-$VERSION.tar.gz
fi

curl -LJO https://github.com/project-slippi/Ishiiruka/archive/refs/tags/v$VERSION.tar.gz
tar -xf Ishiiruka-$VERSION.tar.gz
rm Ishiiruka-$VERSION.tar.gz
mv Ishiiruka-$VERSION Ishiiruka
pushd Ishiiruka
./build-linux.sh playback
popd
