// Plinko Pachinko: tablero de 9 filas de clavijas dibujado en Canvas 2D con física guiada.
// El camino de cada bola se sortea al soltarla con el flujo provably fair (plinko-math.js) y la
// apuesta se liquida en ese momento; la animación es balística de verdad (gravedad 0,28 px por
// fotograma² a escala del tablero y rebote con restitución 0,55), pero cada salto apunta a la
// clavija que marca el camino. Varias bolas pueden estar en el aire a la vez (ráfaga ×5).

import { wallet } from '../engine/wallet.js';
import { session, FREE_LIMITS } from '../session.js';
import { relics } from '../relics.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { settings } from '../settings.js';
import { hud, formatChips } from '../ui/hud.js';
import { el } from '../ui/svg.js';
import { fmtMult, outcomeTone, pushRecent, fitCanvas, cssVar } from '../ui/arcade.js';
import { RISKS, riskOf, plinkoPath, plinkoRtp, PLINKO_ROWS, RESTITUTION, GRAVITY, BURST, BURST_DELAY_MS } from './plinko-math.js';

const PREFS_KEY = scopedKey('crd.plinko.prefs.v1');
const MAX_BALLS = 30;
const ASPECT = 0.86;
// Fracción de la velocidad vertical que devuelve el rebote contra una clavija (además de e).
const BOUNCE = 0.5;
const PEG_FLASH_MS = 280;
const BUCKET_FLASH_MS = 420;
const pct = (value) => `${(value * 100).toFixed(2).replace('.', ',')} %`;

function bucketColor(multiplier) {
  if (multiplier >= 10) return ['#ff2d55', '#2a0010'];
  if (multiplier >= 2) return ['#ff9f0a', '#2a1400'];
  if (multiplier >= 1) return ['#ffd60a', '#2a2200'];
  if (multiplier > 0) return ['#32ade6', '#001a26'];
  return ['#48484a', '#e5e5ea'];
}

