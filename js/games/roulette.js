// Ruleta Francesa/Europea de un solo cero: 37 casillas en el orden físico real del plato.
// Tapete clásico + racetrack con apuestas anunciadas (Voisins, Tiers, Orphelins, Jeu Zéro y
// vecinos). Toda apuesta, simple o anunciada, tiene ventaja de la casa 1 − 36/37 = 2,7027 %.

import { randomInt, randomFloat, randomBetween } from '../engine/rng.js';
import { Store, PHASE, wait } from '../engine/store.js';
import { wallet, money } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { hud, formatChips } from '../ui/hud.js';
import { chipSvg, breakdown, el, svg, svgText } from '../ui/svg.js';
import { bindRemoveGesture } from '../ui/input.js';

export const WHEEL_ORDER = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]);
export const POCKETS = 37;
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const SPOT_MAX = 2500;
export const TABLE_MAX = 20000;

const SAVE_KEY = 'crd.roulette.v1';
const PREFS_KEY = 'crd.roulette.prefs.v1';
const HISTORY_LIMIT = 500;
const STATS_WINDOW = 100;

export const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const COLOR_NAME = { red: 'Rojo', black: 'Negro', green: 'Verde' };

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const OUTSIDE = {
  red: { label: 'Rojo', numbers: () => [...RED] },
  black: { label: 'Negro', numbers: () => range(1, 36).filter((n) => !RED.has(n)) },
  even: { label: 'Par', numbers: () => range(1, 36).filter((n) => n % 2 === 0) },
  odd: { label: 'Impar', numbers: () => range(1, 36).filter((n) => n % 2 === 1) },
  low: { label: '1 a 18', numbers: () => range(1, 18) },
  high: { label: '19 a 36', numbers: () => range(19, 36) },
};

const INSIDE_SIZE = { straight: 1, split: 2, street: 3, corner: 4 };
const INSIDE_LABEL = { straight: 'Pleno', split: 'Dividida', street: 'Calle', corner: 'Cuadro' };

// Traduce una clave de apuesta ("split:1-4", "street:0-2-3", "dozen:2", "red"…) a números y pago.
export function betDefinition(key) {
  const [type, arg] = key.split(':');
  if (type in INSIDE_SIZE) {
    const numbers = arg.split('-').map(Number);
    if (numbers.length !== INSIDE_SIZE[type] || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 36)) {
      throw new Error(`Apuesta inválida: ${key}`);
    }
    const name = type === 'street' && numbers.includes(0) ? 'Trío' : INSIDE_LABEL[type];
    return { key, type, numbers, pays: 36 / numbers.length - 1, label: `${name} ${numbers.join('/')}` };
  }
  if (type === 'dozen' || type === 'column') {
    const n = Number(arg);
    if (![1, 2, 3].includes(n)) throw new Error(`Apuesta inválida: ${key}`);
    const numbers = type === 'dozen' ? range(12 * (n - 1) + 1, 12 * n) : range(1, 36).filter((x) => x % 3 === n % 3);
    return { key, type, numbers, pays: 2, label: type === 'dozen' ? `${n}ª docena` : `Columna ${n}` };
  }
  if (type in OUTSIDE) {
    return { key, type, numbers: OUTSIDE[type].numbers(), pays: 1, label: OUTSIDE[type].label };
  }
  throw new Error(`Apuesta desconocida: ${key}`);
}

// Importe total devuelto (apuesta + ganancia) para un número ganador.
export function payoutFor(bets, number) {
  let total = 0;
  for (const [key, amount] of Object.entries(bets)) {
    const def = betDefinition(key);
    if (def.numbers.includes(number)) total += amount * (def.pays + 1);
  }
  return money(total);
}

export function houseEdgeOf(key) {
  const def = betDefinition(key);
  return 1 - (def.numbers.length / POCKETS) * (def.pays + 1);
}

// ---------- Apuestas anunciadas (racetrack) ----------

// Reparto clásico de fichas de cada sector francés (en unidades de ficha).
export const CALL_BETS = Object.freeze({
  voisins: Object.freeze({
    name: 'Voisins du Zéro',
    parts: [['street:0-2-3', 2], ['split:4-7', 1], ['split:12-15', 1], ['split:18-21', 1], ['split:19-22', 1], ['corner:25-26-28-29', 2], ['split:32-35', 1]],
  }),
  tiers: Object.freeze({
    name: 'Tiers du Cylindre',
    parts: [['split:5-8', 1], ['split:10-11', 1], ['split:13-16', 1], ['split:23-24', 1], ['split:27-30', 1], ['split:33-36', 1]],
  }),
  orphelins: Object.freeze({
    name: 'Orphelins',
    parts: [['straight:1', 1], ['split:6-9', 1], ['split:14-17', 1], ['split:17-20', 1], ['split:31-34', 1]],
  }),
  zero: Object.freeze({
    name: 'Jeu Zéro',
    parts: [['split:0-3', 1], ['split:12-15', 1], ['straight:26', 1], ['split:32-35', 1]],
  }),
});

export function sectorNumbers(sector) {
  const numbers = new Set();
  for (const [key] of CALL_BETS[sector].parts) for (const n of betDefinition(key).numbers) numbers.add(n);
  return [...numbers];
}

// Vecinos en el plato: el número y `count` casillas a cada lado.
export function neighborsOf(number, count) {
  const index = WHEEL_ORDER.indexOf(number);
  if (index < 0) throw new Error(`Número inválido: ${number}`);
  return Array.from({ length: count * 2 + 1 }, (_, i) => WHEEL_ORDER[(index - count + i + POCKETS) % POCKETS]);
}

// Descompone una apuesta anunciada en apuestas del tapete ({ key, amount }).
export function callBetParts(call, unit) {
  if (call.type === 'neighbors') {
    return neighborsOf(call.number, call.count).map((n) => ({ key: `straight:${n}`, amount: unit }));
  }
  const def = CALL_BETS[call.type];
  if (!def) throw new Error(`Apuesta anunciada desconocida: ${call.type}`);
  return def.parts.map(([key, units]) => ({ key, amount: units * unit }));
}

export function callBetLabel(call) {
  return call.type === 'neighbors' ? `${call.number} y ${call.count} vecinos` : CALL_BETS[call.type].name;
}

// ---------- Geometría del tapete ----------

// Columna c (0..11) y fila r (0 = arriba) → número.
const numberAt = (c, r) => 3 * (c + 1) - r;

