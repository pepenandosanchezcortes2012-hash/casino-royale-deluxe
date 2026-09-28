// Ruleta Europea de un solo cero: 37 casillas en el orden físico real del plato.
// Todas las apuestas tienen la misma ventaja de la casa: 1 − 36/37 = 2,7027 %.

import { randomInt, randomFloat, randomBetween } from '../engine/rng.js';
import { Store, PHASE, wait } from '../engine/store.js';
import { wallet, money } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { hud, formatChips } from '../ui/hud.js';
import { chipSvg, breakdown, el } from '../ui/svg.js';

export const WHEEL_ORDER = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]);
export const POCKETS = 37;
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const SPOT_MAX = 2500;
export const TABLE_MAX = 20000;

const SAVE_KEY = 'crd.roulette.v1';
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

// Traduce una clave de apuesta ("split:1-4", "dozen:2", "red"…) a números cubiertos y pago.
export function betDefinition(key) {
  const [type, arg] = key.split(':');
  if (type in INSIDE_SIZE) {
    const numbers = arg.split('-').map(Number);
    if (numbers.length !== INSIDE_SIZE[type] || numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 36)) {
      throw new Error(`Apuesta inválida: ${key}`);
    }
    return { key, type, numbers, pays: 36 / numbers.length - 1, label: `${INSIDE_LABEL[type]} ${numbers.join('/')}` };
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

// Geometría del tapete: columna c (0..11) y fila r (0 = arriba) → número.
const numberAt = (c, r) => 3 * (c + 1) - r;

export function boardSpots() {
  const spots = [{ key: 'straight:0', kind: 'zero' }];
  for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) spots.push({ key: `straight:${numberAt(c, r)}`, kind: 'number', c, r });
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

// ---------- Plato en Canvas ----------

const SEG = (Math.PI * 2) / POCKETS;
const IDLE_OMEGA = 0.32;
const TAU = Math.PI * 2;
const mod = (a, m) => ((a % m) + m) % m;

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

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#wheel.t0 = performance.now();
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas.parentElement);
  }

  get spinning() {
    return this.#spin !== null;
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
    const css = Math.round(Math.min(box, 460));
    if (css === this.#css) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.#css = css;
    this.#px = Math.round(css * dpr);
    this.#canvas.width = this.#px;
    this.#canvas.height = this.#px;
    this.#canvas.style.width = `${css}px`;
    this.#canvas.style.height = `${css}px`;
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
    requestAnimationFrame(this.#frame);
  }

  #frame = (now) => {
    if (!this.#visible && !this.#spin) {
      this.#running = false;
      return;
    }
    this.#update(now);
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
    audio.ballTick(0.8);
    this.#spin = null;
    sp.resolve();
  }

  #buildLayers(size) {
    const R = size / 2;
    const make = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.translate(R, R);
      return { canvas, ctx };
    };

    // Cuenco estático: madera, pista de la bola pulida y deflectores.
    const bowl = make();
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

    // Rotor: casillas numeradas, bolsillos, trastes y cono central con torreta.
    const rotor = make();
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
    const glare = make();
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.#layers.bowl, 0, 0);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(wheel);
    ctx.drawImage(this.#layers.rotor, -R, -R);
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
    ctx.drawImage(this.#layers.glare, 0, 0);

    if (this.#ball.mode === 'hidden') return;
    let angle = this.#ball.angle;
    let radius = this.#ball.radius;
    if (this.#ball.mode === 'pocket') {
      angle = wheel + this.#ball.index * SEG;
      radius = R * 0.585;
    }
    const x = R + Math.cos(angle - Math.PI / 2) * radius;
    const y = R + Math.sin(angle - Math.PI / 2) * radius;
    const br = R * 0.03;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + br * 0.35, y + br * 0.45, br, br * 0.8, 0, 0, TAU);
    ctx.fill();
    const shine = ctx.createRadialGradient(x - br * 0.35, y - br * 0.4, br * 0.1, x, y, br);
    shine.addColorStop(0, '#ffffff');
    shine.addColorStop(0.55, '#e9e9ec');
    shine.addColorStop(1, '#8d9096');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, TAU);
    ctx.fill();
  }
}

// ---------- Mesa ----------

function loadSaved() {
  const saved = storage.read(SAVE_KEY, null);
  const history = Array.isArray(saved?.history) ? saved.history.filter((n) => Number.isInteger(n) && n >= 0 && n <= 36).slice(0, HISTORY_LIMIT) : [];
  const lastBets = {};
  if (saved?.lastBets && typeof saved.lastBets === 'object') {
    for (const [key, amount] of Object.entries(saved.lastBets)) {
      try {
        betDefinition(key);
        if (typeof amount === 'number' && amount > 0) lastBets[key] = amount;
      } catch {
        // Clave corrupta: se descarta.
      }
    }
  }
  return { history, lastBets };
}

