// Regenera el sprite SVG de index.html a partir de las rejillas de js/ui/pixel-sprites.js: cada
// sprite pasa a ser un <symbol> hecho solo de rectángulos (trazados M x y h n v1 h-n z) con
// shape-rendering="crispEdges", sin degradados ni curvas.
//   node tools/build-pixel-sprites.mjs          reescribe index.html
//   node tools/build-pixel-sprites.mjs --check  falla si index.html no está al día
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SVG_SPRITES } from '../js/ui/pixel-sprites.js';
import { svgMarkup } from '../js/ui/pixel-art.js';

const INDEX = fileURLToPath(new URL('../index.html', import.meta.url));
const START = '<svg class="sprite" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">';
const PATTERN = /  <svg class="sprite"[^>]*>[\s\S]*?\n  <\/svg>\n/;

export function spriteBlock() {
  const symbols = Object.entries(SVG_SPRITES).map(([id, art]) =>
    `    <symbol id="${id}" viewBox="0 0 ${art.grid.w} ${art.grid.h}" shape-rendering="crispEdges">${svgMarkup(art)}</symbol>`);
  const defs = '    <defs><pattern id="px-card-back" width="20" height="20" patternUnits="userSpaceOnUse"><path fill="#5e0715" d="M0 0h20v20H0z"/><path fill="#7a1020" d="M0 0h10v10H0zM10 10h10v10H10z"/><path fill="#d4af37" d="M9 9h2v2H9z"/></pattern></defs>';
  return `  ${START}\n    <!-- Generado por tools/build-pixel-sprites.mjs: no editar a mano. -->\n${defs}\n${symbols.join('\n')}\n  </svg>\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const html = readFileSync(INDEX, 'utf8');
  if (!PATTERN.test(html)) throw new Error('No se encuentra el sprite SVG en index.html');
  const next = html.replace(PATTERN, spriteBlock());
  if (process.argv.includes('--check')) {
    if (next !== html) {
      console.error('index.html no está al día: ejecuta node tools/build-pixel-sprites.mjs');
      process.exit(1);
    }
    console.log('Sprite SVG al día.');
  } else {
    writeFileSync(INDEX, next);
    console.log(`Sprite SVG regenerado: ${Object.keys(SVG_SPRITES).length} símbolos.`);
  }
}