export function boardSpots() {
  const spots = [{ key: 'straight:0', kind: 'zero' }];
  for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) spots.push({ key: `straight:${numberAt(c, r)}`, kind: 'number', c, r });
  // Divididas y tríos con el cero, sobre la línea entre el 0 y la primera columna.
  spots.push(
    { key: 'split:0-3', kind: 'hot', x: 0, y: 1 / 6 },
    { key: 'street:0-2-3', kind: 'hot', x: 0, y: 1 / 3 },
    { key: 'split:0-2', kind: 'hot', x: 0, y: 1 / 2 },
    { key: 'street:0-1-2', kind: 'hot', x: 0, y: 2 / 3 },
    { key: 'split:0-1', kind: 'hot', x: 0, y: 5 / 6 },
  );
  for (let c = 0; c < 11; c++) {
    for (let r = 0; r < 3; r++) {
      const n = numberAt(c, r);
      spots.push({ key: `split:${n}-${n + 3}`, kind: 'hot', x: (c + 1) / 12, y: (r + 0.5) / 3 });
    }
  }
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 2; r++) {
      const n = numberAt(c, r);
      spots.push({ key: `split:${n - 1}-${n}`, kind: 'hot', x: (c + 0.5) / 12, y: (r + 1) / 3 });
    }
  }
  for (let c = 0; c < 11; c++) {
    for (let r = 0; r < 2; r++) {
      const n = numberAt(c, r);
      spots.push({ key: `corner:${n - 1}-${n}-${n + 2}-${n + 3}`, kind: 'hot', x: (c + 1) / 12, y: (r + 1) / 3 });
    }
  }
  for (let c = 0; c < 12; c++) spots.push({ key: `street:${3 * c + 1}-${3 * c + 2}-${3 * c + 3}`, kind: 'hot', x: (c + 0.5) / 12, y: 1 });
  return spots;
}

// ---------- Plato en Canvas con cámara balística ----------

const SEG = (Math.PI * 2) / POCKETS;
const IDLE_OMEGA = 0.32;
const TAU = Math.PI * 2;
const ZOOM = 1.9;
const mod = (a, m) => ((a % m) + m) % m;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

