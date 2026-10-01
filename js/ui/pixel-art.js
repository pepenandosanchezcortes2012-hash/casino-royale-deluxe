// Motor de pixel art compartido: rejillas de celdas con paleta indexada que se rasterizan una sola
// vez a lienzos (sprites de Canvas 2D) o a trazados SVG de rectángulos (crispEdges). Las figuras
// se rellenan por el centro de cada celda, sin antialiasing, y el contorno y el sombreado se
// calculan sobre la rejilla: nada de degradados, desenfoques ni curvas suaves.

// Desactiva el suavizado al escalar imágenes en un contexto 2D (con los prefijos antiguos).
export function noSmooth(ctx) {
  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.msImageSmoothingEnabled = false;
  return ctx;
}

// Contexto 2D ya preparado para pixel art.
export function pixelContext(canvas, options) {
  return noSmooth(canvas.getContext('2d', options));
}

export class PixelGrid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.cells = new Uint8Array(w * h);
  }

  // Rejilla a partir de filas de texto: cada carácter de `keys` es el índice 1, 2, 3…; el punto
  // (o cualquier carácter ausente) es transparente.
  static parse(rows, keys) {
    const grid = new PixelGrid(Math.max(...rows.map((row) => row.length)), rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) grid.set(x, y, keys.indexOf(row[x]) + 1);
    });
    return grid;
  }

  get(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.cells[y * this.w + x];
  }

  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y * this.w + x] = c;
    return this;
  }

  clone() {
    const copy = new PixelGrid(this.w, this.h);
    copy.cells.set(this.cells);
    return copy;
  }

  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }

  // Elipse rellena por el centro de cada celda (cx, cy en coordenadas de celda, no de píxel).
  ellipse(cx, cy, rx, ry, c, keep = () => true) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1 && keep(x, y)) this.set(x, y, c);
      }
    }
    return this;
  }

  // Polígono relleno (prueba par-impar en el centro de cada celda).
  poly(points, c) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.set(x, y, c);
      }
    }
    return this;
  }

  // Línea de Bresenham de grosor 1.
  line(x0, y0, x1, y1, c) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return this;
  }

  // Sustituye las celdas que cumplen `test(x, y, c)` por lo que devuelva `paint`.
  map(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        const next = fn(x, y, c);
        if (next !== undefined && next !== c) this.cells[y * this.w + x] = next;
      }
    }
    return this;
  }

  // Contorno de 1 celda alrededor de todo lo pintado (vecindad de 4).
  outline(c) {
    const src = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.get(x, y)) continue;
        if (src.get(x - 1, y) || src.get(x + 1, y) || src.get(x, y - 1) || src.get(x, y + 1)) this.set(x, y, c);
      }
    }
    return this;
  }

  // Sombreado por bordes: las celdas de color `base` con hueco arriba (o a la izquierda) se
  // iluminan y las que lo tienen abajo se oscurecen.
  bevel(base, light, dark, empty = (c) => !c) {
    const src = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src.get(x, y) !== base) continue;
        if (empty(src.get(x, y + 1)) || empty(src.get(x, y + 2))) this.set(x, y, dark);
        else if (empty(src.get(x, y - 1)) || empty(src.get(x - 1, y))) this.set(x, y, light);
      }
    }
    return this;
  }

  flipX() {
    const copy = new PixelGrid(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) copy.set(this.w - 1 - x, y, this.get(x, y));
    return copy;
  }

  // Tramos horizontales de un mismo color: [{ x, y, n, c }].
  runs() {
    const out = [];
    for (let y = 0; y < this.h; y++) {
      let x = 0;
      while (x < this.w) {
        const c = this.get(x, y);
        let n = 1;
        while (x + n < this.w && this.get(x + n, y) === c) n++;
        if (c) out.push({ x, y, n, c });
        x += n;
      }
    }
    return out;
  }

  // Lienzo con cada celda a `scale` píxeles (palette[i] es el color del índice i; el 0 no se pinta).
  toCanvas(palette, scale = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = this.w * scale;
    canvas.height = this.h * scale;
    const ctx = pixelContext(canvas);
    let color = '';
    for (const { x, y, n, c } of this.runs()) {
      if (palette[c] !== color) {
        color = palette[c];
        ctx.fillStyle = color;
      }
      ctx.fillRect(x * scale, y * scale, n * scale, scale);
    }
    return canvas;
  }

  // Trazados SVG agrupados por color: [{ fill, d, opacity }].
  toPaths(palette) {
    const groups = new Map();
    for (const { x, y, n, c } of this.runs()) {
      const key = palette[c];
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(`M${x} ${y}h${n}v1h-${n}z`);
    }
    return [...groups].map(([fill, parts]) => ({ ...splitFill(fill), d: parts.join('') }));
  }
}

// «rgba(0,0,0,.4)» y «#fff8» se separan en color y opacidad para el atributo fill de SVG.
function splitFill(fill) {
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(fill);
  if (rgba) return { fill: `rgb(${rgba[1]},${rgba[2]},${rgba[3]})`, opacity: Number(rgba[4]) };
  return { fill, opacity: 1 };
}

// Sprite desde filas de texto y un mapa carácter → color.
export function sprite(rows, colors) {
  const keys = Object.keys(colors).join('');
  const grid = PixelGrid.parse(rows, keys);
  return { grid, palette: [null, ...Object.values(colors)] };
}

// Marcado SVG (como texto, para la herramienta que genera el sprite de index.html).
export function svgMarkup({ grid, palette }) {
  return grid.toPaths(palette)
    .map(({ fill, opacity, d }) => `<path fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''} d="${d}"/>`)
    .join('');
}

// Rejilla de 1 bit (para pruebas y para trazar a mano): '#' pintado, '.' vacío.
export function mask(rows, color = 'currentColor') {
  return sprite(rows, { '#': color });
}
