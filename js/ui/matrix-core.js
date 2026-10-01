// Pintor de la lluvia de código estilo Matrix, sin DOM: lo usan el Web Worker (OffscreenCanvas)
// y, si el navegador no lo admite, el hilo principal. Cada fotograma oscurece un poco lo anterior
// (estela) y escribe un carácter por columna.

import { randomFloat } from '../engine/rng.js';

export const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ0123456789ABCDEF$#<>=+*';
export const FRAME_MS = 66;
export const CELL = 9;
export const MAX_COLUMNS = 80;
// El lienzo trabaja a media resolución y el CSS lo estira (con la opacidad del fondo no se nota).
export const SCALE = 0.5;

export class RainPainter {
  #ctx;
  #columns = [];
  #width = 0;
  #height = 0;
  color = '#00ff66';

  constructor(ctx) {
    this.#ctx = ctx;
  }

  resize(width, height) {
    this.#width = Math.max(1, Math.ceil(width));
    this.#height = Math.max(1, Math.ceil(height));
    this.#ctx.canvas.width = this.#width;
    this.#ctx.canvas.height = this.#height;
    // Pixel art: sin suavizado (cambiar el tamaño reinicia el contexto). Vale también en el worker.
    this.#ctx.imageSmoothingEnabled = false;
    this.#ctx.webkitImageSmoothingEnabled = false;
    this.#ctx.mozImageSmoothingEnabled = false;
    this.#ctx.msImageSmoothingEnabled = false;
    const count = Math.min(MAX_COLUMNS, Math.ceil(this.#width / CELL));
    const step = this.#width / count;
    this.#columns = Array.from({ length: count }, (_, i) => ({
      x: i * step + step / 2,
      y: randomFloat() * this.#height,
      speed: 0.35 + randomFloat() * 0.9,
    }));
    this.#ctx.font = `${CELL - 2}px ui-monospace, Consolas, monospace`;
    this.#ctx.textAlign = 'center';
  }

  clear() {
    this.#ctx.clearRect(0, 0, this.#width, this.#height);
  }

  draw() {
    const ctx = this.#ctx;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, 0, this.#width, this.#height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.color;
    for (const column of this.#columns) {
      ctx.fillText(GLYPHS[(randomFloat() * GLYPHS.length) | 0], column.x, column.y);
      column.y += CELL * column.speed;
      if (column.y > this.#height + CELL && randomFloat() > 0.96) column.y = -CELL * (1 + randomFloat() * 10);
    }
  }
}