class WheelRenderer {
  #canvas;
  #ctx;
  #css = 0;
  #px = 0;
  #layers = null;
  #wheel = { base: 0, t0: 0, w0: IDLE_OMEGA, k: 0.35 };
  #ball = { mode: 'hidden', angle: 0, radius: 0, index: 0 };
  #spin = null;
  #highlight = null;
  #visible = false;
  #running = false;
  #cam = { x: 0, y: 0, s: 1 };
  #camTime = 0;
  #zoomUntil = 0;
  #reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#wheel.t0 = performance.now();
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas.parentElement);
  }

  #wheelAngle(now) {
    const t = (now - this.#wheel.t0) / 1000;
    const { base, w0, k } = this.#wheel;
    return base + IDLE_OMEGA * t + ((w0 - IDLE_OMEGA) / k) * (1 - Math.exp(-k * t));
  }

  #wheelVelocity(now) {
    const t = (now - this.#wheel.t0) / 1000;
    return IDLE_OMEGA + (this.#wheel.w0 - IDLE_OMEGA) * Math.exp(-this.#wheel.k * t);
  }

  resize() {
    const box = this.#canvas.parentElement.clientWidth;
    if (!box) return;
    const css = Math.round(Math.min(box - 12, 460));
    if (css <= 0 || css === this.#css) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.#css = css;
    this.#px = Math.round(css * dpr);
    this.#canvas.width = this.#px;
    this.#canvas.height = this.#px;
    this.#canvas.style.width = `${css}px`;
    this.#canvas.style.height = `${css}px`;
    this.#cam = { x: this.#px / 2, y: this.#px / 2, s: 1 };
    this.#layers = this.#buildLayers(this.#px);
    this.#draw(performance.now());
  }

  setVisible(visible) {
    this.#visible = visible;
    if (visible) {
      this.resize();
      this.#loop();
    }
  }

  restAt(number) {
    this.#ball = { mode: 'pocket', index: WHEEL_ORDER.indexOf(number), angle: 0, radius: 0 };
  }

  #loop() {
    if (this.#running) return;
    this.#running = true;
    this.#camTime = performance.now();
    requestAnimationFrame(this.#frame);
  }

  #frame = (now) => {
    if (!this.#visible && !this.#spin) {
      this.#running = false;
      return;
    }
    this.#update(now);
    this.#updateCamera(now);
    this.#draw(now);
    requestAnimationFrame(this.#frame);
  };

  // Plan del lanzamiento: el número ya está sorteado; la física se resuelve en forma cerrada
  // para que la bola, desacelerando por fricción, caiga exactamente en esa casilla.
  spin(number) {
    const now = performance.now();
    const index = WHEEL_ORDER.indexOf(number);
    this.#wheel = { base: this.#wheelAngle(now), t0: now, w0: randomBetween(3.4, 4.2), k: 0.34 };
    const T1 = randomBetween(4.4, 5.0);
    const T2 = 2.9;
    const A = randomBetween(-0.85, 0.85);
    const target = index * SEG;
    const start = randomFloat() * TAU;
    const wheelAtDrop = this.#wheelAngle(now + T1 * 1000);
    const needed = wheelAtDrop + target + A;
    const distance = mod(start - needed, TAU) + TAU * 6;
    const vEnd = 2.1;
    const v0 = (2 * distance) / T1 - vEnd;
    const decel = (v0 - vEnd) / T1;
    const lambda = 1.9;
    const omega = 5.4;
    const vRel = -vEnd - this.#wheelVelocity(now + T1 * 1000);
    const B = (vRel + lambda * A) / omega;
    this.#highlight = null;
    this.#zoomUntil = 0;
    audio.ballRoll(T1);
    return new Promise((resolve) => {
      this.#spin = { t0: now, T1, T2, start, v0, decel, target, A, B, lambda, omega, index, resolve, pocket: null };
      this.#ball.mode = 'spin';
      this.#loop();
    });
  }

  #update(now) {
    const sp = this.#spin;
    if (!sp) return;
    const R = this.#px / 2;
    const rTrack = R * 0.862;
    const rPocket = R * 0.585;
    const t = (now - sp.t0) / 1000;

    if (t < sp.T1) {
      // Fase 1: la bola orbita en la pista con desaceleración constante (fricción de rodadura).
      this.#ball.angle = sp.start - (sp.v0 * t - 0.5 * sp.decel * t * t);
      this.#ball.radius = rTrack * (1 + 0.004 * Math.sin(t * 23));
      return;
    }
    if (t < sp.T1 + sp.T2) {
      // Fase 2: cae del borde y rebota balísticamente entre trastes: oscilador amortiguado
      // en el marco del plato con posición y velocidad continuas respecto a la fase 1.
      const tau = t - sp.T1;
      const env = Math.exp(-sp.lambda * tau);
      const rel = sp.target + env * (sp.A * Math.cos(sp.omega * tau) + sp.B * Math.sin(sp.omega * tau));
      this.#ball.angle = rel + this.#wheelAngle(now);
      const fall = Math.min(1, tau / 0.55);
      const hop = R * 0.05 * Math.exp(-3.1 * tau) * Math.abs(Math.sin(11 * tau));
      this.#ball.radius = rPocket + (rTrack - rPocket) * (1 - fall * fall) + hop;
      const pocket = Math.round(mod(rel, TAU) / SEG) % POCKETS;
      if (sp.pocket !== null && pocket !== sp.pocket) audio.ballTick(Math.min(1, env * 1.6 + 0.2));
      sp.pocket = pocket;
      return;
    }
    this.#ball = { mode: 'pocket', index: sp.index, angle: 0, radius: 0 };
    this.#highlight = { index: sp.index, since: now };
    this.#zoomUntil = now + 2300;
    audio.ballTick(0.8);
    this.#spin = null;
    sp.resolve();
  }

  #ballPosition(now) {
    const R = this.#px / 2;
    let angle = this.#ball.angle;
    let radius = this.#ball.radius;
    if (this.#ball.mode === 'pocket') {
      angle = this.#wheelAngle(now) + this.#ball.index * SEG;
      radius = R * 0.585;
    }
    return { x: R + Math.cos(angle - Math.PI / 2) * radius, y: R + Math.sin(angle - Math.PI / 2) * radius };
  }

  // Zoom balístico: al entrar la bola en la desaceleración final la cámara se acerca al sector
  // donde cae, la sigue durante los rebotes y se aleja tras mostrar el número.
  #updateCamera(now) {
    const R = this.#px / 2;
    let scale = 1;
    let fx = R;
    let fy = R;
    if (!this.#reduced.matches && this.#ball.mode !== 'hidden') {
      const ball = this.#ballPosition(now);
      let k = 0;
      if (this.#spin) {
        const t = (now - this.#spin.t0) / 1000;
        k = smoothstep(this.#spin.T1 - 0.9, this.#spin.T1 + 0.35, t);
      } else if (now < this.#zoomUntil) {
        k = 1;
      }
      scale = 1 + (ZOOM - 1) * k;
      fx = R + (ball.x - R) * k;
      fy = R + (ball.y - R) * k;
      const limit = R - R / scale;
      const dx = fx - R;
      const dy = fy - R;
      const distance = Math.hypot(dx, dy);
      if (distance > limit && distance > 0) {
        fx = R + (dx / distance) * limit;
        fy = R + (dy / distance) * limit;
      }
    }
    const dt = Math.min(0.05, Math.max(0, (now - this.#camTime) / 1000));
    this.#camTime = now;
    const blend = 1 - Math.exp(-dt * 6.5);
    const cam = this.#cam;
    cam.s += (scale - cam.s) * blend;
    cam.x += (fx - cam.x) * blend;
    cam.y += (fy - cam.y) * blend;
  }

  #buildLayers(size) {
    const R = size / 2;
    const make = (quality) => {
      const canvas = document.createElement('canvas');
      const pixels = Math.min(2048, Math.round(size * quality));
      canvas.width = pixels;
      canvas.height = pixels;
      const ctx = canvas.getContext('2d');
      const q = pixels / size;
      ctx.setTransform(q, 0, 0, q, R * q, R * q);
      return { canvas, ctx };
    };

    // Cuenco estático: madera, pista de la bola pulida y deflectores.
    const bowl = make(1.5);
    let g = bowl.ctx;
    let grad = g.createRadialGradient(0, 0, R * 0.7, 0, 0, R);
    grad.addColorStop(0, '#4a240b');
    grad.addColorStop(0.6, '#6b3814');
    grad.addColorStop(1, '#2a1205');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, R * 0.995, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255, 220, 160, 0.06)';
    for (let i = 0; i < 9; i++) {
      g.lineWidth = R * 0.004;
      g.beginPath();
      g.arc(0, 0, R * (0.94 + i * 0.006), 0, TAU);
      g.stroke();
    }
    g.lineWidth = R * 0.014;
    g.strokeStyle = '#c9a23a';
    g.beginPath();
    g.arc(0, 0, R * 0.935, 0, TAU);
    g.stroke();
    grad = g.createRadialGradient(0, 0, R * 0.78, 0, 0, R * 0.93);
    grad.addColorStop(0, '#120904');
    grad.addColorStop(0.45, '#3b2312');
    grad.addColorStop(0.8, '#5a3a20');
    grad.addColorStop(1, '#1a0d05');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, R * 0.928, 0, TAU);
    g.arc(0, 0, R * 0.79, 0, TAU, true);
    g.fill();
    g.strokeStyle = 'rgba(255, 240, 210, 0.18)';
    g.lineWidth = R * 0.006;
    g.beginPath();
    g.arc(0, 0, R * 0.9, -2.4, -0.9);
    g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + SEG / 2;
      g.save();
      g.rotate(a);
      g.translate(0, -R * 0.815);
      g.fillStyle = '#e8c25a';
      g.strokeStyle = '#7a5a14';
      g.lineWidth = R * 0.004;
      g.beginPath();
      if (i % 2) {
        g.moveTo(0, -R * 0.022);
        g.lineTo(R * 0.012, 0);
        g.lineTo(0, R * 0.022);
        g.lineTo(-R * 0.012, 0);
      } else {
        g.moveTo(-R * 0.022, 0);
        g.lineTo(0, -R * 0.012);
        g.lineTo(R * 0.022, 0);
        g.lineTo(0, R * 0.012);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }

    // Rotor en alta resolución (nítido durante el zoom): casillas, trastes y torreta.
    const rotor = make(2);
    g = rotor.ctx;
    const rOut = R * 0.785;
    const rNum = R * 0.665;
    const rIn = R * 0.52;
    const fills = { red: ['#c1121f', '#7d0a14'], black: ['#16181b', '#060708'], green: ['#0e8f47', '#06502a'] };
    for (let i = 0; i < POCKETS; i++) {
      const n = WHEEL_ORDER[i];
      const [bright, dark] = fills[colorOf(n)];
      const a0 = i * SEG - SEG / 2 - Math.PI / 2;
      const a1 = a0 + SEG;
      g.fillStyle = bright;
      g.beginPath();
      g.arc(0, 0, rOut, a0, a1);
      g.arc(0, 0, rNum, a1, a0, true);
      g.closePath();
      g.fill();
      const pocketGrad = g.createRadialGradient(0, 0, rIn, 0, 0, rNum);
      pocketGrad.addColorStop(0, dark);
      pocketGrad.addColorStop(1, bright);
      g.fillStyle = pocketGrad;
      g.beginPath();
      g.arc(0, 0, rNum, a0, a1);
      g.arc(0, 0, rIn, a1, a0, true);
      g.closePath();
      g.fill();
      g.save();
      g.rotate(i * SEG);
      g.fillStyle = '#fdf6e3';
      g.font = `700 ${Math.round(R * 0.068)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(n), 0, -(rNum + rOut) / 2);
      g.restore();
    }
    g.strokeStyle = '#d9d4c7';
    g.lineWidth = R * 0.007;
    for (let i = 0; i < POCKETS; i++) {
      const a = i * SEG - SEG / 2 - Math.PI / 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * rIn, Math.sin(a) * rIn);
      g.lineTo(Math.cos(a) * rOut, Math.sin(a) * rOut);
      g.stroke();
    }
    g.strokeStyle = '#d4af37';
    for (const r of [rOut, rNum, rIn]) {
      g.lineWidth = r === rNum ? R * 0.006 : R * 0.012;
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.stroke();
    }
    grad = g.createRadialGradient(-R * 0.12, -R * 0.12, R * 0.05, 0, 0, rIn);
    grad.addColorStop(0, '#9a6232');
    grad.addColorStop(0.6, '#5c3314');
    grad.addColorStop(1, '#2e1706');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, rIn - R * 0.006, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(212, 175, 55, 0.55)';
    g.lineWidth = R * 0.004;
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2 + Math.PI / 4);
      g.beginPath();
      g.moveTo(0, -R * 0.12);
      g.quadraticCurveTo(R * 0.06, -R * 0.3, 0, -R * 0.47);
      g.quadraticCurveTo(-R * 0.06, -R * 0.3, 0, -R * 0.12);
      g.stroke();
      g.restore();
    }
    const gold = g.createLinearGradient(-R * 0.2, -R * 0.2, R * 0.2, R * 0.2);
    gold.addColorStop(0, '#fff3b0');
    gold.addColorStop(0.5, '#d4af37');
    gold.addColorStop(1, '#7a5a14');
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2);
      g.fillStyle = gold;
      g.fillRect(-R * 0.018, -R * 0.24, R * 0.036, R * 0.2);
      g.beginPath();
      g.arc(0, -R * 0.25, R * 0.035, 0, TAU);
      g.fill();
      g.restore();
    }
    const dome = g.createRadialGradient(-R * 0.03, -R * 0.03, R * 0.01, 0, 0, R * 0.08);
    dome.addColorStop(0, '#fffbe0');
    dome.addColorStop(0.5, '#e0b943');
    dome.addColorStop(1, '#6b4c0e');
    g.fillStyle = dome;
    g.beginPath();
    g.arc(0, 0, R * 0.08, 0, TAU);
    g.fill();

    // Brillo especular fijo (no gira con el rotor).
    const glare = make(1);
    g = glare.ctx;
    grad = g.createLinearGradient(-R, -R, R * 0.4, R * 0.4);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.16)');
    grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.02)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, R * 0.93, 0, TAU);
    g.fill();

    return { bowl: bowl.canvas, rotor: rotor.canvas, glare: glare.canvas };
  }

  #draw(now) {
    if (!this.#layers) return;
    const ctx = this.#ctx;
    const size = this.#px;
    const R = size / 2;
    const wheel = this.#wheelAngle(now);
    const { s, x, y } = this.#cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.setTransform(s, 0, 0, s, R - x * s, R - y * s);
    ctx.drawImage(this.#layers.bowl, 0, 0, size, size);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(wheel);
    ctx.drawImage(this.#layers.rotor, -R, -R, size, size);
    if (this.#highlight) {
      const pulse = 0.55 + 0.45 * Math.sin((now - this.#highlight.since) / 160);
      const a0 = this.#highlight.index * SEG - SEG / 2 - Math.PI / 2;
      ctx.strokeStyle = `rgba(255, 226, 120, ${pulse})`;
      ctx.lineWidth = R * 0.02;
      ctx.shadowColor = '#ffd76a';
      ctx.shadowBlur = R * 0.06;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.8, a0, a0 + SEG);
      ctx.arc(0, 0, R * 0.52, a0 + SEG, a0, true);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    ctx.drawImage(this.#layers.glare, 0, 0, size, size);

    if (this.#ball.mode !== 'hidden') {
      const { x: bx, y: by } = this.#ballPosition(now);
      const br = R * 0.03;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(bx + br * 0.35, by + br * 0.45, br, br * 0.8, 0, 0, TAU);
      ctx.fill();
      const shine = ctx.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.1, bx, by, br);
      shine.addColorStop(0, '#ffffff');
      shine.addColorStop(0.55, '#e9e9ec');
      shine.addColorStop(1, '#8d9096');
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fill();
    }

    // Viñeta cinematográfica proporcional al zoom.
    const zoomed = (s - 1) / (ZOOM - 1);
    if (zoomed > 0.02) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const vignette = ctx.createRadialGradient(R, R, R * 0.55, R, R, R * 1.05);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, `rgba(0, 0, 0, ${0.6 * zoomed})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, size, size);
    }
  }
}

