import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const outDir = path.resolve(process.cwd(), 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// Minimalist cookie-with-bite SVG (crisp at 16px..128px)
function makeSvg(fill, chipFill, stroke = 'none') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <path d="M32 6C17.64 6 6 17.64 6 32s11.64 26 26 26 26-11.64 26-26c0-1.6-.15-3.17-.42-4.7a7.5 7.5 0 0 1-8.88-8.88A7.5 7.5 0 0 1 36.7 6.42C35.17 6.15 33.6 6 32 6Z" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
  <circle cx="22" cy="24" r="3.6" fill="${chipFill}"/>
  <circle cx="21" cy="40" r="4.2" fill="${chipFill}"/>
  <circle cx="35" cy="34" r="3.4" fill="${chipFill}"/>
  <circle cx="38" cy="46" r="3.2" fill="${chipFill}"/>
  <circle cx="46" cy="34" r="3.5" fill="${chipFill}"/>
  <circle cx="32" cy="18" r="2.8" fill="${chipFill}"/>
</svg>
`;
}

// Primary brand icon (warm amber cookie + deep espresso chips)
fs.writeFileSync(path.join(outDir, 'icon.svg'), makeSvg('#d97706', '#451a03'));
// Firefox dark-toolbar light icon
fs.writeFileSync(path.join(outDir, 'icon-light.svg'), makeSvg('#f8fafc', '#0f172a'));
// Firefox light-toolbar dark icon
fs.writeFileSync(path.join(outDir, 'icon-dark.svg'), makeSvg('#334155', '#f8fafc'));

// Pure-Node PNG encoder for Chrome/Edge PNG icons (16, 32, 48, 128)
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed-distance anti-aliased rasterizer for the bitten cookie icon
function renderCookiePng(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const chips = [
    [22, 24, 3.6],
    [21, 40, 4.2],
    [35, 34, 3.4],
    [38, 46, 3.2],
    [46, 34, 3.5],
    [32, 18, 2.8],
  ];
  const bites = [
    [51, 15, 11.5],
    [43, 8, 7.5],
    [56, 23, 6.5],
  ];

  // 4x4 supersampling for crisp anti-aliased edges at every icon size
  const samples = 4;
  const invSamples = 1 / samples;
  const totalSamples = samples * samples;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) * invSamples) / size) * 64;
          const y = ((py + (sy + 0.5) * invSamples) / size) * 64;

          const distMain = Math.hypot(x - 32, y - 32);
          if (distMain > 26.5) continue;

          let bitten = false;
          for (const [bx, by, br] of bites) {
            if (Math.hypot(x - bx, y - by) < br) {
              bitten = true;
              break;
            }
          }
          if (bitten) continue;

          // Smooth edge shade + soft top-left radial highlight
          let r = 217;
          let g = 119;
          let b = 6;
          if (distMain > 23.5) {
            r = 180;
            g = 83;
            b = 9;
          } else {
            const hl = Math.max(0, 1 - Math.hypot(x - 23, y - 22) / 26);
            r = Math.min(255, Math.round(r + hl * 28));
            g = Math.min(255, Math.round(g + hl * 34));
            b = Math.min(255, Math.round(b + hl * 18));
          }

          for (const [cx, cy, cr] of chips) {
            if (Math.hypot(x - cx, y - cy) <= cr) {
              r = 69;
              g = 26;
              b = 3;
              break;
            }
          }

          rSum += r;
          gSum += g;
          bSum += b;
          aSum += 255;
        }
      }

      const idx = (py * size + px) * 4;
      if (aSum > 0) {
        const cov = aSum / (totalSamples * 255);
        rgba[idx] = Math.round(rSum / (aSum / 255));
        rgba[idx + 1] = Math.round(gSum / (aSum / 255));
        rgba[idx + 2] = Math.round(bSum / (aSum / 255));
        rgba[idx + 3] = Math.round(cov * 255);
      }
    }
  }

  return encodePng(size, size, rgba);
}

for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), renderCookiePng(size));
}

console.log(`Generated ClearCookie icons in ${outDir}`);
