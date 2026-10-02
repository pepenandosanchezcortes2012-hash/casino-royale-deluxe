// PWA: genera los iconos pixel art (PNG de 192 y 512 px, y uno «maskable» con margen) y la lista
// de precarga del service worker con su versión de caché (versión de package.json + huella de
// los archivos). Así el juego entero queda en caché y funciona sin conexión.
//   node tools/build-pwa.mjs          (o: npm run pwa)
//   node tools/build-pwa.mjs --check  falla si algo no está al día
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { appIcon } from '../js/ui/pixel-sprites.js';

const root = new URL('../', import.meta.url);
const path = (rel) => new URL(rel, root);
const SW = 'service-worker.js';
export const ICONS = Object.freeze([
  { file: 'icons/icon-192.png', size: 192, pad: 0 },
  { file: 'icons/icon-512.png', size: 512, pad: 0 },
  { file: 'icons/icon-maskable-512.png', size: 512, pad: 64 },
]);

// ---------- PNG mínimo (RGBA, sin dependencias) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const rgba = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)).concat(255);
};

// Rejilla → PNG de `size` px (cada celda, un bloque nítido) con `pad` px de fondo alrededor.
export function gridPng({ grid, palette }, size, pad = 0, background = '#0b0d14') {
  const cell = Math.floor((size - pad * 2) / grid.w);
  const offset = Math.floor((size - cell * grid.w) / 2);
  const bg = rgba(background);
  const colors = palette.map((c) => (c ? rgba(c) : bg));
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - offset) / cell);
      const gy = Math.floor((y - offset) / cell);
      const inside = gx >= 0 && gy >= 0 && gx < grid.w && gy < grid.h;
      const color = inside ? colors[grid.get(gx, gy)] : bg;
      raw.set(color, row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Lista de precarga ----------

function walk(dir, test) {
  const out = [];
  for (const entry of readdirSync(path(dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel, test));
    else if (test(entry.name)) out.push(rel);
  }
  return out;
}

export function precacheList() {
  return [
    'index.html',
    'manifest.json',
    ...walk('css', (n) => n.endsWith('.css')),
    ...walk('fonts', (n) => n.endsWith('.woff')),
    ...walk('js', (n) => n.endsWith('.js')),
    ...ICONS.map((icon) => icon.file),
  ].sort();
}

export function serviceWorker() {
  const files = precacheList();
  const hash = createHash('sha256');
  for (const file of files) {
    if (file.startsWith('icons/') && !existsSync(path(file))) continue;
    hash.update(file).update(readFileSync(path(file)));
  }
  const version = JSON.parse(readFileSync(path('package.json'), 'utf8')).version;
  const template = readFileSync(path(SW), 'utf8');
  const list = files.map((file) => `  './${file}',`).join('\n');
  return template
    .replace(/const CACHE = '[^']*';/, `const CACHE = 'crd-${version}-${hash.digest('hex').slice(0, 10)}';`)
    .replace(/const ASSETS = \[[\s\S]*?\n\];/, `const ASSETS = [\n  './',\n${list}\n];`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let stale = false;
  mkdirSync(path('icons'), { recursive: true });
  for (const icon of ICONS) {
    const png = gridPng(appIcon(), icon.size, icon.pad);
    const current = existsSync(path(icon.file)) ? readFileSync(path(icon.file)) : null;
    if (!current || !current.equals(png)) {
      stale = true;
      if (!check) writeFileSync(path(icon.file), png);
    }
  }
  const sw = serviceWorker();
  if (sw !== readFileSync(path(SW), 'utf8')) {
    stale = true;
    if (!check) writeFileSync(path(SW), sw);
  }
  if (check && stale) {
    console.error('La PWA no está al día: ejecuta node tools/build-pwa.mjs');
    process.exit(1);
  }
  console.log(check ? 'PWA al día.' : `PWA regenerada: ${precacheList().length} archivos en caché.`);
}