// ---------- Racetrack (SVG) ----------

const TRACK = { cx: 500, cy: 160, a: 350, r: 110, band: 62 };
const TRACK_LENGTH = 4 * TRACK.a + 2 * Math.PI * TRACK.r;
const CELL = TRACK_LENGTH / POCKETS;
const TRACK_START = 2 * TRACK.a + (Math.PI * TRACK.r) / 2;

// Punto del óvalo a una distancia s del centro de la pista, desplazado `offset` hacia fuera.
function trackPoint(s, offset) {
  const { cx, cy, a, r } = TRACK;
  let t = mod(s, TRACK_LENGTH);
  const rr = r + offset;
  if (t < 2 * a) return [cx - a + t, cy + rr];
  t -= 2 * a;
  if (t < Math.PI * r) {
    const angle = Math.PI / 2 - t / r;
    return [cx + a + rr * Math.cos(angle), cy + rr * Math.sin(angle)];
  }
  t -= Math.PI * r;
  if (t < 2 * a) return [cx + a - t, cy - rr];
  t -= 2 * a;
  const angle = -Math.PI / 2 - t / r;
  return [cx - a + rr * Math.cos(angle), cy + rr * Math.sin(angle)];
}

const trackS = (k) => TRACK_START + k * CELL;

function arcPoints(from, to, offset, steps) {
  const points = [];
  for (let i = 0; i <= steps; i++) points.push(trackPoint(from + ((to - from) * i) / steps, offset));
  return points;
}

