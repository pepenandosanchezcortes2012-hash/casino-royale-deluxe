// Rueda de la Fortuna diaria: una tirada gratis cada 24 horas con 10 gajos (fichas de 200 a
// 3.000, bote de 10.000, pociones ×2 y cofres). El gajo sale del flujo provably fair según los
// pesos publicados (wheel-math.js). El premio se guarda al girar y se entrega al parar la rueda:
// si la página se recarga a mitad del giro, se entrega al volver.

import { wallet } from '../engine/wallet.js';
import { session } from '../session.js';
import { relics } from '../relics.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { settings } from '../settings.js';
import { randomFloat } from '../engine/rng.js';
import { hud, formatChips } from '../ui/hud.js';
import { el } from '../ui/svg.js';
import { fitCanvas, cssVar } from '../ui/arcade.js';
import { WHEEL_SLICES, WHEEL_TOTAL_WEIGHT, spinWheel, wheelCooldown } from './wheel-math.js';

const STATE_KEY = scopedKey('crd.wheel.v1');
const SPIN_MS = 5200;
const SLICE = (Math.PI * 2) / WHEEL_SLICES.length;
const TAU = Math.PI * 2;
const easeOut = (k) => 1 - (1 - k) ** 4;

function clock(ms) {
  const total = Math.ceil(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export class WheelGame {
  #root;
  #dom;
  #ctx = null;
  #size = null;
  #angle = 0;
  #spinning = false;
  #visible = false;
  #timer = 0;
  #state;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      canvas: $('wh-canvas'),
      spin: $('wh-spin'),
      cooldown: $('wh-cooldown'),
      message: $('wh-message'),
      odds: $('wh-odds'),
    };
    const saved = storage.read(STATE_KEY, null) ?? {};
    this.#state = {
      lastSpin: Number.isFinite(saved.lastSpin) ? saved.lastSpin : 0,
      pending: saved.pending && Number.isInteger(saved.pending.index) && WHEEL_SLICES[saved.pending.index] ? saved.pending : null,
    };
    this.#dom.spin.addEventListener('click', () => this.spin());
    globalThis.addEventListener('resize', () => {
      if (this.#visible) this.#layout();
    }, { passive: true });
    settings.addEventListener('change', (event) => {
      if (event.detail.key === 'theme' && this.#visible) this.#layout();
    });
    session.register('wheel', { hasPendingPlay: () => this.#spinning });
    this.#buildOdds();
    // Un premio sorteado que no llegó a entregarse (recarga a mitad del giro) se entrega ahora.
    if (this.#state.pending) this.#award(this.#state.pending, { recovered: true });
    this.#renderButton();
  }

  #save() {
    storage.write(STATE_KEY, this.#state);
  }

  #buildOdds() {
    const head = el('tr');
    head.append(el('th', '', 'Premio'), el('th', '', 'Probabilidad'));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    const groups = new Map();
    for (const slice of WHEEL_SLICES) {
      const key = slice.type === 'chips' ? `${slice.label} fichas` : slice.label;
      groups.set(key, (groups.get(key) ?? 0) + slice.weight);
    }
    for (const [label, weight] of groups) {
      const row = el('tr');
      row.append(el('td', '', label), el('td', '', `${((weight / WHEEL_TOTAL_WEIGHT) * 100).toFixed(0)} %`));
      body.append(row);
    }
    this.#dom.odds.replaceChildren(thead, body);
  }

  // ---------- Tirada ----------

  get cooldown() {
    return wheelCooldown(this.#state.lastSpin, Date.now());
  }

  async spin() {
    if (this.#spinning || this.cooldown > 0 || this.#state.pending) return;
    this.#spinning = true;
    const stream = session.stream('wheel');
    const { index, slice } = spinWheel(stream);
    const payout = slice.type === 'chips' ? slice.amount : 0;
    session.record(stream, { stake: 0, payout, summary: `Gajo ${index + 1}: ${slice.type === 'chips' ? `${slice.label} fichas` : slice.label}`, params: {} });
    this.#state = { lastSpin: Date.now(), pending: { index, meta: stream.meta } };
    this.#save();
    this.#renderButton();
    this.#dom.message.textContent = 'La rueda gira…';

    const duration = SPIN_MS * settings.speed;
    const start = this.#angle;
    // El puntero está arriba: el gajo i queda bajo él cuando el ángulo ≡ −i·gajo (mod 2π).
    const jitter = (randomFloat() - 0.5) * SLICE * 0.7;
    const base = ((-index * SLICE + jitter) % TAU + TAU) % TAU;
    const current = ((start % TAU) + TAU) % TAU;
    const target = start + (base - current + TAU) % TAU + TAU * 5;
    const began = performance.now();
    let lastSlice = this.#sliceAt(start);
    audio.riser(duration / 1000);
    await new Promise((resolve) => {
      const frame = (now) => {
        const k = Math.min(1, (now - began) / duration);
        this.#angle = start + (target - start) * easeOut(k);
        const under = this.#sliceAt(this.#angle);
        if (under !== lastSlice) {
          lastSlice = under;
          audio.wheelTick();
        }
        this.#draw();
        if (k < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    this.#award(this.#state.pending);
    this.#spinning = false;
    this.#renderButton();
  }

  #sliceAt(angle) {
    const normalized = ((-angle % TAU) + TAU + SLICE / 2) % TAU;
    return Math.floor(normalized / SLICE) % WHEEL_SLICES.length;
  }

  #award(pending, { recovered = false } = {}) {
    const slice = WHEEL_SLICES[pending.index];
    this.#state.pending = null;
    this.#save();
    let text;
    if (slice.type === 'chips') {
      wallet.grant(slice.amount, 'wheel');
      text = `+${formatChips(slice.amount)} fichas`;
    } else if (slice.type === 'potion') {
      relics.addPotion(slice.amount, 'Rueda diaria');
      text = 'una Poción ×2';
    } else {
      relics.addChest('common', 'Rueda diaria');
      text = 'un Cofre común';
    }
    session.report({ game: 'wheel', stake: 0, returned: slice.type === 'chips' ? slice.amount : 0, tags: ['wheel', slice.id] });
    this.#dom.message.textContent = `${recovered ? 'Premio pendiente entregado' : '¡Premio!'}: ${text}${slice.jackpot ? ' · ¡BOTE!' : ''}`;
    if (!recovered) {
      audio.win(slice.jackpot ? 3 : slice.amount >= 1500 ? 2 : 1);
      const rect = this.#dom.canvas.getBoundingClientRect();
      hud.celebrate(slice.jackpot ? 3 : 2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } else {
      hud.toast(`Rueda diaria: ${text}`, 'success', 4200);
    }
  }

  // ---------- Dibujo ----------

  #layout() {
    const { ctx, width } = fitCanvas(this.#dom.canvas, 1);
    this.#ctx = ctx;
    this.#size = { width, ink: cssVar('--cy-ink', '#d8ffe8'), accent: cssVar('--cy-accent', '#00ff66') };
    this.#draw();
  }

  #draw() {
    const ctx = this.#ctx;
    if (!ctx || !this.#size) return;
    const { width, ink, accent } = this.#size;
    const c = width / 2;
    const R = c - 8;
    ctx.clearRect(0, 0, width, width);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(this.#angle);
    WHEEL_SLICES.forEach((slice, i) => {
      const from = -Math.PI / 2 + i * SLICE - SLICE / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, from, from + SLICE);
      ctx.closePath();
      ctx.fillStyle = slice.jackpot ? '#b8860b' : slice.color;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
    // Clavos del borde.
    ctx.fillStyle = '#fff6c2';
    for (let i = 0; i < WHEEL_SLICES.length; i++) {
      const a = -Math.PI / 2 + i * SLICE - SLICE / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (R - 5), Math.sin(a) * (R - 5), 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // Etiquetas siempre derechas: giran con su gajo pero el texto no se pone boca abajo.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.max(11, R * 0.08)}px ui-monospace, Consolas, monospace`;
    WHEEL_SLICES.forEach((slice, i) => {
      const angle = -Math.PI / 2 + i * SLICE + this.#angle;
      const x = c + Math.cos(angle) * R * 0.66;
      const y = c + Math.sin(angle) * R * 0.66;
      ctx.fillStyle = slice.jackpot ? '#fff6c2' : ink;
      ctx.fillText(slice.type === 'chips' ? slice.label : slice.type === 'potion' ? '🧪×2' : '🎁', x, y);
    });
    // Buje central.
    ctx.beginPath();
    ctx.arc(c, c, R * 0.16, 0, TAU);
    ctx.fillStyle = '#0b0f0c';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = `900 ${Math.max(10, R * 0.07)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CYBER', c, c);
  }

  // ---------- Render ----------

  #renderButton() {
    const d = this.#dom;
    const wait = this.cooldown;
    d.spin.disabled = this.#spinning || wait > 0;
    d.spin.textContent = this.#spinning ? 'Girando…' : wait > 0 ? 'Vuelve mañana' : 'Girar la rueda';
    d.cooldown.textContent = wait > 0 ? `Próxima tirada gratis en ${clock(wait)}` : this.#spinning ? '' : '¡Tu tirada diaria está lista!';
    d.cooldown.classList.toggle('is-ready', wait <= 0 && !this.#spinning);
  }

  #tick() {
    clearTimeout(this.#timer);
    if (!this.#visible) return;
    this.#renderButton();
    this.#timer = setTimeout(() => this.#tick(), 1000);
  }

  onShow() {
    this.#visible = true;
    this.#layout();
    this.#tick();
  }

  onHide() {
    this.#visible = false;
    clearTimeout(this.#timer);
  }
}
