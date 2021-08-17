#!/bin/bash -e

VERSION=2.3.2

SOURCE=https://github.com/project-slippi/Ishiiruka/archive/refs/tags/v$VERSION.tar.gz
BASENAME=Ishiiruka-$VERSION

if [ -e "Ishiiruka/" ]; then
    rm -rf Ishiiruka/
fi

if [ -e "$BASENAME.tar.gz" ]; then
    rm $BASENAME.tar.gz
fi

curl -LJO $SOURCE
tar -xf $BASENAME.tar.gz
rm $BASENAME.tar.gz
mv $BASENAME Ishiiruka
pushd Ishiiruka
./build-linux.sh playback
popd
cp -r config/* Ishiiruka/build/Binaries/
cat gecko_codes.txt | tee -a Ishiiruka/build/Binaries/Sys/GameSettings/GALE01r2.ini
