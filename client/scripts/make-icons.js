// Generates the PWA icons (a percent mark on a rounded dark tile) without any
// image tooling: plain pixel math via pngjs. Rerun: node scripts/make-icons.js
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
fs.mkdirSync(outDir, { recursive: true });

const BG = [23, 26, 33];        // --panel
const TILE = [79, 140, 255];    // --accent
const FG = [255, 255, 255];

function makeIcon(size, file) {
  const png = new PNG({ width: size, height: size });
  const r = size * 0.22;            // tile corner radius
  const ringR = size * 0.13;        // percent circles radius
  const ringW = size * 0.055;       // ring thickness
  const lineW = size * 0.05;        // slash half-thickness
  const c1 = [size * 0.33, size * 0.33];
  const c2 = [size * 0.67, size * 0.67];

  const inTile = (x, y) => {
    const cx = Math.max(r - x, x - (size - 1 - r), 0);
    const cy = Math.max(r - y, y - (size - 1 - r), 0);
    return cx * cx + cy * cy <= r * r;
  };
  const inRing = (x, y, [cx, cy]) => {
    const d = Math.hypot(x - cx, y - cy);
    return d <= ringR && d >= ringR - ringW;
  };
  // slash: distance from the anti-diagonal line through the center
  const inSlash = (x, y) => {
    const d = Math.abs((x - y) * Math.SQRT1_2 * -1 + 0); // distance to y=x mirrored
    const dist = Math.abs(x + y - (size - 1)) / Math.SQRT2;
    const along = Math.abs(x - y) / Math.SQRT2;
    return dist <= lineW && along <= size * 0.30;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      let col = BG;
      if (inTile(x, y)) {
        col = TILE;
        if (inRing(x, y, c1) || inRing(x, y, c2) || inSlash(x, y)) col = FG;
      } else {
        png.data[i + 3] = 0; // transparent corners
        continue;
      }
      png.data[i] = col[0]; png.data[i + 1] = col[1]; png.data[i + 2] = col[2]; png.data[i + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(outDir, file), PNG.sync.write(png));
  console.log('wrote', file, `${size}x${size}`);
}

makeIcon(180, 'apple-touch-icon.png');
makeIcon(192, 'icon-192.png');
makeIcon(512, 'icon-512.png');