export class PlinkoGame {
  #root;
  #dom;
  #ctx = null;
  #geo = null;
  #board = null;
  #balls = [];
  #pegFlash = new Map();
  #bucketFlash = new Array(PLINKO_ROWS + 1).fill(-1e9);
  #risk = 'low';
  #bet = 50;
  #visible = false;
  #raf = 0;
  #last = 0;
  #burstTimers = [];
  #accent = '#00ff66';
  #ballSprite = null;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      canvas: $('pk-board'),
      recent: $('pk-recent'),
      risk: $('pk-risk'),
      bets: $('pk-bets'),
      drop: $('pk-drop'),
      burst: $('pk-burst'),
      rtp: $('pk-rtp'),
      flying: $('pk-flying'),
      last: $('pk-last'),
      message: $('pk-message'),
      rules: $('pk-rules'),
    };
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    const bets = FREE_LIMITS.plinko.bets;
    this.#risk = RISKS[prefs.risk] ? prefs.risk : 'low';
    this.#bet = bets.includes(prefs.bet) ? prefs.bet : bets[2];
    this.#buildBets();
    this.#bind();
    session.register('plinko', { hasPendingPlay: () => this.#balls.length > 0 });
    this.#dom.rules.textContent = `9 filas de clavijas (la primera es la puerta de entrada) y 9 cubetas. Cada fila la decide un número verificable; el rebote amortiguado tiene un sesgo publicado hacia el centro que fija el RTP: ${Object.values(RISKS).map((risk) => `${risk.name} ${pct(plinkoRtp(risk.id))}`).join(', ')}. El Zafiro de Plinko suma 8 puntos. Ráfaga: ${BURST} bolas con ${BURST_DELAY_MS} ms entre ellas.`;
    this.#renderControls();
  }

  // ---------- Controles ----------

  #buildBets() {
    const buttons = FREE_LIMITS.plinko.bets.map((value) => {
      const button = el('button', 'seg', formatChips(value));
      button.type = 'button';
      button.dataset.bet = String(value);
      button.addEventListener('click', () => {
        audio.click();
        this.#bet = value;
        this.#savePrefs();
        this.#renderControls();
      });
      return button;
    });
    this.#dom.bets.replaceChildren(...buttons);
  }

  #bind() {
    const d = this.#dom;
    d.risk.addEventListener('click', (event) => {
      const button = event.target.closest('[data-risk]');
      if (!button || this.#balls.length) return;
      audio.click();
      this.#risk = button.dataset.risk;
      this.#savePrefs();
      this.#renderControls();
      if (this.#visible) this.#layout();
    });
    d.drop.addEventListener('click', () => this.drop());
    d.burst.addEventListener('click', () => this.burst());
    wallet.addEventListener('change', () => this.#renderControls());
    relics.addEventListener('change', () => this.#renderControls());
    globalThis.addEventListener('resize', () => {
      if (!this.#visible) return;
      this.#flush();
      this.#layout();
    }, { passive: true });
    settings.addEventListener('change', (event) => {
      if (event.detail.key === 'theme' && this.#visible) this.#layout();
    });
  }

  #savePrefs() {
    storage.write(PREFS_KEY, { risk: this.#risk, bet: this.#bet });
  }

  #renderControls() {
    const d = this.#dom;
    const flying = this.#balls.length;
    for (const button of d.risk.querySelectorAll('[data-risk]')) {
      button.setAttribute('aria-pressed', String(button.dataset.risk === this.#risk));
      button.disabled = flying > 0;
    }
    for (const button of d.bets.querySelectorAll('[data-bet]')) {
      const value = Number(button.dataset.bet);
      button.setAttribute('aria-pressed', String(value === this.#bet));
    }
    const affordable = wallet.canAfford(this.#bet);
    d.drop.disabled = !affordable || flying >= MAX_BALLS;
    d.burst.disabled = !wallet.canAfford(this.#bet * BURST) || flying + BURST > MAX_BALLS;
    d.drop.textContent = `Soltar bola · ${formatChips(this.#bet)}`;
    d.flying.textContent = String(flying);
    const sapphire = relics.active('sapphire');
    d.rtp.textContent = `${pct(plinkoRtp(this.#risk, { sapphire }))}${sapphire ? ' 💎' : ''}`;
  }

  // ---------- Geometría ----------

  #layout() {
    const canvas = this.#dom.canvas;
    const { ctx, width, height, dpr } = fitCanvas(canvas, ASPECT);
    this.#ctx = ctx;
    const s = width / 11;
    const top = s * 0.85;
    const bucketH = Math.max(24, s * 0.62);
    const margin = s * 0.22;
    const v = (height - top - bucketH - margin) / (PLINKO_ROWS + 0.6);
    this.#geo = {
      width,
      height,
      s,
      v,
      cx: width / 2,
      top,
      bucketTop: top + (PLINKO_ROWS + 0.6) * v,
      bucketH,
      pegR: Math.max(2.2, s * 0.085),
      ballR: Math.max(4, s * 0.18),
      // Gravedad del enunciado (px/fotograma² a 60 fps) escalada a la separación de las filas.
      gravity: GRAVITY * 3600 * (v / 40),
    };
    this.#accent = cssVar('--cy-accent', '#00ff66');
    this.#paintBoard(dpr);
    this.#paintBall(dpr);
    this.#draw(performance.now());
  }

  #pegX(row, j) {
    return this.#geo.cx + (j - (row + 1) / 2) * this.#geo.s;
  }

  #pegY(row) {
    return this.#geo.top + row * this.#geo.v;
  }

  // Clavijas y puerta de entrada pintadas una vez en un lienzo aparte (se copian cada fotograma).
  #paintBoard(dpr) {
    const g = this.#geo;
    const board = document.createElement('canvas');
    board.width = Math.round(g.width * dpr);
    board.height = Math.round(g.height * dpr);
    const ctx = board.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ink = cssVar('--cy-ink', '#d8ffe8');
    const accent = cssVar('--cy-accent', '#00ff66');
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.9;
    for (const x of [g.cx - g.s * 0.62, g.cx + g.s * 0.62]) {
      ctx.beginPath();
      ctx.arc(x, g.top, g.pegR * 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ink;
    for (let row = 1; row <= PLINKO_ROWS; row++) {
      for (let j = 0; j <= row + 1; j++) {
        ctx.beginPath();
        ctx.arc(this.#pegX(row, j), this.#pegY(row), g.pegR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    riskOf(this.#risk).multipliers.forEach((multiplier, i) => this.#paintBucket(ctx, i, multiplier, 0, 0.86));
    this.#board = board;
  }

  // Cubeta i con su multiplicador; `press` la hunde un poco cuando cae una bola.
  #paintBucket(ctx, i, multiplier, press, alpha) {
    const g = this.#geo;
    const x = g.cx + (i - PLINKO_ROWS / 2) * g.s;
    const w = g.s * 0.9;
    const [fill, ink] = bucketColor(multiplier);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, g.bucketTop + press, w, g.bucketH, Math.min(8, g.s * 0.14));
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.max(10, Math.min(15, g.s * 0.3))}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = ink;
    ctx.fillText(multiplier === 0 ? '×0' : `×${String(multiplier).replace('.', ',')}`, x, g.bucketTop + press + g.bucketH / 2);
  }

  // Bola pintada una vez (degradado incluido) y estampada con drawImage.
  #paintBall(dpr) {
    const r = this.#geo.ballR;
    const size = Math.ceil(r * 2 * dpr) + 2;
    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const ctx = sprite.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / dpr / 2;
    const gradient = ctx.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.1, c, c, r);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.45, this.#accent);
    gradient.addColorStop(1, '#00220f');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    this.#ballSprite = { canvas: sprite, size: size / dpr };
  }

  // ---------- Bolas ----------

  drop() {
    if (this.#balls.length >= MAX_BALLS) return false;
    const bet = this.#bet;
    const risk = this.#risk;
    if (!wallet.hold('plinko', bet)) {
      hud.toast('Saldo insuficiente para soltar otra bola', 'warn');
      return false;
    }
    session.beginRound({ game: 'plinko', stake: bet });
    const stream = session.stream('plinko');
    const sapphire = relics.active('sapphire');
    const path = plinkoPath(stream, risk, { sapphire });
    const payout = Math.round(bet * path.multiplier * 100) / 100;
    // El resultado queda liquidado al soltar la bola: recargar a mitad de caída no lo cambia.
    wallet.settle('plinko', bet, payout);
    session.record(stream, { stake: bet, payout, summary: `Cubeta ${path.bucket + 1} · ${fmtMult(path.multiplier)}`, params: { risk, sapphire } });
    audio.chip();
    if (!this.#geo) this.#layout();
    this.#spawn({ path, bet, payout, risk });
    this.#renderControls();
    return true;
  }

  burst() {
    for (let i = 0; i < BURST; i++) {
      const timer = setTimeout(() => {
        this.#burstTimers = this.#burstTimers.filter((t) => t !== timer);
        if (this.#visible) this.drop();
      }, i * BURST_DELAY_MS * settings.speed);
      this.#burstTimers.push(timer);
    }
  }

  #spawn({ path, bet, payout, risk }) {
    const g = this.#geo;
    const touch = g.ballR + g.pegR;
    const targets = [];
    let offset = 0;
    for (let row = 1; row <= PLINKO_ROWS; row++) {
      const move = path.moves[row - 1];
      const pegX = g.cx + (offset * g.s) / 2;
      targets.push({ x: pegX + move * touch * 0.42, y: this.#pegY(row) - touch * 0.9, row, j: (offset + row + 1) / 2, side: offset / PLINKO_ROWS });
      offset += move;
    }
    targets.push({ x: g.cx + (offset * g.s) / 2, y: g.bucketTop + g.ballR * 0.3, bucket: path.bucket });
    const ball = {
      x: g.cx + (path.moves[0] > 0 ? 1 : -1) * g.s * 0.04,
      y: g.top - g.s * 0.75,
      vy: 0,
      seg: null,
      target: 0,
      targets,
      bet,
      payout,
      risk,
      bucket: path.bucket,
      multiplier: path.multiplier,
    };
    this.#segment(ball);
    this.#balls.push(ball);
    this.#ensureLoop();
  }

  // Salto balístico hasta el siguiente punto de contacto: y(t) = y0 + vy0·t + ½·g·t².
  #segment(ball) {
    const g = this.#geo;
    const target = ball.targets[ball.target];
    const dy = target.y - ball.y;
    const vy0 = ball.vy;
    const T = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * g.gravity * Math.max(1, dy))) / g.gravity;
    ball.seg = { x0: ball.x, y0: ball.y, vx: (target.x - ball.x) / T, vy0, T, t: 0 };
  }

  // Avanza una bola; devuelve false cuando cae en su cubeta.
  #step(ball, dt, now) {
    const g = this.#geo;
    const seg = ball.seg;
    seg.t += dt;
    if (seg.t < seg.T) {
      ball.x = seg.x0 + seg.vx * seg.t;
      ball.y = seg.y0 + seg.vy0 * seg.t + 0.5 * g.gravity * seg.t * seg.t;
      return true;
    }
    const target = ball.targets[ball.target];
    ball.x = target.x;
    ball.y = target.y;
    if (target.bucket !== undefined) {
      this.#land(ball, now);
      return false;
    }
    const arrival = seg.vy0 + g.gravity * seg.T;
    this.#pegFlash.set(`${target.row}:${target.j}`, now);
    audio.plinkoPeg(target.side);
    // Rebote amortiguado con la restitución del enunciado.
    ball.vy = -RESTITUTION * BOUNCE * arrival;
    ball.target += 1;
    this.#segment(ball);
    return true;
  }

  #land(ball, now = performance.now(), { quiet = false } = {}) {
    this.#bucketFlash[ball.bucket] = now;
    wallet.reveal('plinko', { amount: ball.payout, stake: ball.bet });
    const tone = outcomeTone(ball.multiplier);
    pushRecent(this.#dom.recent, fmtMult(ball.multiplier), tone);
    this.#dom.last.textContent = fmtMult(ball.multiplier);
    this.#dom.message.textContent = `Cubeta ${ball.bucket + 1}: ${fmtMult(ball.multiplier)} → ${ball.payout > 0 ? `cobras ${formatChips(ball.payout)}` : 'sin premio'}`;
    if (!quiet) {
      audio.plinkoLand(ball.multiplier);
      if (ball.multiplier >= 2 && this.#geo) {
        const rect = this.#dom.canvas.getBoundingClientRect();
        const x = rect.left + ((ball.x / this.#geo.width) * rect.width);
        const y = rect.top + ((this.#geo.bucketTop / this.#geo.height) * rect.height);
        if (ball.multiplier >= 10) hud.celebrate(2, { x, y });
        else hud.sparks(x, y, 26);
      }
    }
    this.#balls = this.#balls.filter((item) => item !== ball);
    session.report({ game: 'plinko', stake: ball.bet, returned: ball.payout, tags: [`plinko-${ball.risk}`] });
    this.#renderControls();
  }

  // Aterriza de golpe todas las bolas en el aire (al cambiar de mesa o de tamaño).
  #flush() {
    for (const timer of this.#burstTimers) clearTimeout(timer);
    this.#burstTimers = [];
    for (const ball of [...this.#balls]) this.#land(ball, performance.now(), { quiet: true });
  }

  // ---------- Bucle y dibujo ----------

  #ensureLoop() {
    if (this.#raf || !this.#visible) return;
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#loop);
  }

  #loop = (now) => {
    const dt = Math.min(0.05, (now - this.#last) / 1000) * (settings.turbo ? 2 : 1);
    this.#last = now;
    for (const ball of [...this.#balls]) this.#step(ball, dt, now);
    this.#draw(now);
    const flashing = this.#bucketFlash.some((time) => now - time < BUCKET_FLASH_MS) || this.#pegFlash.size > 0;
    this.#raf = this.#visible && (this.#balls.length || flashing) ? requestAnimationFrame(this.#loop) : 0;
  };

  #draw(now) {
    const ctx = this.#ctx;
    const g = this.#geo;
    if (!ctx || !g) return;
    ctx.clearRect(0, 0, g.width, g.height);
    if (this.#board) ctx.drawImage(this.#board, 0, 0, g.width, g.height);

    const accent = this.#accent;
    for (const [key, time] of this.#pegFlash) {
      const age = now - time;
      if (age > PEG_FLASH_MS) {
        this.#pegFlash.delete(key);
        continue;
      }
      const [row, j] = key.split(':').map(Number);
      ctx.globalAlpha = 1 - age / PEG_FLASH_MS;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(this.#pegX(row, j), this.#pegY(row), g.pegR * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Solo se repintan las cubetas que se están hundiendo; el resto viene en el tablero cacheado.
    const multipliers = riskOf(this.#risk).multipliers;
    multipliers.forEach((multiplier, i) => {
      const age = now - this.#bucketFlash[i];
      if (age >= BUCKET_FLASH_MS) return;
      const w = g.s * 0.92;
      ctx.clearRect(g.cx + (i - PLINKO_ROWS / 2) * g.s - w / 2, g.bucketTop - 1, w, g.bucketH + g.bucketH * 0.25);
      this.#paintBucket(ctx, i, multiplier, (1 - age / BUCKET_FLASH_MS) * g.bucketH * 0.22, 1);
    });

    const sprite = this.#ballSprite;
    for (const ball of this.#balls) ctx.drawImage(sprite.canvas, ball.x - sprite.size / 2, ball.y - sprite.size / 2, sprite.size, sprite.size);
  }

  onShow() {
    this.#visible = true;
    this.#layout();
    this.#ensureLoop();
  }

  onHide() {
    this.#visible = false;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#flush();
  }
}