const pathOf = (points) => `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;

class Racetrack {
  #svg;
  #cells = new Map();
  #sectors = new Map();

  constructor(svgElement, { onNumber, onSector, onPreview }) {
    this.#svg = svgElement;
    const inner = -TRACK.band / 2;
    const outer = TRACK.band / 2;

    const base = svg('path', { class: 'rt-base', d: pathOf([...arcPoints(0, TRACK_LENGTH, outer + 8, 120)]) });
    const sectorsLayer = svg('g', { class: 'rt-sectors' });
    const regions = {
      tiers: [...arcPoints(trackS(10.5), trackS(22.5), inner, 40)],
      orphelins: [...arcPoints(trackS(22.5), trackS(27.5), inner, 8), ...arcPoints(trackS(7.5), trackS(10.5), inner, 6)],
      voisins: [...arcPoints(trackS(27.5), trackS(32.5), inner, 8), ...arcPoints(trackS(37 + 2.5), trackS(37 + 7.5), inner, 16)],
      zero: [...arcPoints(trackS(32.5), trackS(37 + 2.5), inner, 30)],
    };
    const labels = { tiers: 'TIER', orphelins: 'ORPHELINS', voisins: 'VOISINS', zero: 'ZERO' };
    for (const [sector, points] of Object.entries(regions)) {
      const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
      const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
      const group = svg('g', { class: `rt-sector is-${sector}`, role: 'button', tabindex: '0', 'aria-label': `${CALL_BETS[sector].name}: ${CALL_BETS[sector].parts.reduce((n, [, u]) => n + u, 0)} fichas` });
      group.dataset.sector = sector;
      group.append(svg('path', { d: pathOf(points) }), svgText(labels[sector], { x: cx.toFixed(1), y: (cy + 7).toFixed(1), 'text-anchor': 'middle' }));
      sectorsLayer.append(group);
      this.#sectors.set(sector, group);
    }

    const cellsLayer = svg('g', { class: 'rt-cells' });
    WHEEL_ORDER.forEach((number, i) => {
      const from = trackS(i - 0.5);
      const to = trackS(i + 0.5);
      const points = [...arcPoints(from, to, outer, 6), ...arcPoints(to, from, inner, 6)];
      const [tx, ty] = trackPoint(trackS(i), 0);
      const group = svg('g', { class: `rt-cell is-${colorOf(number)}`, role: 'button', tabindex: '0', 'aria-label': `${number} con vecinos` });
      group.dataset.number = String(number);
      group.append(
        svg('path', { d: pathOf(points) }),
        svgText(String(number), { x: tx.toFixed(1), y: (ty + 8).toFixed(1), 'text-anchor': 'middle' }),
      );
      cellsLayer.append(group);
      this.#cells.set(number, group);
    });

    this.#svg.append(base, sectorsLayer, cellsLayer);

    const activate = (target) => {
      if (target.dataset.number !== undefined) onNumber(Number(target.dataset.number));
      else if (target.dataset.sector) onSector(target.dataset.sector);
    };
    this.#svg.addEventListener('click', (event) => {
      const target = event.target.closest('[data-number], [data-sector]');
      if (target) activate(target);
    });
    this.#svg.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target.closest('[data-number], [data-sector]');
      if (!target) return;
      event.preventDefault();
      activate(target);
    });
    const preview = (event, on) => {
      const target = event.target.closest?.('[data-number], [data-sector]');
      if (target) onPreview(target, on);
    };
    this.#svg.addEventListener('pointerover', (event) => preview(event, true));
    this.#svg.addEventListener('pointerout', (event) => preview(event, false));
    this.#svg.addEventListener('focusin', (event) => preview(event, true));
    this.#svg.addEventListener('focusout', (event) => preview(event, false));
  }

  preview(numbers, on) {
    for (const n of numbers) this.#cells.get(n)?.classList.toggle('is-preview', on);
  }

  update({ covered, result, locked }) {
    for (const [n, cell] of this.#cells) {
      cell.classList.toggle('has-bet', covered.has(n));
      cell.classList.toggle('is-result', n === result);
    }
    this.#svg.classList.toggle('is-locked', locked);
  }
}

// ---------- Mesa ----------

function sanitizeBets(raw) {
  const bets = {};
  if (!raw || typeof raw !== 'object') return bets;
  for (const [key, amount] of Object.entries(raw)) {
    try {
      betDefinition(key);
      if (typeof amount === 'number' && amount > 0) bets[key] = amount;
    } catch {
      // Clave corrupta: se descarta.
    }
  }
  return bets;
}

function sanitizeCalls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((call) => call && typeof call.label === 'string' && typeof call.total === 'number' && Array.isArray(call.keys))
    .map((call, i) => ({ id: i + 1, label: call.label, total: call.total, keys: call.keys.filter((key) => typeof key === 'string') }));
}

function loadSaved() {
  const saved = storage.read(SAVE_KEY, null);
  const history = Array.isArray(saved?.history) ? saved.history.filter((n) => Number.isInteger(n) && n >= 0 && n <= 36).slice(0, HISTORY_LIMIT) : [];
  return { history, lastBets: sanitizeBets(saved?.lastBets), lastCalls: sanitizeCalls(saved?.lastCalls) };
}

function loadPrefs() {
  const saved = storage.read(PREFS_KEY, null) ?? {};
  return {
    view: saved.view === 'track' ? 'track' : 'table',
    neighbors: [1, 2, 3].includes(saved.neighbors) ? saved.neighbors : 2,
  };
}

export class RouletteGame {
  #store;
  #dom;
  #wheel;
  #track;
  #spots = new Map();
  #cells = new Map();
  #undo = [];
  #callSeq = 0;
  #prefs = loadPrefs();
  #visible = false;
  #invite = 0;

  constructor(root) {
    this.root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      board: $('rl-board'),
      boardWrap: $('rl-board-wrap'),
      trackWrap: $('rl-track-wrap'),
      track: $('rl-track'),
      viewTable: $('rl-view-table'),
      viewTrack: $('rl-view-track'),
      neighbors: $('rl-neighbors'),
      calls: $('rl-calls'),
      result: $('rl-result'),
      history: $('rl-history'),
      hot: $('rl-hot'),
      cold: $('rl-cold'),
      freq: $('rl-freq'),
      sample: $('rl-sample'),
      message: $('rl-message'),
      total: $('rl-total'),
      undo: $('rl-undo'),
      clear: $('rl-clear'),
      rebet: $('rl-rebet'),
      rebet2: $('rl-rebet2'),
      double: $('rl-double'),
      spin: $('rl-spin'),
      rack: $('rl-rack'),
    };
    const { history, lastBets, lastCalls } = loadSaved();
    this.#callSeq = lastCalls.length;
    this.#store = new Store('roulette', {
      phase: PHASE.IDLE,
      busy: false,
      bets: {},
      calls: [],
      lastBets,
      lastCalls,
      history,
      result: history.length ? history[0] : null,
      message: 'Selecciona una ficha y colócala en el tapete o en el racetrack',
    });
    this.#wheel = new WheelRenderer($('rl-wheel'));
    if (history.length) this.#wheel.restAt(history[0]);

    this.#buildBoard();
    this.#track = new Racetrack(this.#dom.track, {
      onNumber: (n) => this.placeCall({ type: 'neighbors', number: n, count: this.#prefs.neighbors }),
      onSector: (sector) => this.placeCall({ type: sector }),
      onPreview: (target, on) => this.#previewTrack(target, on),
    });
    this.#bind();
    this.#store.subscribe((state, prev) => this.#render(state, prev));
    wallet.addEventListener('change', () => this.#renderControls(this.state));
    this.#render(this.state, null);
    this.#renderStats(this.state.history);
    this.#renderView();
  }

  get state() {
    return this.#store.state;
  }

  #set(action, patch) {
    return this.#store.commit(action, patch);
  }

  #persist(history, lastBets, lastCalls) {
    storage.write(SAVE_KEY, { history, lastBets, lastCalls });
  }

  // ---------- Tapete ----------

  #buildBoard() {
    const board = this.#dom.board;
    const spot = (key, className, text) => {
      const def = betDefinition(key);
      const button = el('button', `rb-spot ${className}`);
      button.type = 'button';
      button.dataset.bet = key;
      button.setAttribute('aria-label', `${def.label}, paga ${def.pays} a 1`);
      if (text !== null) button.append(el('span', 'rb-label', text));
      this.#spots.set(key, { el: button, def, marker: null });
      return button;
    };

    const zero = spot('straight:0', 'rb-zero is-green', '0');
    this.#cells.set(0, zero);
    const numbers = el('div', 'rb-numbers');
    const hotLayer = el('div', 'rb-hot-layer');
    for (const item of boardSpots()) {
      if (item.kind === 'number') {
        const n = Number(item.key.split(':')[1]);
        const cell = spot(item.key, `rb-num is-${colorOf(n)}`, String(n));
        cell.style.gridColumn = String(item.c + 1);
        cell.style.gridRow = String(item.r + 1);
        this.#cells.set(n, cell);
        numbers.append(cell);
      } else if (item.kind === 'hot') {
        const hot = spot(item.key, 'rb-hot', null);
        hot.style.left = `${item.x * 100}%`;
        hot.style.top = `${item.y * 100}%`;
        hotLayer.append(hot);
      }
    }
    numbers.append(hotLayer);

    const columns = el('div', 'rb-columns');
    for (const n of [3, 2, 1]) columns.append(spot(`column:${n}`, 'rb-outside', '2:1'));
    const dozens = el('div', 'rb-dozens');
    ['1ª 12', '2ª 12', '3ª 12'].forEach((label, i) => dozens.append(spot(`dozen:${i + 1}`, 'rb-outside', label)));
    const outside = el('div', 'rb-evens');
    outside.append(
      spot('low', 'rb-outside', '1-18'),
      spot('even', 'rb-outside', 'PAR'),
      spot('red', 'rb-outside rb-color is-red', null),
      spot('black', 'rb-outside rb-color is-black', null),
      spot('odd', 'rb-outside', 'IMPAR'),
      spot('high', 'rb-outside', '19-36'),
    );
    board.append(zero, numbers, columns, dozens, outside);
  }

  #bind() {
    const d = this.#dom;
    hud.mountRack(d.rack);
    d.board.addEventListener('click', (event) => {
      const target = event.target.closest('[data-bet]');
      if (target) this.placeBet(target.dataset.bet);
    });
    bindRemoveGesture(d.board, '[data-bet]', (target) => this.removeBet(target.dataset.bet));

    const highlight = (event, on) => {
      const target = event.target.closest?.('[data-bet]');
      if (!target) return;
      const def = this.#spots.get(target.dataset.bet)?.def;
      def?.numbers.forEach((n) => this.#cells.get(n)?.classList.toggle('is-covered', on));
    };
    d.board.addEventListener('pointerover', (event) => highlight(event, true));
    d.board.addEventListener('pointerout', (event) => highlight(event, false));
    d.board.addEventListener('focusin', (event) => highlight(event, true));
    d.board.addEventListener('focusout', (event) => highlight(event, false));

    d.viewTable.addEventListener('click', () => this.#setView('table'));
    d.viewTrack.addEventListener('click', () => this.#setView('track'));
    d.neighbors.addEventListener('click', (event) => {
      const button = event.target.closest('[data-n]');
      if (!button) return;
      this.#prefs.neighbors = Number(button.dataset.n);
      storage.write(PREFS_KEY, this.#prefs);
      audio.click();
      this.#renderView();
    });

    d.undo.addEventListener('click', () => this.undo());
    d.clear.addEventListener('click', () => this.clear());
    d.rebet.addEventListener('click', () => this.rebet(1));
    d.rebet2.addEventListener('click', () => this.rebet(2));
    d.double.addEventListener('click', () => this.double());
    d.spin.addEventListener('click', () => this.spin());
  }

  #setView(view) {
    if (this.#prefs.view === view) return;
    this.#prefs.view = view;
    storage.write(PREFS_KEY, this.#prefs);
    audio.click();
    this.#renderView();
  }

  #renderView() {
    const d = this.#dom;
    const track = this.#prefs.view === 'track';
    d.viewTable.setAttribute('aria-pressed', String(!track));
    d.viewTrack.setAttribute('aria-pressed', String(track));
    d.boardWrap.hidden = track;
    d.trackWrap.hidden = !track;
    for (const button of d.neighbors.querySelectorAll('[data-n]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.n) === this.#prefs.neighbors));
    }
  }

  #previewTrack(target, on) {
    const numbers = target.dataset.number !== undefined
      ? neighborsOf(Number(target.dataset.number), this.#prefs.neighbors)
      : sectorNumbers(target.dataset.sector);
    this.#track.preview(numbers, on);
  }

  // ---------- Apuestas ----------

  #canBet() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.BETTING || s.phase === PHASE.PAYOUT);
  }

  #total(bets) {
    return money(Object.values(bets).reduce((sum, amount) => sum + amount, 0));
  }

  // Coloca un conjunto de apuestas de forma atómica (todas o ninguna).
  #place(parts, call, message) {
    if (!this.#canBet()) return false;
    const s = this.state;
    const betting = s.phase === PHASE.BETTING;
    const bets = betting ? { ...s.bets } : {};
    const calls = betting ? [...s.calls] : [];
    const merged = new Map();
    for (const { key, amount } of parts) merged.set(key, money((merged.get(key) ?? 0) + amount));
    for (const [key, amount] of merged) {
      if ((bets[key] ?? 0) + amount > SPOT_MAX) {
        hud.toast(`Máximo por casilla: ${formatChips(SPOT_MAX)}`, 'warn');
        return false;
      }
    }
    const total = money([...merged.values()].reduce((sum, amount) => sum + amount, 0));
    if (this.#total(bets) + total > TABLE_MAX) {
      hud.toast(`Máximo de mesa: ${formatChips(TABLE_MAX)}`, 'warn');
      return false;
    }
    if (!wallet.hold('roulette', total)) {
      hud.toast('Saldo insuficiente para esa apuesta', 'warn');
      return false;
    }
    if (!betting) this.#undo = [];
    this.#undo.push({ parts: [...merged].map(([key, amount]) => ({ key, amount })), calls: calls.map((c) => ({ ...c })) });
    for (const [key, amount] of merged) bets[key] = money((bets[key] ?? 0) + amount);
    if (call) calls.push({ id: ++this.#callSeq, label: call.label, total, keys: [...merged.keys()] });
    audio.chip();
    this.#set('PLACE', { phase: PHASE.BETTING, bets, calls, message });
    return true;
  }

  placeBet(key) {
    const chip = hud.selectedChip;
    const current = this.state.phase === PHASE.BETTING ? this.state.bets[key] ?? 0 : 0;
    this.#place([{ key, amount: chip }], null, `${betDefinition(key).label}: ${formatChips(current + chip)}`);
  }

  placeCall(call) {
    const chip = hud.selectedChip;
    const parts = callBetParts(call, chip);
    const label = callBetLabel(call);
    const total = parts.reduce((sum, part) => sum + part.amount, 0);
    this.#place(parts, { label }, `${label}: ${parts.length} apuestas, ${formatChips(total)} fichas`);
  }

  removeBet(key) {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING || !s.bets[key]) return;
    const amount = Math.min(hud.selectedChip, s.bets[key]);
    const bets = { ...s.bets };
    bets[key] = money(bets[key] - amount);
    if (bets[key] <= 0) delete bets[key];
    wallet.refund('roulette', amount);
    audio.chip();
    // La ficha retirada deja de formar parte de cualquier apuesta anunciada que la incluyera.
    const calls = s.calls.filter((call) => !call.keys.includes(key));
    const empty = Object.keys(bets).length === 0;
    this.#set('TAKE', { bets, calls, phase: empty ? PHASE.IDLE : PHASE.BETTING, message: empty ? 'Tapete vacío' : 'Ficha retirada' });
  }

  undo() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    const entry = this.#undo.pop();
    if (!entry) return;
    const bets = { ...s.bets };
    let refund = 0;
    for (const { key, amount } of entry.parts) {
      const value = Math.min(amount, bets[key] ?? 0);
      refund += value;
      bets[key] = money((bets[key] ?? 0) - value);
      if (bets[key] <= 0) delete bets[key];
    }
    wallet.refund('roulette', refund);
    audio.chip();
    const empty = Object.keys(bets).length === 0;
    this.#set('UNDO', {
      bets,
      calls: empty ? [] : entry.calls,
      phase: empty ? PHASE.IDLE : PHASE.BETTING,
      message: empty ? 'Tapete vacío' : 'Última apuesta deshecha',
    });
  }

  clear() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    wallet.refund('roulette', this.#total(s.bets));
    this.#undo = [];
    audio.chip();
    this.#set('CLEAR', { phase: PHASE.IDLE, bets: {}, calls: [], message: 'Apuestas retiradas' });
  }

  // Repetir (×1) o Repetir y Doblar (×2) la apuesta de la ronda anterior.
  rebet(multiplier) {
    const s = this.state;
    if (!this.#canBet() || s.phase === PHASE.BETTING) return;
    const entries = Object.entries(s.lastBets);
    if (!entries.length) return;
    const parts = entries.map(([key, amount]) => ({ key, amount: amount * multiplier }));
    const placed = this.#place(parts, null, multiplier === 2 ? 'Apuesta anterior repetida y doblada' : 'Apuesta anterior repetida');
    if (!placed) return;
    const calls = s.lastCalls.map((call) => ({ ...call, id: ++this.#callSeq, total: call.total * multiplier }));
    this.#set('REBET_CALLS', { calls });
  }

  double() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    const parts = Object.entries(s.bets).map(([key, amount]) => ({ key, amount }));
    if (!parts.length) return;
    const calls = s.calls.map((call) => ({ ...call, total: call.total * 2 }));
    if (this.#place(parts, null, 'Apuestas dobladas')) this.#set('DOUBLE_CALLS', { calls });
  }

  // ---------- Giro ----------

  async spin() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    const stake = this.#total(s.bets);
    if (stake <= 0) return;
    clearTimeout(this.#invite);

    const result = randomInt(POCKETS);
    const payout = payoutFor(s.bets, result);
    wallet.settle('roulette', stake, payout);
    const history = [result, ...s.history].slice(0, HISTORY_LIMIT);
    this.#persist(history, s.bets, s.calls);

    audio.say('noMoreBets', {}, { interrupt: true });
    this.#set('SPIN', { phase: PHASE.DEALING, busy: true, message: 'No va más…', lastBets: { ...s.bets }, lastCalls: s.calls.map((c) => ({ ...c })) });
    await this.#wheel.spin(result);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING, result, history });
    audio.say('number', { number: result, color: colorOf(result) }, { interrupt: true });
    this.#renderStats(history);
    await wait(900);

    wallet.reveal('roulette');
    const net = money(payout - stake);
    const name = `${result} ${COLOR_NAME[colorOf(result)]}`;
    const message = payout > 0 ? `¡${name}! Cobras ${formatChips(payout)} (neto ${net >= 0 ? '+' : ''}${formatChips(net)})` : `${name}. La banca gana`;
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, message });

    const origin = this.#cells.get(result)?.getBoundingClientRect();
    const point = origin && origin.width ? { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 } : null;
    if (payout >= stake * 10) {
      audio.win(2);
      hud.celebrate(2, point);
    } else if (payout > 0) {
      audio.chip();
      audio.win(1);
      hud.celebrate(1, point);
    } else {
      audio.lose();
    }
    await wait(500);
    this.#set('READY', { busy: false });
    this.#invite = setTimeout(() => {
      const now = this.state;
      if (this.#visible && !now.busy && now.phase !== PHASE.BETTING) audio.say('placeBets');
    }, 2600);
  }

  // ---------- Render ----------

  #render(s, prev) {
    this.#dom.message.textContent = s.message;
    const bets = s.phase === PHASE.IDLE ? {} : s.bets;
    const covered = new Set();
    for (const [key, spot] of this.#spots) {
      const amount = bets[key] ?? 0;
      if (amount > 0 && spot.def.numbers.length <= 4) for (const n of spot.def.numbers) covered.add(n);
      const shown = Number(spot.el.dataset.amount ?? 0);
      if (amount !== shown) {
        spot.el.dataset.amount = String(amount);
        if (spot.marker) {
          spot.marker.remove();
          spot.marker = null;
        }
        if (amount > 0) {
          const marker = el('span', 'bet-marker');
          marker.append(chipSvg(breakdown(amount)[0]), el('span', 'bet-marker-amount', formatChips(amount)));
          spot.el.append(marker);
          spot.marker = marker;
        }
      }
      const won = s.phase === PHASE.PAYOUT && amount > 0 && spot.def.numbers.includes(s.result);
      const lost = (s.phase === PHASE.PAYOUT || s.phase === PHASE.RESOLVING) && amount > 0 && !spot.def.numbers.includes(s.result);
      spot.el.classList.toggle('is-winning', won);
      spot.el.classList.toggle('is-losing', lost);
    }

    const showResult = s.result !== null && s.phase !== PHASE.DEALING;
    for (const [n, cell] of this.#cells) cell.classList.toggle('is-result', showResult && n === s.result && s.phase !== PHASE.BETTING);
    if (showResult && (!prev || prev.result !== s.result || prev.phase === PHASE.DEALING)) {
      this.#dom.result.replaceChildren(el('span', `result-badge is-${colorOf(s.result)}`, String(s.result)));
    } else if (s.phase === PHASE.DEALING) {
      this.#dom.result.replaceChildren();
    }

    this.#track.update({
      covered,
      result: showResult && s.phase !== PHASE.BETTING ? s.result : null,
      locked: !this.#canBet(),
    });
    const calls = s.phase === PHASE.IDLE ? [] : s.calls;
    this.#dom.calls.replaceChildren(...calls.map((call) => el('li', 'call-chip', `${call.label} · ${formatChips(call.total)}`)));

    const shownBets = s.phase === PHASE.BETTING ? s.bets : s.phase === PHASE.IDLE ? {} : s.lastBets;
    this.#dom.total.textContent = formatChips(this.#total(shownBets));
    this.#renderControls(s);
  }

  #renderControls(s) {
    const d = this.#dom;
    const betting = !s.busy && s.phase === PHASE.BETTING;
    const total = this.#total(s.bets);
    d.undo.disabled = !(betting && this.#undo.length > 0);
    d.clear.disabled = !betting;
    d.double.disabled = !(betting && total > 0 && wallet.canAfford(total));
    d.spin.disabled = !(betting && total > 0);
    const lastTotal = this.#total(s.lastBets);
    const canRebet = this.#canBet() && s.phase !== PHASE.BETTING && lastTotal > 0;
    d.rebet.disabled = !(canRebet && wallet.canAfford(lastTotal));
    d.rebet2.disabled = !(canRebet && wallet.canAfford(lastTotal * 2));
    d.board.classList.toggle('is-locked', !this.#canBet());
  }

  #renderStats(history) {
    const d = this.#dom;
    const badge = (n, tag = 'li') => el(tag, `num-badge is-${colorOf(n)}`, String(n));
    d.history.replaceChildren(...history.slice(0, 12).map((n) => badge(n)));

    const sample = history.slice(0, STATS_WINDOW);
    d.sample.textContent = sample.length ? `(últimos ${sample.length})` : '(sin giros)';
    const counts = new Array(POCKETS).fill(0);
    for (const n of sample) counts[n]++;
    const ranked = counts.map((count, n) => ({ n, count }));
    const hot = [...ranked].filter((x) => x.count > 0).sort((a, b) => b.count - a.count || a.n - b.n).slice(0, 5);
    const cold = [...ranked].sort((a, b) => a.count - b.count || a.n - b.n).slice(0, 5);
    const item = ({ n, count }) => {
      const li = el('li', 'num-stat');
      li.append(badge(n, 'span'), el('small', '', `×${count}`));
      return li;
    };
    d.hot.replaceChildren(...(sample.length ? hot.map(item) : [el('li', 'muted', '—')]));
    d.cold.replaceChildren(...(sample.length ? cold.map(item) : [el('li', 'muted', '—')]));

    const size = sample.length || 1;
    const share = (fn) => sample.filter(fn).length / size;
    const rows = [
      ['Rojo', share((n) => colorOf(n) === 'red'), 'Negro', share((n) => colorOf(n) === 'black'), 'is-redblack'],
      ['Par', share((n) => n > 0 && n % 2 === 0), 'Impar', share((n) => n % 2 === 1), ''],
      ['1-18', share((n) => n >= 1 && n <= 18), '19-36', share((n) => n >= 19), ''],
    ];
    const bars = rows.map(([leftLabel, left, rightLabel, right, variant]) => {
      const row = el('div', `freq-row ${variant}`);
      const bar = el('div', 'freq-bar');
      const l = el('span', 'freq-left');
      const z = el('span', 'freq-zero');
      const r = el('span', 'freq-right');
      l.style.flexGrow = String(sample.length ? left : 1);
      z.style.flexGrow = String(sample.length ? Math.max(0, 1 - left - right) : 0);
      r.style.flexGrow = String(sample.length ? right : 1);
      bar.append(l, z, r);
      row.append(
        el('span', 'freq-label', `${leftLabel} ${Math.round(left * 100)}%`),
        bar,
        el('span', 'freq-label freq-label-right', `${Math.round(right * 100)}% ${rightLabel}`),
      );
      return row;
    });
    const zeros = el('p', 'freq-zero-note', `Cero: ${Math.round(share((n) => n === 0) * 100)}% · esperado 2,7%`);
    d.freq.replaceChildren(...bars, zeros);
  }

  onShow() {
    this.#visible = true;
    this.#wheel.setVisible(true);
    const s = this.state;
    if (!s.busy && s.phase === PHASE.IDLE) audio.say('placeBets');
  }

  onHide() {
    this.#visible = false;
    clearTimeout(this.#invite);
    this.#wheel.setVisible(false);
  }
}
