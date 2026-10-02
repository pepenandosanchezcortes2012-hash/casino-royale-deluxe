// Crash Rocket: el multiplicador crece en tiempo real, M(t) = 1 + 0,06 · t^1,35, hasta el punto de
// explosión E sorteado al despegar con el flujo provably fair (crash-math.js). Retírate antes de
// que explote (a mano o con retiro automático). La apuesta se cobra al despegar; el retiro se paga
// al instante. Si la página se recarga en pleno vuelo, la ronda se resuelve como lo haría el
// servidor: cobra el retiro automático si el caza llegaba a él y, si no, se pierde.

import { wallet } from '../engine/wallet.js';
import { session } from '../session.js';
import { relics, RADAR_THRESHOLD } from '../relics.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { settings } from '../settings.js';
import { hud, formatChips } from '../ui/hud.js';
import { BetControl } from '../ui/bet-control.js';
import { fmtMult, outcomeTone, pushRecent, trauma, fitCanvas, cssVar } from '../ui/arcade.js';
import { crashPoint, multiplierAt, reachChance, MIN_CASHOUT, CRASH_MAX } from './crash-math.js';
import { randomFloat } from '../engine/rng.js';
import { planeFrames, PALETTE } from '../ui/pixel-sprites.js';
import { shop } from '../arcade/shop.js';
import { daily } from '../arcade/daily.js';

const ROUND_KEY = scopedKey('crd.crash.round.v1');
const PREFS_KEY = scopedKey('crd.crash.prefs.v1');
const ASPECT = 0.62;
// Pixel art: 1 píxel del lienzo = 2 píxeles CSS; todo se alinea a esa rejilla.
const PIXEL = 2;
const snap = (value) => Math.round(value / PIXEL) * PIXEL;
const LABEL_FONT = '"Silkscreen", ui-monospace, monospace';
const TRAIL = 120;
const DEBRIS = 48;
const EXPLOSION_MS = 1300;
const TILT_STEP = Math.PI / 12;
const round2 = (value) => Math.round(value * 100) / 100;
const trunc2 = (value) => Math.floor(value * 100) / 100;
const pct = (value) => `${(value * 100).toFixed(2).replace('.', ',')} %`;

export class CrashGame {
  #root;
  #dom;
  #bet;
  #ctx = null;
  #size = null;
  #state = 'idle';
  #round = null;
  #t = 0;
  #last = 0;
  #raf = 0;
  #visible = false;
  #engine = null;
  #radarShown = false;
  #crashAt = 0;
  #tip = null;
  #readout = '';
  #sprites = null;
  // Día de Turbulencias (desafío diario): el avión vibra y deja más estela. Solo es ambiente.
  #turbulent = false;
  #cell = PIXEL;
  #trail = Array.from({ length: TRAIL }, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: PIXEL }));
  #trailNext = 0;
  #lastDraw = 0;
  #exploded = false;

  constructor(root) {
    this.#root = root;
    // Skin del avión comprada en la tienda: se vuelve a rasterizar al cambiarla.
    shop.addEventListener('change', () => {
      this.#sprites = null;
      if (this.#ctx) this.#layout();
    });
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      stage: $('cr-stage'),
      canvas: $('cr-canvas'),
      mult: $('cr-mult'),
      status: $('cr-state'),
      radar: $('cr-radar'),
      history: $('cr-history'),
      auto: $('cr-auto'),
      autoHint: $('cr-auto-hint'),
      action: $('cr-action'),
      message: $('cr-message'),
      rules: $('cr-rules'),
    };
    this.#bet = new BetControl($('cr-bet'), { game: 'crash', limits: session.limits('crash') });
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    if (Number(prefs.auto) >= MIN_CASHOUT) this.#dom.auto.value = String(prefs.auto);
    this.#dom.rules.textContent = `M(t) = 1 + 0,06 · t^1,35. El punto de explosión es E = 0,97 / (1 − r) con r el primer número verificable de la ronda (truncado; por debajo de ×1,01 explota al despegar, un 3,96 % de las veces). P(llegar a x) = 0,97 / x: RTP del 97 % te retires cuando te retires. Si recargas en pleno vuelo solo cuenta el retiro automático.`;
    this.#bind();
    session.register('crash', {
      onZone: () => this.#bet.setLimits(session.limits('crash')),
      hasPendingPlay: () => this.#state === 'flying',
      blocksExit: () => this.#state === 'flying' && this.#round?.cashed === null && !this.#round?.auto,
    });
    this.#recover();
    this.#renderAutoHint();
    this.#render();
  }

