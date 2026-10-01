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

test('Sonido: sin síntesis de voz ni locuciones en ningún módulo', () => {
  const modules = moduleGraph('js/app.js');
  for (const file of modules) {
    const source = read(file);
    for (const pattern of [/speechSynthesis/, /SpeechSynthesisUtterance/, /\.speak\(/, /audio\.say\(/]) {
      assert.equal(pattern.test(source), false, `${file} usa ${pattern}`);
    }
  }
  assert.equal(/Voz del crupier|snd-voice|sound-dialog/.test(html), false, 'controles de voz en el HTML');
  assert.match(html, /id="btn-music"[^>]*aria-pressed/);
  assert.match(html, /id="btn-sfx"[^>]*aria-pressed/);
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