export class RouletteGame {
  #store;
  #dom;
  #wheel;
  #spots = new Map();
  #cells = new Map();
  #undo = [];

  constructor(root) {
    this.root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      board: $('rl-board'),
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
      double: $('rl-double'),
      spin: $('rl-spin'),
      rack: $('rl-rack'),
    };
    const { history, lastBets } = loadSaved();
    this.#store = new Store('roulette', {
      phase: PHASE.IDLE,
      busy: false,
      bets: {},
      lastBets,
      history,
      result: history.length ? history[0] : null,
      message: 'Selecciona una ficha y colócala en el tapete',
    });
    this.#wheel = new WheelRenderer($('rl-wheel'));
    if (history.length) this.#wheel.restAt(history[0]);

    this.#buildBoard();
    this.#bind();
    this.#store.subscribe((state, prev) => this.#render(state, prev));
    wallet.addEventListener('change', () => this.#renderControls(this.state));
    this.#render(this.state, null);
    this.#renderStats(this.state.history);
  }

  get state() {
    return this.#store.state;
  }

  #set(action, patch) {
    return this.#store.commit(action, patch);
  }

  #persist(history, lastBets) {
    storage.write(SAVE_KEY, { history, lastBets });
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
    d.board.addEventListener('contextmenu', (event) => {
      const target = event.target.closest('[data-bet]');
      if (!target) return;
      event.preventDefault();
      this.removeBet(target.dataset.bet);
    });
    let pressTimer = 0;
    d.board.addEventListener('touchstart', (event) => {
      const target = event.target.closest('[data-bet]');
      if (!target) return;
      pressTimer = setTimeout(() => {
        pressTimer = 0;
        this.removeBet(target.dataset.bet);
        target.dataset.longpress = '1';
      }, 550);
    }, { passive: true });
    const cancelPress = () => {
      clearTimeout(pressTimer);
    };
    d.board.addEventListener('touchend', cancelPress, { passive: true });
    d.board.addEventListener('touchmove', cancelPress, { passive: true });
    d.board.addEventListener('click', (event) => {
      const target = event.target.closest('[data-longpress]');
      if (target) {
        delete target.dataset.longpress;
        event.stopImmediatePropagation();
      }
    }, { capture: true });

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

    d.undo.addEventListener('click', () => this.undo());
    d.clear.addEventListener('click', () => this.clear());
    d.rebet.addEventListener('click', () => this.rebet());
    d.double.addEventListener('click', () => this.double());
    d.spin.addEventListener('click', () => this.spin());
  }

  // ---------- Apuestas ----------

  #canBet() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.BETTING || s.phase === PHASE.PAYOUT);
  }

  #currentBets() {
    return this.state.phase === PHASE.BETTING ? this.state.bets : {};
  }

  #total(bets) {
    return money(Object.values(bets).reduce((sum, amount) => sum + amount, 0));
  }

  placeBet(key) {
    if (!this.#canBet()) return;
    const chip = hud.selectedChip;
    const bets = { ...this.#currentBets() };
    if ((bets[key] ?? 0) + chip > SPOT_MAX) {
      hud.toast(`Máximo por casilla: ${formatChips(SPOT_MAX)}`, 'warn');
      return;
    }
    if (this.#total(bets) + chip > TABLE_MAX) {
      hud.toast(`Máximo de mesa: ${formatChips(TABLE_MAX)}`, 'warn');
      return;
    }
    if (!wallet.hold('roulette', chip)) {
      hud.toast('Saldo insuficiente para esa ficha', 'warn');
      return;
    }
    if (this.state.phase !== PHASE.BETTING) this.#undo = [];
    bets[key] = (bets[key] ?? 0) + chip;
    this.#undo.push({ key, amount: chip });
    audio.chip();
    this.#set('PLACE', { phase: PHASE.BETTING, bets, message: `${betDefinition(key).label}: ${formatChips(bets[key])}` });
  }

  removeBet(key) {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING || !s.bets[key]) return;
    const amount = Math.min(hud.selectedChip, s.bets[key]);
    this.#take(key, amount);
  }

  #take(key, amount) {
    const bets = { ...this.state.bets };
    bets[key] = money(bets[key] - amount);
    if (bets[key] <= 0) delete bets[key];
    wallet.refund('roulette', amount);
    audio.chip();
    const empty = Object.keys(bets).length === 0;
    this.#set('TAKE', { bets, phase: empty ? PHASE.IDLE : PHASE.BETTING, message: empty ? 'Tapete vacío' : 'Ficha retirada' });
  }

  undo() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    while (this.#undo.length) {
      const { key, amount } = this.#undo.pop();
      if ((s.bets[key] ?? 0) >= amount) {
        this.#take(key, amount);
        return;
      }
    }
  }

  clear() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    wallet.refund('roulette', this.#total(s.bets));
    this.#undo = [];
    audio.chip();
    this.#set('CLEAR', { phase: PHASE.IDLE, bets: {}, message: 'Apuestas retiradas' });
  }

  rebet() {
    const s = this.state;
    if (!this.#canBet() || s.phase === PHASE.BETTING) return;
    const total = this.#total(s.lastBets);
    if (total <= 0) return;
    if (!wallet.hold('roulette', total)) {
      hud.toast('Saldo insuficiente para repetir', 'warn');
      return;
    }
    this.#undo = Object.entries(s.lastBets).map(([key, amount]) => ({ key, amount }));
    audio.chip();
    this.#set('REBET', { phase: PHASE.BETTING, bets: { ...s.lastBets }, message: 'Apuesta anterior repetida' });
  }

  double() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    const total = this.#total(s.bets);
    if (Object.values(s.bets).some((amount) => amount * 2 > SPOT_MAX) || total * 2 > TABLE_MAX) {
      hud.toast('Doblar superaría el máximo de la mesa', 'warn');
      return;
    }
    if (!wallet.hold('roulette', total)) {
      hud.toast('Saldo insuficiente para doblar', 'warn');
      return;
    }
    const bets = Object.fromEntries(Object.entries(s.bets).map(([key, amount]) => [key, amount * 2]));
    for (const [key, amount] of Object.entries(s.bets)) this.#undo.push({ key, amount });
    audio.chip();
    this.#set('DOUBLE', { bets, message: 'Apuestas dobladas' });
  }

  // ---------- Giro ----------

  async spin() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    const stake = this.#total(s.bets);
    if (stake <= 0) return;

    const result = randomInt(POCKETS);
    const payout = payoutFor(s.bets, result);
    wallet.settle('roulette', stake, payout);
    const history = [result, ...s.history].slice(0, HISTORY_LIMIT);
    this.#persist(history, s.bets);

    this.#set('SPIN', { phase: PHASE.DEALING, busy: true, message: 'No va más…', lastBets: { ...s.bets } });
    await this.#wheel.spin(result);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING, result, history });
    this.#renderStats(history);
    await wait(900);

    wallet.reveal('roulette');
    const net = money(payout - stake);
    const name = `${result} ${COLOR_NAME[colorOf(result)]}`;
    const message = payout > 0 ? `¡${name}! Cobras ${formatChips(payout)} (neto ${net >= 0 ? '+' : ''}${formatChips(net)})` : `${name}. La banca gana`;
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, message });

    const origin = this.#cells.get(result)?.getBoundingClientRect();
    const point = origin ? { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 } : null;
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
  }

  // ---------- Render ----------

  #render(s, prev) {
    this.#dom.message.textContent = s.message;
    const bets = s.phase === PHASE.IDLE ? {} : s.bets;
    for (const [key, spot] of this.#spots) {
      const amount = bets[key] ?? 0;
      const shown = Number(spot.el.dataset.amount ?? 0);
      if (amount !== shown) {
        spot.el.dataset.amount = String(amount);
        if (spot.marker) {
          spot.marker.remove();
          spot.marker = null;
        }
        if (amount > 0) {
          const marker = el('span', 'bet-marker');
          const chips = breakdown(amount);
          marker.append(chipSvg(chips[0]));
          marker.append(el('span', 'bet-marker-amount', formatChips(amount)));
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
      const badge = el('span', `result-badge is-${colorOf(s.result)}`, String(s.result));
      this.#dom.result.replaceChildren(badge);
    } else if (s.phase === PHASE.DEALING) {
      this.#dom.result.replaceChildren();
    }

    this.#dom.total.textContent = formatChips(this.#total(s.phase === PHASE.BETTING ? s.bets : s.phase === PHASE.IDLE ? {} : s.lastBets));
    this.#renderControls(s);
  }

  #renderControls(s) {
    const d = this.#dom;
    const betting = !s.busy && s.phase === PHASE.BETTING;
    const total = this.#total(s.bets);
    d.undo.disabled = !betting;
    d.clear.disabled = !betting;
    d.double.disabled = !(betting && wallet.canAfford(total));
    d.spin.disabled = !(betting && total > 0);
    const lastTotal = this.#total(s.lastBets);
    d.rebet.disabled = !(this.#canBet() && s.phase !== PHASE.BETTING && lastTotal > 0 && wallet.canAfford(lastTotal));
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
      l.style.flexGrow = String(left);
      z.style.flexGrow = String(Math.max(0, 1 - left - right));
      r.style.flexGrow = String(right);
      if (!sample.length) {
        l.style.flexGrow = '1';
        r.style.flexGrow = '1';
        z.style.flexGrow = '0';
      }
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
    this.#wheel.setVisible(true);
  }

  onHide() {
    this.#wheel.setVisible(false);
  }
}
