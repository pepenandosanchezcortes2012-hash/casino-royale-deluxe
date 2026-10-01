// Utilidades compartidas por los juegos arcade del Cripto-Casino: formato de multiplicadores,
// tiras de resultados recientes, sacudida de pantalla por «trauma», pausas que respetan el modo
// turbo y lienzos nítidos en pantallas de alta densidad.

import { settings } from '../settings.js';
import { el } from './svg.js';
import { noSmooth } from './pixel-art.js';

const fixed2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtMult = (value) => `×${fixed2.format(value)}`;

// Tono visual de un resultado según su multiplicador.
export function outcomeTone(multiplier) {
  if (multiplier >= 10) return 'jackpot';
  if (multiplier >= 2) return 'big';
  if (multiplier >= 1) return 'win';
  return 'loss';
}

export function pushRecent(list, text, tone, limit = 14) {
  const item = el('li', `recent-item is-${tone}`, text);
  list.prepend(item);
  while (list.children.length > limit) list.lastElementChild.remove();
  return item;
}

// Sacudida breve (1 = leve, 3 = explosión). Solo anima transform en la clase de animations.css.
export function trauma(node, level = 1) {
  if (!node) return;
  const name = `is-trauma-${Math.min(3, Math.max(1, level))}`;
  node.classList.remove('is-trauma-1', 'is-trauma-2', 'is-trauma-3');
  void node.offsetWidth;
  node.classList.add(name);
  setTimeout(() => node.classList.remove(name), 650);
}

// Duración ajustada al modo turbo.
export const pace = (ms) => ms * settings.speed;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, pace(ms)));

// Ajusta el lienzo a su tamaño en CSS con `pixel` píxeles CSS por píxel de lienzo (1 o 2): el
// navegador lo amplía con image-rendering: pixelated y el contexto no suaviza al escalar, así que
// todo se ve en bloques nítidos (y se pinta hasta 4 veces menos). Se dibuja en coordenadas CSS.
export function fitCanvas(canvas, aspect, pixel = 1) {
  const width = Math.max(200, canvas.clientWidth || canvas.parentElement?.clientWidth || 320);
  const height = Math.round(width * aspect);
  const dpr = 1 / pixel;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = noSmooth(canvas.getContext('2d'));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height, dpr };
}

// Color de una variable CSS del tema activo.
export const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
