// Web Worker de la lluvia Matrix: dibuja en un OffscreenCanvas fuera del hilo principal, así el
// fondo animado no obliga a la página a producir fotogramas ni a recalcular estilos.
// Mensajes: init { canvas, width, height, color }, resize { width, height }, color { color },
// run { on }, clear.

import { RainPainter, FRAME_MS } from './matrix-core.js';

let painter = null;
let running = false;
let timer = 0;

function loop() {
  clearTimeout(timer);
  if (!running || !painter) return;
  painter.draw();
  timer = setTimeout(loop, FRAME_MS);
}

self.addEventListener('message', ({ data }) => {
  switch (data?.type) {
    case 'init':
      painter = new RainPainter(data.canvas.getContext('2d'));
      painter.color = data.color;
      painter.resize(data.width, data.height);
      break;
    case 'resize':
      painter?.resize(data.width, data.height);
      break;
    case 'color':
      if (painter) painter.color = data.color;
      break;
    case 'run':
      running = Boolean(data.on);
      loop();
      break;
    case 'clear':
      painter?.clear();
      break;
    default:
      break;
  }
});
