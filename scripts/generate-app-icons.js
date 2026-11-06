'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const logoSvg = fs.readFileSync(path.join(root, 'webapp', 'favicon.svg'), 'utf8');
if (!logoSvg.includes('viewBox="0 0 64 64"') ||
    !logoSvg.includes('fill="#171916"') ||
    !logoSvg.includes('stroke="#d5f45b"')) {
  throw new Error('The official Slickly lime-X mark changed; review native icon geometry before building.');
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
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function renderPng(size) {
  const supersample = 4, pixels = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 64, center = size / 2, radius = 23.5 * scale, stroke = 6.3 * scale;
  const arms = [[25.5*scale,25.5*scale,38.5*scale,38.5*scale],[38.5*scale,25.5*scale,25.5*scale,38.5*scale]];
  for (let y=0;y<size;y+=1) {
    const row=y*(size*4+1); pixels[row]=0;
    for(let x=0;x<size;x+=1) {
      let dark=0,lime=0;
      for(let sy=0;sy<supersample;sy+=1) for(let sx=0;sx<supersample;sx+=1) {
        const px=x+(sx+.5)/supersample, py=y+(sy+.5)/supersample;
        if(Math.hypot(px-center,py-center)>radius) continue;
        if(arms.some(([ax,ay,bx,by])=>distanceToSegment(px,py,ax,ay,bx,by)<=stroke/2)) lime+=1; else dark+=1;
      }
      const total=dark+lime; if(!total) continue;
      const o=row+1+x*4;
      pixels[o]=Math.round((dark*23+lime*213)/total);
      pixels[o+1]=Math.round((dark*25+lime*244)/total);
      pixels[o+2]=Math.round((dark*22+lime*91)/total);
      pixels[o+3]=Math.round(total/(supersample*supersample)*255);
    }
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size,0); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels,{level:9})),chunk('IEND',Buffer.alloc(0))]);
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

const appIcon = renderPng(1024);
writePng(1024, 'icon.png');
writePng(16, 'taskbar-overlay.png');
writeIco(renderPng(256), 'icon.ico');
const mobileAssets = path.join(root, 'mobile', 'assets');
fs.mkdirSync(mobileAssets, { recursive: true });
fs.writeFileSync(path.join(mobileAssets, 'icon.png'), appIcon);
fs.writeFileSync(path.join(mobileAssets, 'adaptive-icon.png'), appIcon);

if (process.platform === 'darwin') {
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
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(output, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });
}
console.log('Generated Slickly app icons in ' + output);
