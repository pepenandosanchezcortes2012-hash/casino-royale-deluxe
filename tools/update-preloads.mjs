// Regenera la lista <link rel="modulepreload"> de index.html a partir de los import estáticos
// que cuelgan de js/app.js, para que el navegador pida todos los módulos a la vez.
//   node tools/update-preloads.mjs      (o: npm run preload)
import { readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

function moduleGraph(entry) {
  const depth = new Map([[entry, 0]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const match of read(file).matchAll(/^import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
      const target = posix.join(posix.dirname(file), match[1]);
      if (!depth.has(target)) {
        depth.set(target, depth.get(file) + 1);
        queue.push(target);
      }
    }
  }
  return [...depth.entries()]
    .filter(([file]) => file !== entry)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([file]) => file);
}

const html = read('index.html');
const newline = html.includes('\r\n') ? '\r\n' : '\n';
const modules = moduleGraph('js/app.js');
const block = modules.map((file) => `  <link rel="modulepreload" href="${file}">`).join(newline);
const pattern = /(  <!-- Precarga[^\n]*-->\r?\n)(?:  <link rel="modulepreload"[^\n]*\r?\n)*/;
if (!pattern.test(html)) throw new Error('No encuentro el bloque de precarga en index.html');
const updated = html.replace(pattern, (_, comment) => `${comment}${block}${newline}`);
writeFileSync(new URL('index.html', root), updated);
console.log(`${modules.length} módulos precargados`);
