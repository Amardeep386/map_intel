const Jimp = require('jimp');

async function cropImage(path) {
  try {
    const image = await Jimp.read(path);
    // Autocrop trims uniform borders
    image.autocrop();
    await image.writeAsync(path);
    console.log(`Successfully cropped ${path}`);
  } catch (error) {
    console.error(`Error cropping ${path}:`, error);
  }
}

async function run() {
  await cropImage('src/assets/lg.png');
  await cropImage('src/assets/philips.png');
  await cropImage('src/assets/kawasaki.png');
}

run();