  #bind() {
    const d = this.#dom;
    d.action.addEventListener('click', () => {
      if (this.#state === 'flying') this.cashout();
      else this.start();
    });
    d.auto.addEventListener('change', () => {
      const value = this.#autoValue();
      d.auto.value = value ? value.toFixed(2) : '';
      storage.write(PREFS_KEY, { auto: value });
      this.#renderAutoHint();
    });
    this.#bet.addEventListener('change', () => this.#render());
    wallet.addEventListener('update', () => this.#render());
    globalThis.addEventListener('resize', () => {
      if (this.#visible) this.#layout();
    }, { passive: true });
    settings.addEventListener('change', (event) => {
      if (event.detail.key === 'theme' && this.#visible) this.#layout();
    });
    document.addEventListener('keydown', (event) => {
      if (!this.#visible || event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      if (this.#state === 'flying') this.cashout();
    });
  }

  #autoValue() {
    const value = trunc2(Number(String(this.#dom.auto.value).replace(',', '.')));
    return Number.isFinite(value) && value >= MIN_CASHOUT ? Math.min(value, CRASH_MAX) : null;
  }

  #renderAutoHint() {
    const auto = this.#autoValue();
    this.#dom.autoHint.textContent = auto
      ? `Se retira solo en ${fmtMult(auto)} · probabilidad de llegar: ${pct(reachChance(auto))}`
      : 'Opcional: se retira solo al llegar a ese multiplicador.';
  }

  // ---------- Recuperación tras recargar ----------

  #recover() {
    const open = storage.read(ROUND_KEY, null);
    if (!open) return;
    storage.remove(ROUND_KEY);
    const valid = open && Number(open.bet) > 0 && Number(open.point) >= 1 && open.meta && Number.isInteger(open.meta.nonce);
    if (!valid) return;
    const auto = Number(open.auto) >= MIN_CASHOUT ? Number(open.auto) : null;
    const stream = { meta: open.meta };
    if (auto && auto <= open.point) {
      const payout = round2(open.bet * auto);
      wallet.settle('crash', 0, payout);
      wallet.reveal('crash');
      session.record(stream, { stake: open.bet, payout, summary: `Retiro automático ${fmtMult(auto)} · explota en ${fmtMult(open.point)}`, params: {} });
      session.report({ game: 'crash', stake: open.bet, returned: payout, tags: ['crash-auto'] });
      this.#dom.message.textContent = `Ronda recuperada: el retiro automático en ${fmtMult(auto)} se cobró (+${formatChips(payout)}).`;
    } else {
      session.record(stream, { stake: open.bet, payout: 0, summary: `Explota en ${fmtMult(open.point)}`, params: {} });
      session.report({ game: 'crash', stake: open.bet, returned: 0, tags: [] });
      this.#dom.message.textContent = `La ronda en curso explotó en ${fmtMult(open.point)} mientras no estabas.`;
    }
    pushRecent(this.#dom.history, fmtMult(open.point), open.point >= 2 ? 'big' : 'loss');
  }

  // ---------- Ronda ----------

  start() {
    if (this.#state === 'flying') return;
    const bet = this.#bet.value;
    if (!wallet.hold('crash', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      return;
    }
    const auto = this.#autoValue();
    session.beginRound({ game: 'crash', stake: bet });
    const stream = session.stream('crash');
    const point = crashPoint(stream.float());
    // La apuesta se cobra al despegar; el retiro se abona aparte.
    wallet.settle('crash', bet, 0);
    this.#round = { bet, point, auto, stream, cashed: null };
    storage.write(ROUND_KEY, { bet, point, auto, meta: stream.meta, startedAt: Date.now() });
    this.#state = 'flying';
    this.#t = 0;
    this.#tip = null;
    for (const p of this.#trail) p.life = 0;
    this.#lastDraw = 0;
    this.#radarShown = false;
    this.#dom.radar.hidden = true;
    this.#dom.stage.classList.remove('is-crashed', 'is-radar', 'is-cashed');
    this.#dom.message.textContent = auto ? `¡Despegue! Retiro automático en ${fmtMult(auto)}` : '¡Despegue! Retírate antes de que explote';
    this.#engine = audio.rocket();
    this.#turbulent = daily.active('turbulence');
    this.#bet.setDisabled(true);
    this.#dom.auto.disabled = true;
    this.#render();
    this.#last = performance.now();
    if (!this.#visible) {
      this.#tick(performance.now());
      return;
    }
    cancelAnimationFrame(this.#raf);
    this.#raf = requestAnimationFrame(this.#frame);
  }

  #current() {
    return trunc2(multiplierAt(this.#t));
  }

  cashout(at = null) {
    const round = this.#round;
    if (this.#state !== 'flying' || !round || round.cashed !== null) return;
    const multiplier = Math.min(at ?? this.#current(), round.point);
    if (multiplier < MIN_CASHOUT) return;
    const payout = round2(round.bet * multiplier);
    round.cashed = multiplier;
    wallet.settle('crash', 0, payout);
    wallet.reveal('crash');
    storage.remove(ROUND_KEY);
    session.record(round.stream, { stake: round.bet, payout, summary: `Retiro ${fmtMult(multiplier)} · explota en ${fmtMult(round.point)}`, params: {} });
    session.report({ game: 'crash', stake: round.bet, returned: payout, tags: at ? ['crash-auto'] : [] });
    audio.cashout();
    this.#dom.stage.classList.add('is-cashed');
    this.#dom.message.textContent = `Retirada en ${fmtMult(multiplier)}: cobras ${formatChips(payout)}`;
    const rect = this.#dom.action.getBoundingClientRect();
    hud.celebrate(multiplier >= 10 ? 2 : 1, { x: rect.left + rect.width / 2, y: rect.top });
    this.#render();
  }

  #crash() {
    const round = this.#round;
    this.#state = 'crashed';
    this.#crashAt = performance.now();
    this.#engine?.stop();
    audio.setIntensity(1);
    this.#engine = null;
    audio.crashBoom();
    trauma(this.#dom.stage, 3);
    this.#dom.stage.classList.add('is-crashed');
    this.#dom.radar.hidden = true;
    if (round.cashed === null) {
      wallet.reveal('crash');
      storage.remove(ROUND_KEY);
      session.record(round.stream, { stake: round.bet, payout: 0, summary: `Explota en ${fmtMult(round.point)}`, params: {} });
      session.report({ game: 'crash', stake: round.bet, returned: 0, tags: [] });
      this.#dom.message.textContent = round.point <= 1 ? '¡Explota al despegar! (×1,00)' : `¡BOOM! Explota en ${fmtMult(round.point)}`;
    }
    // Chispas en la punta de la curva (donde estaba el caza).
    const rect = this.#dom.canvas.getBoundingClientRect();
    const scale = this.#size ? rect.width / this.#size.width : 1;
    const tip = this.#tip ?? { x: (rect.width * 0.8) / scale, y: (rect.height * 0.3) / scale };
    hud.sparks(rect.left + tip.x * scale, rect.top + tip.y * scale, 70);
    pushRecent(this.#dom.history, fmtMult(round.point), outcomeTone(round.point >= 2 ? 2 : 0.5));
    this.#bet.setDisabled(false);
    this.#dom.auto.disabled = false;
    this.#paintReadout();
    this.#render();
    setTimeout(() => {
      if (this.#state === 'crashed') {
        this.#state = 'idle';
        this.#render();
      }
    }, 1200 * settings.speed);
  }

  // Avanza el vuelo (también sin pintar, si la mesa no está a la vista).
  #tick(now) {
    const dt = Math.min(0.1, (now - this.#last) / 1000) * (settings.turbo ? 2 : 1);
    this.#last = now;
    const round = this.#round;
    this.#t += dt;
    const multiplier = this.#current();
    this.#engine?.update(multiplier);
    audio.setIntensity(multiplier);
    if (relics.active('radar') && !this.#radarShown && round.point >= MIN_CASHOUT && multiplier >= RADAR_THRESHOLD * round.point) {
      this.#radarShown = true;
      this.#dom.radar.hidden = false;
      this.#dom.stage.classList.add('is-radar');
      audio.radar();
      audio.danger();
    }
    if (round.cashed === null && round.auto && round.auto <= round.point && multiplier >= round.auto) this.cashout(round.auto);
    if (multiplier >= round.point) {
      this.#t = this.#secondsAt(round.point);
      this.#crash();
      return false;
    }
    return true;
  }

  #secondsAt(point) {
    return ((Math.max(0, point - 1)) / 0.06) ** (1 / 1.35);
  }

  #frame = (now) => {
    const flying = this.#state === 'flying' && this.#tick(now);
    this.#draw(now);
    this.#paintReadout();
    if (flying) this.#renderFlight();
    const crashAnim = this.#state === 'crashed' && now - this.#crashAt < EXPLOSION_MS;
    this.#raf = this.#visible && (flying || crashAnim) ? requestAnimationFrame(this.#frame) : 0;
  };

  // En vuelo solo se toca el DOM cuando cambia lo que se ve (el multiplicador va en centésimas).
  #paintReadout() {
    const round = this.#round;
    const value = this.#state === 'crashed' ? round.point : this.#state === 'flying' ? Math.min(this.#current(), round.point) : 1;
    const text = fmtMult(Math.max(1, value));
    if (text === this.#readout) return;
    this.#readout = text;
    this.#dom.mult.textContent = text;
  }

  #renderFlight() {
    const round = this.#round;
    if (!round || round.cashed !== null) return;
    const now = Math.max(1, this.#current());
    const text = now >= MIN_CASHOUT ? `Retirar ${fmtMult(now)} · ${formatChips(round2(round.bet * now))}` : 'Despegando…';
    if (this.#dom.action.textContent !== text) this.#dom.action.textContent = text;
  }

  // ---------- Dibujo ----------

  #layout() {
    // Lienzo a media resolución: cada píxel del lienzo son 2 × 2 píxeles CSS y el navegador lo
    // amplía sin suavizado (pixelated). Se dibuja en coordenadas CSS.
    const { ctx, width, height } = fitCanvas(this.#dom.canvas, ASPECT, PIXEL);
    this.#ctx = ctx;
    this.#size = { width, height, accent: cssVar('--cy-accent', '#00ff66'), ink: cssVar('--cy-ink', '#d8ffe8'), danger: cssVar('--cy-danger', '#ff3b5c') };
    // El caza se dibuja a 1 o 2 píxeles de lienzo por celda según el ancho de la mesa.
    this.#cell = width >= 560 ? 2 * PIXEL : PIXEL;
    this.#sprites ??= planeFrames(shop.equipped('plane')).map(({ grid, palette }) => grid.toCanvas(palette));
    this.#turbulent = daily.active('turbulence');
    this.#draw(performance.now());
  }

  // Estela: cuadrados que nacen en la tobera como fuego y se apagan en humo.
  #emitTrail(x, y, angle) {
    const tail = this.#cell * 26;
    const bx = x - Math.cos(angle) * tail;
    const by = y - Math.sin(angle) * tail;
    for (let n = 0; n < (this.#turbulent ? 3 : 2); n++) {
      const i = this.#trailNext;
      this.#trailNext = (i + 1) % TRAIL;
      const p = this.#trail[i];
      p.x = bx + (randomFloat() - 0.5) * 6;
      p.y = by + (randomFloat() - 0.5) * 6;
      p.vx = -Math.cos(angle) * (40 + randomFloat() * 50);
      p.vy = -Math.sin(angle) * (40 + randomFloat() * 50) - 10;
      p.life = p.max = 0.5 + randomFloat() * 0.5;
      p.size = (randomFloat() < 0.4 ? 3 : 2) * PIXEL;
    }
  }

  // Explosión: metralla de bloques que sale disparada de la punta.
  #explode(x, y) {
    for (let n = 0; n < DEBRIS; n++) {
      const i = this.#trailNext;
      this.#trailNext = (i + 1) % TRAIL;
      const p = this.#trail[i];
      const a = randomFloat() * Math.PI * 2;
      const v = 60 + randomFloat() * 220;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.life = p.max = 0.6 + randomFloat() * 0.7;
      p.size = (2 + Math.floor(randomFloat() * 3)) * PIXEL;
    }
  }

  #stepTrail(dt) {
    for (const p of this.#trail) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy = p.vy * 0.96 - 18 * dt;
    }
  }

  #drawTrail(ctx) {
    const fire = PALETTE.fire;
    const smoke = PALETTE.smoke;
    for (const p of this.#trail) {
      if (p.life <= 0) continue;
      const k = 1 - p.life / p.max;
      const color = k < 0.55 ? fire[Math.min(fire.length - 1, Math.floor((k / 0.55) * fire.length))] : smoke[Math.min(smoke.length - 1, Math.floor(((k - 0.55) / 0.45) * smoke.length))];
      ctx.fillStyle = color;
      ctx.fillRect(snap(p.x), snap(p.y), p.size, p.size);
    }
  }

  // Bola de fuego pixel que se expande en anillos de bloques (blanco → amarillo → rojo → humo).
  #drawBlast(ctx, x, y, age) {
    const radius = 8 + age * 90;
    const block = 3 * PIXEL;
    const bands = [...PALETTE.fire, ...PALETTE.smoke];
    const cx = snap(x);
    const cy = snap(y);
    for (let j = -radius; j <= radius; j += block) {
      for (let i = -radius; i <= radius; i += block) {
        const d = Math.hypot(i + block / 2, j + block / 2);
        if (d > radius) continue;
        // El centro se apaga primero: el fuego se queda en el borde del anillo.
        const k = d / radius;
        if (k < age * 0.9) continue;
        const band = Math.min(bands.length - 1, Math.floor((1 - k) * 3 + age * bands.length * 0.8));
        ctx.fillStyle = bands[band];
        ctx.fillRect(cx + i, cy + j, block, block);
      }
    }
  }

  #draw(now) {
    const ctx = this.#ctx;
    const size = this.#size;
    if (!ctx || !size) return;
    const { width, height, accent, ink, danger } = size;
    const pad = { left: 64, right: 20, top: 18, bottom: 34 };
    ctx.clearRect(0, 0, width, height);
    const t = this.#state === 'idle' ? 0 : this.#t;
    const current = this.#state === 'idle' ? 1 : Math.min(multiplierAt(t), this.#round?.point ?? 1);
    const tMax = Math.max(8, t * 1.18);
    const mMax = Math.max(2, current * 1.22);
    const X = (seconds) => pad.left + (seconds / tMax) * (width - pad.left - pad.right);
    const Y = (m) => height - pad.bottom - ((m - 1) / (mMax - 1)) * (height - pad.top - pad.bottom);

    // Rejilla de puntos y ejes con la fuente pixel (16 px CSS = 8 px de lienzo).
    ctx.font = `16px ${LABEL_FONT}`;
    ctx.fillStyle = ink;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepM = mMax <= 3 ? 0.5 : mMax <= 10 ? 1 : mMax <= 50 ? 5 : mMax <= 200 ? 25 : 100;
    for (let m = 1; m <= mMax; m += stepM) {
      const y = snap(Y(m));
      ctx.globalAlpha = 0.16;
      for (let x = pad.left; x < width - pad.right; x += 8) ctx.fillRect(x, y, 4, PIXEL);
      ctx.globalAlpha = 0.6;
      ctx.fillText(`${String(m).replace('.', ',')}×`, pad.left - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const stepT = tMax <= 12 ? 2 : tMax <= 40 ? 5 : tMax <= 120 ? 20 : 60;
    for (let s = 0; s <= tMax; s += stepT) {
      ctx.globalAlpha = 0.6;
      ctx.fillText(`${s}s`, snap(X(s)), height - pad.bottom + 10);
    }
    ctx.globalAlpha = 0.4;
    ctx.fillRect(pad.left, snap(Y(1)) + PIXEL, width - pad.left - pad.right, PIXEL);
    ctx.globalAlpha = 1;
    if (this.#state === 'idle') return;

    // Curva escalonada: columnas de bloques con un relleno tramado debajo (sin degradados).
    const crashed = this.#state === 'crashed';
    const color = crashed && this.#round?.cashed === null ? danger : accent;
    const x0 = snap(X(0));
    const x1 = snap(X(t));
    const base = snap(Y(1));
    const step = 2 * PIXEL;
    ctx.fillStyle = color;
    for (let x = x0, col = 0; x <= x1; x += step, col++) {
      const s = ((x - pad.left) / (width - pad.left - pad.right)) * tMax;
      const y = snap(Y(Math.min(multiplierAt(Math.min(s, t)), current)));
      ctx.globalAlpha = col % 2 ? 0.1 : 0.2;
      ctx.fillRect(x, y, step, base - y);
      ctx.globalAlpha = 1;
      ctx.fillRect(x, y - PIXEL, step, 2 * PIXEL);
    }

    // Marca del retiro.
    const cashed = this.#round?.cashed;
    if (cashed) {
      const cx = snap(X(this.#secondsAt(cashed)));
      const cy = snap(Y(cashed));
      ctx.fillStyle = '#000';
      ctx.fillRect(cx - 6, cy - 6, 12, 12);
      ctx.fillStyle = accent;
      ctx.fillRect(cx - 4, cy - 4, 8, 8);
      ctx.font = `16px ${LABEL_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#000';
      ctx.fillText(`RETIRO ${fmtMult(cashed)}`, cx + 10 + PIXEL, cy - 6 + PIXEL);
      ctx.fillStyle = accent;
      ctx.fillText(`RETIRO ${fmtMult(cashed)}`, cx + 10, cy - 6);
    }

    // Caza en la punta (inclinado según la pendiente, en pasos de 15°) o la explosión.
    const tipX = X(t);
    const tipY = Y(current);
    this.#tip = { x: tipX, y: tipY };
    const dt = this.#lastDraw ? Math.min(0.05, (now - this.#lastDraw) / 1000) : 0;
    this.#lastDraw = now;
    this.#stepTrail(dt);
    if (crashed) {
      if (!this.#exploded) {
        this.#exploded = true;
        this.#explode(tipX, tipY);
      }
      this.#drawTrail(ctx);
      const age = Math.min(1, (now - this.#crashAt) / EXPLOSION_MS);
      if (age < 1) this.#drawBlast(ctx, tipX, tipY, age);
      return;
    }
    this.#exploded = false;
    const ahead = Math.min(multiplierAt(t + 0.3), mMax);
    const slope = Math.atan2(Y(ahead) - tipY, X(t + 0.3) - tipX);
    const angle = Math.round(slope / TILT_STEP) * TILT_STEP;
    if (this.#state === 'flying') this.#emitTrail(tipX, tipY, angle);
    this.#drawTrail(ctx);
    const frame = this.#sprites[Math.floor(now / 90) % this.#sprites.length];
    const w = frame.width * this.#cell;
    const h = frame.height * this.#cell;
    ctx.save();
    const jolt = this.#turbulent && this.#state === 'flying' ? 3 : 0;
    ctx.translate(snap(tipX + (randomFloat() - 0.5) * 2 * jolt), snap(tipY + (randomFloat() - 0.5) * 2 * jolt));
    ctx.rotate(angle);
    ctx.drawImage(frame, -w + 4 * this.#cell, -h / 2, w, h);
    ctx.restore();
  }

  // ---------- Render ----------

  #render() {
    const d = this.#dom;
    const flying = this.#state === 'flying';
    const round = this.#round;
    if (flying && round?.cashed === null) {
      d.action.disabled = false;
      d.action.classList.add('is-cashout');
      const now = Math.max(1, this.#current());
      d.action.textContent = now >= MIN_CASHOUT ? `Retirar ${fmtMult(now)} · ${formatChips(round2(round.bet * now))}` : 'Despegando…';
      d.status.textContent = 'En vuelo';
    } else if (flying) {
      d.action.disabled = true;
      d.action.classList.remove('is-cashout');
      d.action.textContent = `Cobrado en ${fmtMult(round.cashed)}`;
      d.status.textContent = 'Retirado · el caza sigue';
    } else {
      d.action.classList.remove('is-cashout');
      d.action.disabled = !wallet.canAfford(this.#bet.value);
      d.action.textContent = `Apostar ${formatChips(this.#bet.value)}`;
      d.status.textContent = this.#state === 'crashed' ? 'Explotó' : 'Listo para despegar';
      if (this.#state === 'idle') this.#paintReadout();
    }
    d.stage.dataset.state = this.#state;
  }

  onShow() {
    this.#visible = true;
    this.#layout();
    if (this.#state === 'flying' || this.#state === 'crashed') {
      this.#last = performance.now();
      cancelAnimationFrame(this.#raf);
      this.#raf = requestAnimationFrame(this.#frame);
    }
  }

  // Al cambiar de mesa el vuelo sigue en segundo plano (a baja frecuencia) hasta resolverse.
  onHide() {
    this.#visible = false;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (this.#state !== 'flying') return;
    const step = () => {
      if (this.#visible || this.#state !== 'flying') return;
      if (this.#tick(performance.now())) setTimeout(step, 100);
    };
    setTimeout(step, 100);
  }
}
