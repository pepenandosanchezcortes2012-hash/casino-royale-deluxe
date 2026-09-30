// Crash Rocket: el multiplicador crece en tiempo real, M(t) = 1 + 0,06 · t^1,35, hasta el punto de
// explosión E sorteado al despegar con el flujo provably fair (crash-math.js). Retírate antes de
// que explote (a mano o con retiro automático). La apuesta se cobra al despegar; el retiro se paga
// al instante. Si la página se recarga en pleno vuelo, la ronda se resuelve como lo haría el
// servidor: cobra el retiro automático si el cohete llegaba a él y, si no, se pierde.

import { wallet } from '../engine/wallet.js';
import { session, FREE_LIMITS, FREE_MIN_BET } from '../session.js';
import { relics, RADAR_THRESHOLD } from '../relics.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { settings } from '../settings.js';
import { hud, formatChips } from '../ui/hud.js';
import { BetControl } from '../ui/bet-control.js';
import { fmtMult, outcomeTone, pushRecent, trauma, fitCanvas, cssVar } from '../ui/arcade.js';
import { crashPoint, multiplierAt, reachChance, MIN_CASHOUT, CRASH_MAX } from './crash-math.js';

const ROUND_KEY = scopedKey('crd.crash.round.v1');
const PREFS_KEY = scopedKey('crd.crash.prefs.v1');
const ASPECT = 0.62;
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

  constructor(root) {
    this.#root = root;
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
    this.#bet = new BetControl($('cr-bet'), { game: 'crash', min: FREE_MIN_BET, max: FREE_LIMITS.crash.maxBet, value: 100 });
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    if (Number(prefs.auto) >= MIN_CASHOUT) this.#dom.auto.value = String(prefs.auto);
    this.#dom.rules.textContent = `M(t) = 1 + 0,06 · t^1,35. El punto de explosión es E = 0,97 / (1 − r) con r el primer número verificable de la ronda (truncado; por debajo de ×1,01 explota al despegar, un 3,96 % de las veces). P(llegar a x) = 0,97 / x: RTP del 97 % te retires cuando te retires. Si recargas en pleno vuelo solo cuenta el retiro automático.`;
    this.#bind();
    session.register('crash', {
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
    wallet.addEventListener('change', () => this.#render());
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
    this.#radarShown = false;
    this.#dom.radar.hidden = true;
    this.#dom.stage.classList.remove('is-crashed', 'is-radar', 'is-cashed');
    this.#dom.message.textContent = auto ? `¡Despegue! Retiro automático en ${fmtMult(auto)}` : '¡Despegue! Retírate antes de que explote';
    this.#engine = audio.rocket();
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
    // Chispas en la punta de la curva (donde estaba el cohete).
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
    if (relics.active('radar') && !this.#radarShown && round.point >= MIN_CASHOUT && multiplier >= RADAR_THRESHOLD * round.point) {
      this.#radarShown = true;
      this.#dom.radar.hidden = false;
      this.#dom.stage.classList.add('is-radar');
      audio.radar();
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
    const crashAnim = this.#state === 'crashed' && now - this.#crashAt < 900;
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
    const { ctx, width, height, dpr } = fitCanvas(this.#dom.canvas, ASPECT);
    this.#ctx = ctx;
    this.#size = { width, height, accent: cssVar('--cy-accent', '#00ff66'), ink: cssVar('--cy-ink', '#d8ffe8'), danger: cssVar('--cy-danger', '#ff3b5c') };
    this.#sprites ??= { rocket: this.#emoji('🚀', dpr), boom: this.#emoji('💥', dpr) };
    this.#draw(performance.now());
  }

  // Los emojis se rasterizan una sola vez en un lienzo aparte: dibujarlos con fillText en cada
  // fotograma es caro (fuente de color y fallback de glifos).
  #emoji(glyph, dpr, size = 28) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size * 1.4 * dpr);
    canvas.height = canvas.width;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${size}px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, (size * 1.4) / 2, (size * 1.4) / 2);
    return { canvas, size: size * 1.4 };
  }

  #draw(now) {
    const ctx = this.#ctx;
    const size = this.#size;
    if (!ctx || !size) return;
    const { width, height, accent, ink, danger } = size;
    const pad = { left: 44, right: 18, top: 18, bottom: 30 };
    ctx.clearRect(0, 0, width, height);
    const t = this.#state === 'idle' ? 0 : this.#t;
    const current = this.#state === 'idle' ? 1 : Math.min(multiplierAt(t), this.#round?.point ?? 1);
    const tMax = Math.max(8, t * 1.18);
    const mMax = Math.max(2, current * 1.22);
    const X = (seconds) => pad.left + (seconds / tMax) * (width - pad.left - pad.right);
    const Y = (m) => height - pad.bottom - ((m - 1) / (mMax - 1)) * (height - pad.top - pad.bottom);

    // Rejilla y ejes.
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 1;
    ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.fillStyle = ink;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const stepM = mMax <= 3 ? 0.5 : mMax <= 10 ? 1 : mMax <= 50 ? 5 : mMax <= 200 ? 25 : 100;
    for (let m = 1; m <= mMax; m += stepM) {
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.moveTo(pad.left, Y(m));
      ctx.lineTo(width - pad.right, Y(m));
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.fillText(`${String(m).replace('.', ',')}×`, pad.left - 6, Y(m));
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const stepT = tMax <= 12 ? 2 : tMax <= 40 ? 5 : tMax <= 120 ? 20 : 60;
    for (let s = 0; s <= tMax; s += stepT) {
      ctx.globalAlpha = 0.55;
      ctx.fillText(`${s}s`, X(s), height - pad.bottom + 8);
    }
    ctx.globalAlpha = 1;
    if (this.#state === 'idle') return;

    // Curva y relleno.
    const crashed = this.#state === 'crashed';
    const color = crashed && this.#round?.cashed === null ? danger : accent;
    const steps = 64;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    for (let i = 1; i <= steps; i++) {
      const s = (t * i) / steps;
      ctx.lineTo(X(s), Y(Math.min(multiplierAt(s), current)));
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineTo(X(t), Y(1));
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, Y(current), 0, Y(1));
    fill.addColorStop(0, color);
    fill.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Marca del retiro.
    const cashed = this.#round?.cashed;
    if (cashed) {
      const cx = X(this.#secondsAt(cashed));
      const cy = Y(cashed);
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 12px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`RETIRO ${fmtMult(cashed)}`, cx + 8, cy - 6);
    }

    // Cohete (o explosión) en la punta, orientado según la pendiente de la curva.
    const tipX = X(t);
    const tipY = Y(current);
    this.#tip = { x: tipX, y: tipY };
    if (crashed) {
      const age = Math.min(1, (now - this.#crashAt) / 900);
      ctx.globalAlpha = 1 - age;
      ctx.fillStyle = danger;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 10 + age * 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      const boom = this.#sprites.boom;
      ctx.drawImage(boom.canvas, tipX - boom.size / 2, tipY - boom.size / 2, boom.size, boom.size);
    } else {
      const ahead = Math.min(multiplierAt(t + 0.3), mMax);
      const angle = Math.atan2(Y(ahead) - tipY, X(t + 0.3) - tipX);
      const rocket = this.#sprites.rocket;
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate(angle + Math.PI / 4);
      ctx.drawImage(rocket.canvas, -rocket.size / 2, -rocket.size / 2, rocket.size, rocket.size);
      ctx.restore();
    }
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
      d.status.textContent = 'Retirado · el cohete sigue';
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
