// Pruebas del sitio estático: precarga de módulos, CSP, estructura de la escalada, identificadores
// del DOM y animaciones baratas.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { posix } from 'node:path';

import { GAME_ORDER, gameFloor } from '../js/climb/floors.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const html = read('index.html');
const CSS_FILES = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);

// Módulos alcanzables desde js/app.js siguiendo los import estáticos.
function moduleGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(/^import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
      queue.push(posix.join(posix.dirname(file), match[1]));
    }
  }
  return [...seen];
}

test('Carga: index.html precarga en paralelo todos los módulos de la app', () => {
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);
  const modules = moduleGraph('js/app.js').filter((file) => file !== 'js/app.js');
  assert.deepEqual([...preloads].sort(), [...modules].sort());
  for (const file of preloads) assert.ok(existsSync(new URL(file, root)), `falta ${file}`);
});

test('Sonido: sin síntesis de voz ni locuciones; silencio, volumen e interruptores accesibles', () => {
  const modules = moduleGraph('js/app.js');
  for (const file of modules) {
    const source = read(file);
    for (const pattern of [/speechSynthesis/, /SpeechSynthesisUtterance/, /\.speak\(/, /voice\.say\(/]) assert.equal(pattern.test(source), false, `${file} usa ${pattern}`);
  }
  assert.equal(/btn-voice|voice-test|Probar la voz/.test(html), false, 'controles de voz en el HTML');
  assert.match(html, /id="btn-mute"[^>]*aria-pressed/);
  assert.match(html, /<input type="range" id="volume"[^>]*aria-label="Volumen general"/);
  for (const id of ['btn-music', 'btn-sfx', 'btn-lite']) assert.match(html, new RegExp(`id="${id}"[^>]*aria-pressed`), id);
});

test('Pixel art: fuentes OFL autoalojadas y precargadas, en su rejilla de 8 px', () => {
  const fonts = { 'Press Start 2P': 'press-start-2p', Silkscreen: 'silkscreen', VT323: 'vt323' };
  const pixel = read('css/pixel.css');
  for (const [family, file] of Object.entries(fonts)) {
    assert.ok(existsSync(new URL(`fonts/${file}.woff`, root)), `falta fonts/${file}.woff`);
    assert.match(html, new RegExp(`<link rel="preload" href="fonts/${file}\\.woff" as="font" type="font/woff" crossorigin>`), `precarga de ${file}`);
    assert.match(pixel, new RegExp(`@font-face[^}]*"${family}"[^}]*url\\("\\.\\./fonts/${file}\\.woff"\\)`, 's'), `@font-face de ${family}`);
  }
  for (const license of ['OFL-pressstart2p.txt', 'OFL-silkscreen.txt', 'OFL-vt323.txt']) assert.ok(existsSync(new URL(`fonts/${license}`, root)), license);
  assert.equal(existsSync(new URL('fonts/syndicate-pixel.woff', root)), false, 'fuente antigua retirada');
  assert.equal(CSS_FILES.at(-1), 'css/pixel.css', 'la hoja pixel se carga la última');
  // Press Start 2P y Silkscreen se dibujan en una rejilla de 8 px: sus tamaños son múltiplos de 8.
  for (const match of pixel.matchAll(/font-size:\s*(\d+)px/g)) assert.equal(Number(match[1]) % 8, 0, `font-size ${match[1]}px`);
  assert.match(pixel, /--font-display: var\(--font-pixel\)/);
  assert.match(pixel, /--font-mono: var\(--font-term\)/);
});

test('Pixel art: esquinas a 0, sombras duras y nada de desenfoques en el CSS', () => {
  const pixel = read('css/pixel.css');
  assert.match(pixel, /html\[data-app\] \*,\s*html\[data-app\] \*::before,\s*html\[data-app\] \*::after \{\s*border-radius: 0 !important;/);
  assert.match(pixel, /svg \*\s*\{\s*shape-rendering: crispEdges;/);
  assert.match(pixel, /image-rendering: pixelated/);
  // Botones arcade: borde grueso, sombra dura de 4 px y pulsación que hunde 2 px.
  assert.match(pixel, /border: 3px solid #000;[^}]*4px 4px 0 #000/s);
  assert.match(pixel, /:active \{\s*transform: translate\(2px, 2px\);/);
  for (const file of CSS_FILES) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/blur\(/.test(css), false, `${file}: desenfoque`);
    for (const match of css.matchAll(/border(?:-(?:top|bottom)-(?:left|right))?-radius:\s*([^;]+);/g)) assert.match(match[1].trim(), /^0( !important)?$/, `${file}: border-radius ${match[1]}`);
    // Ninguna sombra con radio de desenfoque (tercer valor de longitud distinto de 0).
    for (const match of css.matchAll(/(?:box|text)-shadow:\s*([^;]+);/g)) {
      for (const shadow of match[1].split(/,(?![^(]*\))/)) {
        const lengths = shadow.replace(/rgba?\([^)]*\)|color-mix\([^)]*\)|var\([^)]*\)/g, '').match(/-?\d*\.?\d+(?:px|rem|em)?/g) ?? [];
        if (lengths.length >= 3) assert.equal(Number.parseFloat(lengths[2]), 0, `${file}: sombra difusa «${shadow.trim()}»`);
      }
    }
  }
});

test('Pixel art: lienzos sin suavizado ni degradados, y sprites de 3 fotogramas', async () => {
  const modules = moduleGraph('js/app.js');
  assert.ok(modules.includes('js/ui/pixel-art.js') && modules.includes('js/ui/pixel-sprites.js'));
  for (const file of modules.concat('js/ui/matrix-worker.js')) {
    const source = read(file);
    for (const pattern of [/createLinearGradient/, /createRadialGradient/, /shadowBlur/, /bezierCurveTo/, /quadraticCurveTo/, /fillText\('[\u{1F300}-\u{1FAFF}]/u]) assert.equal(pattern.test(source), false, `${file} usa ${pattern}`);
    // Todo contexto 2D pasa por noSmooth/pixelContext (o lo desactiva el pintor de la lluvia).
    if (/getContext\('2d'/.test(source)) assert.ok(/noSmooth|pixelContext|RainPainter/.test(source), `${file}: contexto 2D sin desactivar el suavizado`);
  }
  assert.match(read('js/ui/pixel-art.js'), /imageSmoothingEnabled = false;[\s\S]*webkitImageSmoothingEnabled = false;[\s\S]*mozImageSmoothingEnabled = false;[\s\S]*msImageSmoothingEnabled = false;/);
  assert.match(read('js/ui/matrix-core.js'), /imageSmoothingEnabled = false/);
  const { fishFrames, planeFrames, SVG_SPRITES } = await import('../js/ui/pixel-sprites.js');
  for (const id of ['neon', 'jelly', 'manta', 'shark', 'kraken']) {
    const frames = fishFrames(id);
    assert.equal(frames.length, 3, id);
    assert.notDeepEqual(frames[0].grid.cells, frames[2].grid.cells, `${id}: los fotogramas cambian`);
  }
  assert.equal(planeFrames().length, 2);
  for (const id of ['sym-X', 'sym-W', 'sym-C', 'sym-S', 'sym-B', 'sym-H', 'sym-T', 'sym-R', 'gem', 'mine', 'crown', 'npc-moss', 'npc-vera', 'npc-ferro', 'npc-sibila', 'chest-lid', 'chest-body']) {
    assert.ok(SVG_SPRITES[id], id);
  }
});

test('Pixel art: el sprite SVG de index.html está generado y sin vectores suaves ni emojis', async () => {
  const { spriteBlock } = await import('../tools/build-pixel-sprites.mjs');
  assert.ok(html.includes(spriteBlock()), 'ejecuta node tools/build-pixel-sprites.mjs');
  assert.equal(/<(?:linearGradient|radialGradient|circle|ellipse)\b/.test(html), false, 'formas o degradados vectoriales en index.html');
  assert.equal(/ rx="/.test(html), false, 'esquinas redondeadas en SVG');
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u;
  assert.equal(emoji.test(html), false, 'emoji en index.html');
  for (const file of moduleGraph('js/app.js')) assert.equal(emoji.test(read(file)), false, `emoji en ${file}`);
});

test('Estructura: una sola escalada con las 11 mesas ordenadas por piso', () => {
  assert.equal(/data-only=|id="main-menu"/.test(html), false, 'sin menú ni partes por modo');
  assert.match(html, /<div class="game-shell">/);
  const tabs = [...html.matchAll(/role="tab"[^>]*data-game="([a-z_]+)" data-floor="(\d)"/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(tabs.map(([game]) => game), GAME_ORDER);
  for (const [game, floor] of tabs) {
    assert.equal(gameFloor(game).level, floor, `${game} se abre en el piso ${floor}`);
    assert.match(html, new RegExp(`id="panel-${game}"`), `falta el panel de ${game}`);
  }
  for (const id of ['floor-selector', 'goal-track', 'btn-rescue', 'side-tab-syndicate', 'side-tab-telemetry', 'unlock-dialog', 'epilogue', 'throne-form', 'fs-canvas']) assert.match(html, new RegExp(`id="${id}"`), id);
  for (const file of CSS_FILES) assert.ok(existsSync(new URL(file, root)), `falta ${file}`);
  for (const file of ['css/themes.css', 'css/hacker_terminal.css', 'css/animations.css']) assert.ok(CSS_FILES.includes(file), file);
  for (const theme of ['matrix', 'neon', 'onyx', 'gold', 'blood']) assert.match(read('css/themes.css'), new RegExp(`data-theme="${theme}"`));
});

test('DOM: cada identificador que buscan los módulos existe una sola vez en index.html', () => {
  const ids = new Map();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) ids.set(match[1], (ids.get(match[1]) ?? 0) + 1);
  for (const [id, count] of ids) assert.equal(count, 1, `id duplicado: ${id}`);
  const modules = moduleGraph('js/app.js');
  for (const file of modules) {
    const source = read(file);
    for (const match of source.matchAll(/(?:\$|getElementById)\('([a-z][a-z0-9_-]*)'\)/g)) {
      assert.ok(ids.has(match[1]), `${file} busca #${match[1]}, que no existe`);
    }
  }
});

test('CSP: sin scripts, estilos ni manejadores en línea', () => {
  assert.match(html, /Content-Security-Policy[^>]*script-src 'self'; style-src 'self'/);
  assert.equal(/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), false, 'script en línea');
  assert.equal(/<style[\s>]/i.test(html), false, 'estilo en línea');
  assert.equal(/\sstyle="/i.test(html), false, 'atributo style');
  assert.equal(/\son[a-z]+="/i.test(html), false, 'manejador en línea');
});

// Propiedades que animan los @keyframes (sin contar los selectores de porcentaje).
function keyframeProperties(css) {
  const result = new Map();
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);
    const props = new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]));
    result.set(match[1], props);
  }
  return result;
}

test('Rendimiento: las animaciones infinitas solo mueven opacidad y transformaciones', () => {
  const css = CSS_FILES.map(read).join('\n');
  const keyframes = keyframeProperties(css);
  const infinite = new Set();
  for (const match of css.matchAll(/animation\s*:\s*([^;]+);/g)) {
    for (const part of match[1].split(',')) {
      if (!/\binfinite\b/.test(part)) continue;
      const name = part.trim().split(/\s+/).find((token) => keyframes.has(token));
      if (name) infinite.add(name);
    }
  }
  assert.ok(infinite.size >= 8, 'se esperan las animaciones ambientales del juego');
  for (const name of infinite) {
    const extra = [...keyframes.get(name)].filter((prop) => !['opacity', 'transform'].includes(prop));
    assert.deepEqual(extra, [], `«${name}» anima ${extra.join(', ')}: repintaría la página en cada fotograma`);
  }
});
