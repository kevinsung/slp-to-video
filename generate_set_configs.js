const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dir = require('node-dir');
const slp = require('slp-parser-js');

const INPUT_DIRECTORY = '/home/kjs/Projects/smash/slippi/slp_files/copies/sets/oats';
const OUTPUT_DIRECTORY = '/home/kjs/Projects/smash/videos/sets/oats';


let files = dir.files(INPUT_DIRECTORY, { sync: true });
files.forEach(file => {
    let game = new slp.default(file);
    let metadata = game.getMetadata();
    let config = {
        mode: 'normal',
        replay: file,
        startFrame: -123,
        endFrame: metadata.lastFrame,
        isRealTimeMode: false,
        commandId: `${crypto.randomBytes(12).toString('hex')}`
    };
    let configFn = file.replace(INPUT_DIRECTORY, OUTPUT_DIRECTORY);
    let parsed = path.parse(configFn);
    configFn = path.join(parsed.dir, `${parsed.name}.json`);
    fs.mkdir(parsed.dir, { recursive: true }, (err) => {
        fs.writeFileSync(configFn, JSON.stringify(config));
    });
});
