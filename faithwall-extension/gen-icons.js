// gen-icons.js — Generate FaithWall PNG icons from SVG
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

function svgForSize(size) {
  const pad = Math.round(size * 0.12);
  const r = Math.round(size * 0.18);

  // Cross proportions
  const cx = size / 2;
  const cy = size / 2;
  const vw = Math.round(size * 0.14);  // vertical bar width
  const hw = Math.round(size * 0.14);  // horizontal bar height
  const vt = Math.round(size * 0.16);  // top of vertical
  const vb = size - Math.round(size * 0.14);  // bottom of vertical
  const hl = Math.round(size * 0.16);  // left of horizontal
  const hr = size - Math.round(size * 0.16); // right of horizontal
  const hmy = Math.round(size * 0.36); // y center of horizontal bar

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a1207"/>
      <stop offset="100%" stop-color="#0a0800"/>
    </linearGradient>
    <linearGradient id="cross" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#e8c84a"/>
      <stop offset="100%" stop-color="#8a6210"/>
    </linearGradient>
  </defs>
  <!-- Background rounded rect -->
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <!-- Cross: vertical bar -->
  <rect x="${cx - vw/2}" y="${vt}" width="${vw}" height="${vb - vt}" rx="${Math.max(1, Math.round(vw*0.2))}" fill="url(#cross)"/>
  <!-- Cross: horizontal bar -->
  <rect x="${hl}" y="${hmy - hw/2}" width="${hr - hl}" height="${hw}" rx="${Math.max(1, Math.round(hw*0.2))}" fill="url(#cross)"/>
</svg>`;
}

async function main() {
  const sizes = [16, 32, 48, 128];
  const outDir = path.join(__dirname, 'icons');

  for (const size of sizes) {
    const svg = svgForSize(size);
    const outPath = path.join(outDir, `icon${size}.png`);
    await sharp(Buffer.from(svg))
      .png()
      .toFile(outPath);
    console.log(`  ✓ icon${size}.png`);
  }
  console.log('Icons generated.');
}

main().catch(e => { console.error(e); process.exit(1); });
