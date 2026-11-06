'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const logoSvg = fs.readFileSync(path.join(root, 'webapp', 'favicon.svg'), 'utf8');
if (!logoSvg.includes('viewBox="0 0 64 64"') ||
    !logoSvg.includes('stroke="#ffffff"') ||
    !logoSvg.includes('fill="#ffffff"')) {
  throw new Error('The official Slickly favicon SVG changed; review the native icon geometry before building.');
}
const output = path.join(root, 'build', 'icons');
const iconset = path.join(output, 'Slickly.iconset');
fs.mkdirSync(iconset, { recursive: true });

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function insideRoundedSquare(x, y, size) {
  const radius = size * 15 / 64;
  const cx = Math.max(radius, Math.min(size - radius, x));
  const cy = Math.max(radius, Math.min(size - radius, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}
function renderPng(size) {
  const supersample = 4;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 64;
  const outer = 19.5 * scale;
  const inner = 14.5 * scale;
  const dot = 5.5 * scale;
  const center = size / 2;
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let black = 0;
      let white = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const px = x + (sx + 0.5) / supersample;
          const py = y + (sy + 0.5) / supersample;
          if (!insideRoundedSquare(px, py, size)) continue;
          black += 1;
          const dx = px - center;
          const dy = py - center;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if ((distance >= inner && distance <= outer) || distance <= dot) white += 1;
        }
      }
      const samples = supersample * supersample;
      const offset = row + 1 + x * 4;
      pixels[offset] = white ? 255 : 0;
      pixels[offset + 1] = white ? 255 : 0;
      pixels[offset + 2] = white ? 255 : 0;
      pixels[offset + 3] = Math.round((black / samples) * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function writePng(size, filename) {
  const file = path.join(output, filename);
  fs.writeFileSync(file, renderPng(size));
  return file;
}
function writeIco(png, filename) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(output, filename), Buffer.concat([header, png]));
}

const pngSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
for (const size of pngSizes) writePng(size, 'icon-' + size + '.png');
writePng(1024, 'icon.png');
writeIco(renderPng(256), 'icon.ico');

const iconsetFiles = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
];
for (const entry of iconsetFiles) {
  fs.writeFileSync(path.join(iconset, entry[0]), renderPng(entry[1]));
}
if (process.platform === 'darwin') {
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(output, 'icon.icns')]);
}
console.log('Generated Slickly app icons in ' + output);
