// Lluvia de código estilo Matrix para el fondo del Cripto-Casino y del menú.
// Se dibuja en un Web Worker con OffscreenCanvas: el hilo principal no produce fotogramas por ella
// (ni recalcula estilos), así que el fondo animado apenas cuesta. Si el navegador no admite
// OffscreenCanvas, se dibuja en el hilo principal con el mismo pintor (matrix-core.js).
// 15 fotogramas por segundo a media resolución; se detiene con la pestaña oculta, con
// `matrix off` o si el sistema pide reducir el movimiento.

import { RainPainter, FRAME_MS, SCALE } from './matrix-core.js';

export class MatrixRain {
  #canvas;
  #settings;
  #worker = null;
  #painter = null;
  #running = false;
  #timer = 0;
  #reduced;

  constructor(canvas, { settings }) {
    this.#canvas = canvas;
    this.#settings = settings;
    this.#reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
  }

  start() {
    if (!this.#canvas) return;
    const size = this.#size();
    const color = this.#color();
    if (typeof this.#canvas.transferControlToOffscreen === 'function' && typeof Worker === 'function') {
      try {
        const offscreen = this.#canvas.transferControlToOffscreen();
        this.#worker = new Worker(new URL('./matrix-worker.js', import.meta.url), { type: 'module', name: 'matrix-rain' });
        this.#worker.postMessage({ type: 'init', canvas: offscreen, ...size, color }, [offscreen]);
      } catch {
        this.#worker = null;
      }
    }
    if (!this.#worker) {
      const ctx = this.#canvas.getContext('2d');
      if (!ctx) return;
      this.#painter = new RainPainter(ctx);
      this.#painter.color = color;
      this.#painter.resize(size.width, size.height);
    }
    globalThis.addEventListener('resize', () => this.#resize(), { passive: true });
    document.addEventListener('visibilitychange', () => this.#sync());
    this.#settings.addEventListener('change', () => this.#sync());
    this.#reduced.addEventListener?.('change', () => this.#sync());
    this.#sync();
  }

  #size() {
    return { width: Math.ceil(globalThis.innerWidth * SCALE), height: Math.ceil(globalThis.innerHeight * SCALE) };
  }

  #color() {
    return getComputedStyle(document.documentElement).getPropertyValue('--matrix-ink').trim() || '#00ff66';
  }

  #enabled() {
    return this.#settings.matrix && !document.hidden && !this.#reduced.matches;
  }

  #resize() {
    const size = this.#size();
    if (this.#worker) this.#worker.postMessage({ type: 'resize', ...size });
    else this.#painter?.resize(size.width, size.height);
  }

  #sync() {
    const on = this.#enabled();
    const color = this.#color();
    this.#canvas.hidden = !this.#settings.matrix;
    if (this.#worker) {
      this.#worker.postMessage({ type: 'color', color });
      this.#worker.postMessage({ type: 'run', on });
      if (!this.#settings.matrix) this.#worker.postMessage({ type: 'clear' });
      return;
    }
    if (!this.#painter) return;
    this.#painter.color = color;
    clearTimeout(this.#timer);
    this.#running = on;
    if (on) this.#loop();
    else if (!this.#settings.matrix) this.#painter.clear();
  }

  // Respaldo en el hilo principal: un fotograma cada FRAME_MS mientras esté activa.
  #loop = () => {
    if (!this.#running) return;
    this.#painter.draw();
    this.#timer = setTimeout(() => requestAnimationFrame(this.#loop), FRAME_MS);
  };
}
