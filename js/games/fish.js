// Cyber-Fish Hunter: acuario en Canvas 2D con un cañón que apunta al cursor o al dedo. Cada bala
// es una apuesta provably fair (fish-math.js): su número se compromete al disparar y decide la
// captura al impactar (r < 0,96 / multiplicador). Peces, balas, partículas, burbujas y números
// flotantes salen de pools de tamaño fijo (el bucle no crea objetos), los sprites de las
// criaturas se pintan una sola vez y el bucle requestAnimationFrame solo corre con la mesa
// visible y la pestaña del navegador activa. Al ocultarse, las balas en vuelo se devuelven (su
// número sigue oculto: devolverlas no revela nada).

import { wallet } from '../engine/wallet.js';
import { session } from '../session.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { randomFloat } from '../engine/rng.js';
import { hud, formatChips } from '../ui/hud.js';
import { el } from '../ui/svg.js';
import { fmtMult, outcomeTone, pushRecent, trauma } from '../ui/arcade.js';
import { settings } from '../settings.js';
import {
  SPECIES, FISH_RTP, FIRE_INTERVAL_MS, MAX_BULLETS, BULLET_LIFETIME_MS, VOLLEY_MS, VOLLEY_MAX,
  KRAKEN_EVERY_MS, KRAKEN_STAY_MS, captureChance, resolveShot, pickSpecies, speciesById, Volley,
} from './fish-math.js';

const PREFS_KEY = scopedKey('crd.fish.prefs.v1');
const FISH_POOL = 36;
const PARTICLE_POOL = 360;
const FLOATER_POOL = 24;
const BUBBLE_POOL = 36;
const BULLET_SPEED = 820;
const BULLET_RADIUS = 5;
const MAX_BOUNCES = 3;
const AUTO_INTERVAL_MS = 240;
// Pixel art: el acuario se dibuja a media resolución y el navegador lo escala con
// image-rendering: pixelated (bloques nítidos y 4 veces menos píxeles que pintar).
const PIXEL_SCALE = 0.5;
const PIXEL_FONT = '"Syndicate Pixel", ui-monospace, monospace';
const CANNON_MARGIN = 30;
const AIM_SPEED = 7;
const TAU = Math.PI * 2;
const MIN_ANGLE = -Math.PI + 0.12;
const MAX_ANGLE = -0.12;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percent = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
// A 20 y 40 px cada píxel de la fuente cae justo en 1 y 2 píxeles del lienzo.
const FLOAT_FONT = `20px ${PIXEL_FONT}`;
const FLOAT_FONT_BIG = `40px ${PIXEL_FONT}`;
const snap = (value) => Math.round(value / 2) * 2;
const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Pool de objetos de tamaño fijo con pila de huecos libres: acquire() y release() en O(1).
class Pool {
  #free;

  constructor(size, make) {
    this.items = Array.from({ length: size }, () => ({ ...make(), active: false }));
    this.#free = this.items.slice().reverse();
  }

  get used() {
    return this.items.length - this.#free.length;
  }

  acquire() {
    const item = this.#free.pop();
    if (!item) return null;
    item.active = true;
    return item;
  }

  release(item) {
    if (!item.active) return;
    item.active = false;
    this.#free.push(item);
  }

  clear() {
    for (const item of this.items) this.release(item);
  }
}

// ---------- Sprites (se pintan una vez por especie y densidad de pantalla) ----------

function spriteCanvas(w, h, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, (w / 2) * dpr, (h / 2) * dpr);
  return { canvas, ctx };
}

function eye(ctx, x, y, r) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#05060a';
  ctx.beginPath();
  ctx.arc(x + r * 0.25, y, r * 0.55, 0, TAU);
  ctx.fill();
}

const PAINTERS = {
  neon(ctx, r, color, deep) {
    const body = ctx.createLinearGradient(0, -r * 0.6, 0, r * 0.6);
    body.addColorStop(0, color);
    body.addColorStop(1, deep);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-r * 0.75, 0);
    ctx.lineTo(-r * 1.3, -r * 0.55);
    ctx.lineTo(-r * 1.2, 0);
    ctx.lineTo(-r * 1.3, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(r * 0.05, 0, r, r * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.5);
    ctx.lineTo(r * 0.25, -r * 0.85);
    ctx.lineTo(r * 0.45, -r * 0.45);
    ctx.fill();
    eye(ctx, r * 0.55, -r * 0.12, r * 0.17);
  },
  jelly(ctx, r, color, deep) {
    const dome = ctx.createRadialGradient(0, -r * 0.5, r * 0.1, 0, -r * 0.2, r);
    dome.addColorStop(0, '#ffffff');
    dome.addColorStop(0.35, color);
    dome.addColorStop(1, deep);
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.1, r * 0.85, r * 0.7, 0, Math.PI, 0);
    ctx.quadraticCurveTo(0, r * 0.05, -r * 0.85, -r * 0.1);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x = -r * 0.6 + i * r * 0.3;
      ctx.beginPath();
      ctx.moveTo(x, -r * 0.05);
      ctx.bezierCurveTo(x - r * 0.2, r * 0.35, x + r * 0.2, r * 0.6, x - r * 0.05, r * 1.0);
      ctx.stroke();
    }
    // Chispas eléctricas.
    ctx.strokeStyle = '#fff6a8';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.55);
    ctx.lineTo(-r * 0.1, -r * 0.35);
    ctx.lineTo(-r * 0.2, -r * 0.3);
    ctx.lineTo(r * 0.05, -r * 0.1);
    ctx.stroke();
  },
  manta(ctx, r, color, deep) {
    const wing = ctx.createLinearGradient(-r, 0, r, 0);
    wing.addColorStop(0, deep);
    wing.addColorStop(0.6, color);
    wing.addColorStop(1, deep);
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(r * 0.85, 0);
    ctx.quadraticCurveTo(r * 0.2, -r * 0.2, -r * 0.1, -r * 0.95);
    ctx.quadraticCurveTo(-r * 0.25, -r * 0.3, -r * 0.6, 0);
    ctx.quadraticCurveTo(-r * 0.25, r * 0.3, -r * 0.1, r * 0.95);
    ctx.quadraticCurveTo(r * 0.2, r * 0.2, r * 0.85, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, 0);
    ctx.lineTo(-r * 1.25, r * 0.05);
    ctx.stroke();
    // Circuitos de las alas.
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.1);
    ctx.lineTo(-r * 0.05, -r * 0.55);
    ctx.lineTo(-r * 0.2, -r * 0.6);
    ctx.moveTo(r * 0.1, r * 0.1);
    ctx.lineTo(-r * 0.05, r * 0.55);
    ctx.lineTo(-r * 0.2, r * 0.6);
    ctx.stroke();
    eye(ctx, r * 0.55, -r * 0.12, r * 0.08);
    eye(ctx, r * 0.55, r * 0.12, r * 0.08);
  },
  shark(ctx, r, color, deep) {
    const body = ctx.createLinearGradient(0, -r * 0.4, 0, r * 0.4);
    body.addColorStop(0, color);
    body.addColorStop(1, deep);
    ctx.fillStyle = body;
    // Aleta dorsal y cola.
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.3);
    ctx.lineTo(-r * 0.35, -r * 0.75);
    ctx.lineTo(-r * 0.45, -r * 0.28);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.85, 0);
    ctx.lineTo(-r * 1.3, -r * 0.55);
    ctx.lineTo(-r * 1.12, 0);
    ctx.lineTo(-r * 1.3, r * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.95, r * 0.34, 0, 0, TAU);
    ctx.fill();
    // Cabeza de martillo.
    ctx.beginPath();
    ctx.roundRect(r * 0.75, -r * 0.55, r * 0.26, r * 1.1, r * 0.12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    // Placas de blindaje.
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = 2;
    for (const x of [-r * 0.45, -r * 0.1, r * 0.25]) {
      ctx.beginPath();
      ctx.moveTo(x, -r * 0.3);
      ctx.quadraticCurveTo(x + r * 0.08, 0, x, r * 0.3);
      ctx.stroke();
    }
    eye(ctx, r * 0.88, -r * 0.48, r * 0.09);
    eye(ctx, r * 0.88, r * 0.48, r * 0.09);
  },
  kraken(ctx, r, color, deep) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const spread = (i - 3.5) / 3.5;
      ctx.lineWidth = r * 0.11;
      ctx.beginPath();
      ctx.moveTo(spread * r * 0.35, r * 0.05);
      ctx.bezierCurveTo(spread * r * 0.6, r * 0.45, spread * r * 1.05 + r * 0.15 * Math.sin(i * 1.7), r * 0.55, spread * r * 0.95, r * 0.95);
      ctx.stroke();
    }
    const head = ctx.createRadialGradient(-r * 0.15, -r * 0.55, r * 0.05, 0, -r * 0.3, r * 0.7);
    head.addColorStop(0, '#ffd0ec');
    head.addColorStop(0.35, color);
    head.addColorStop(1, deep);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.32, r * 0.62, r * 0.58, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Ojos que brillan.
    ctx.shadowColor = '#fff36b';
    ctx.shadowBlur = r * 0.2;
    ctx.fillStyle = '#fff36b';
    for (const x of [-r * 0.22, r * 0.22]) {
      ctx.beginPath();
      ctx.ellipse(x, -r * 0.25, r * 0.11, r * 0.07, 0, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#16000a';
    for (const x of [-r * 0.22, r * 0.22]) {
      ctx.beginPath();
      ctx.ellipse(x, -r * 0.25, r * 0.03, r * 0.06, 0, 0, TAU);
      ctx.fill();
    }
  },
};

function paintSpecies(kind, dpr) {
  const r = kind.size;
  const w = Math.ceil(r * 2.8);
  const h = Math.ceil(r * 2.4);
  const { canvas, ctx } = spriteCanvas(w, h, dpr);
  const color = `hsl(${kind.hue} 72% 60%)`;
  const deep = `hsl(${kind.hue} 60% 20%)`;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(6, r * 0.45);
  PAINTERS[kind.id](ctx, r, color, deep);
  return { canvas, w, h, color };
}

// Bala con su halo ya pintado (shadowBlur en cada fotograma sería caro).
function paintBullet(dpr) {
  const size = BULLET_RADIUS * 6;
  const { canvas, ctx } = spriteCanvas(size, size, dpr);
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = BULLET_RADIUS * 1.8;
  ctx.fillStyle = '#e8fdff';
  ctx.beginPath();
  ctx.arc(0, 0, BULLET_RADIUS, 0, TAU);
  ctx.fill();
  return { canvas, w: size, h: size };
}

// Cañón: base (fija) y tubo (gira con la puntería), pintados una vez.
function paintCannon(dpr) {
  const base = spriteCanvas(52, 52, dpr);
  const glow = base.ctx.createRadialGradient(-6, -6, 2, 0, 0, 24);
  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.4, '#ff2bd6');
  glow.addColorStop(1, '#3a0533');
  base.ctx.fillStyle = glow;
  base.ctx.beginPath();
  base.ctx.arc(0, 0, 22, 0, TAU);
  base.ctx.fill();
  const barrel = spriteCanvas(96, 24, dpr);
  const metal = barrel.ctx.createLinearGradient(0, -9, 0, 9);
  metal.addColorStop(0, '#9ff8ff');
  metal.addColorStop(0.5, '#1aa5c4');
  metal.addColorStop(1, '#063a4a');
  barrel.ctx.fillStyle = metal;
  barrel.ctx.beginPath();
  barrel.ctx.roundRect(4, -9, 34, 18, 5);
  barrel.ctx.fill();
  barrel.ctx.strokeStyle = '#e8fdff';
  barrel.ctx.lineWidth = 1.5;
  barrel.ctx.stroke();
  return { base: { canvas: base.canvas, w: 52, h: 52 }, barrel: { canvas: barrel.canvas, w: 96, h: 24 } };
}

// Etiqueta «×8» cacheada por multiplicador.
function paintLabel(text, dpr, color) {
  const w = 12 + text.length * 12;
  const h = 26;
  const { canvas, ctx } = spriteCanvas(w, h, dpr);
  ctx.font = `20px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Sombra dura de un píxel en lugar de contorno difuminado.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillText(text, 2, 8);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 6);
  return { canvas, w, h };
}

export class FishGame {
  #root;
  #dom;
  #ctx = null;
  #geo = null;
  #sprites = new Map();
  #labels = new Map();
  #fish = new Pool(FISH_POOL, () => ({ kind: null, mult: 1, x: 0, y: 0, vx: 0, baseY: 0, amp: 0, freq: 0, phase: 0, size: 10, dir: 1, flash: -1e9, hits: 0, boss: false, until: 0, leaving: false, vy: 0, label: null }));
  #bulletSprite = null;
  #cannon = null;
  #bullets = new Pool(MAX_BULLETS, () => ({ x: 0, y: 0, vx: 0, vy: 0, born: 0, bounces: 0, bet: 0, roll: 0, meta: null, volley: null }));
  #particles = new Pool(PARTICLE_POOL, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff' }));
  #floaters = new Pool(FLOATER_POOL, () => ({ x: 0, y: 0, life: 0, max: 1, text: '', color: '#fff', big: false }));
  #bubbles = new Pool(BUBBLE_POOL, () => ({ x: 0, y: 0, vy: 0, r: 2, phase: 0 }));
  #volley = null;
  #volleys = [];
  #bet = 50;
  #auto = false;
  #aimAssist = false;
  #holding = false;
  #pointer = null;
  #angle = -Math.PI / 2;
  #target = null;
  #clock = 0;
  #lastShot = -1e9;
  #nextSpawn = 0;
  #nextKraken = KRAKEN_EVERY_MS * 0.4;
  #kraken = null;
  #raf = 0;
  #last = 0;
  #visible = false;
  #flying = 0;
  #volleyCount = 0;
  #statsShown = [-1, -1];
  #shake = 0;
  #recoil = 0;
  #lastNote = -1e9;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      stage: $('fs-stage'),
      canvas: $('fs-canvas'),
      bg: $('fs-bg'),
      boss: $('fs-boss'),
      bossMult: $('fs-boss-mult'),
      recent: $('fs-recent'),
      bullets: $('fs-bullets'),
      fire: $('fs-fire'),
      auto: $('fs-auto'),
      aim: $('fs-aim'),
      volley: $('fs-volley'),
      flying: $('fs-flying'),
      message: $('fs-message'),
      species: $('fs-species'),
      rules: $('fs-rules'),
    };
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    this.#bet = Number.isFinite(prefs.bet) ? prefs.bet : 0;
    this.#aimAssist = prefs.aim === true;
    this.#fitBet();
    this.#buildBullets();
    this.#buildSpecies();
    this.#bind();
    session.register('fish', {
      hasPendingPlay: () => this.#bullets.used > 0 || this.#volleys.length > 0,
      onZone: () => {
        this.#fitBet();
        this.#buildBullets();
        this.#renderControls();
      },
    });
    // Las etiquetas del lienzo usan la fuente pixel: se repintan cuando termina de cargar.
    document.fonts?.load(`20px ${PIXEL_FONT}`).then(() => {
      this.#labels.clear();
      for (const fish of this.#fish.items) fish.label = null;
    }, () => {});
    this.#dom.rules.textContent = `Cada bala es una apuesta con su propio número verificable, comprometido al disparar. Al impactar, captura la criatura si ese número es menor que ${percent.format(FISH_RTP)} ÷ su multiplicador: el RTP es del 96 % apuntes a donde apuntes. La resistencia de las criaturas grandes es visual (cada impacto es un sorteo independiente) y el Mega Kraken aparece cada ${Math.round(KRAKEN_EVERY_MS / 1000)} s. Las balas disparadas en ${VOLLEY_MS / 1000} s (hasta ${VOLLEY_MAX}) forman una ronda. Si cambias de mesa o de pestaña, las balas en vuelo se devuelven.`;
    this.#renderControls();
  }

  // ---------- Controles ----------

  #limits() {
    return session.limits('fish');
  }

  #fitBet() {
    const list = this.#limits().bullets;
    if (!list.includes(this.#bet)) this.#bet = list[0];
  }

  #savePrefs() {
    storage.write(PREFS_KEY, { bet: this.#bet, aim: this.#aimAssist });
  }

  #buildBullets() {
    const buttons = this.#limits().bullets.map((value) => {
      const button = el('button', 'seg', formatChips(value));
      button.type = 'button';
      button.dataset.bet = String(value);
      button.setAttribute('aria-label', `${formatChips(value)} créditos por bala`);
      button.addEventListener('click', () => {
        audio.click();
        this.#bet = value;
        this.#savePrefs();
        this.#renderControls();
      });
      return button;
    });
    this.#dom.bullets.replaceChildren(...buttons);
  }

  #buildSpecies() {
    const head = el('tr');
    head.append(el('th', '', 'Criatura'), el('th', '', 'Premio'), el('th', '', 'Captura por impacto'));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const kind of SPECIES) {
      const row = el('tr');
      const min = kind.multipliers[0];
      const max = kind.multipliers[kind.multipliers.length - 1];
      const prize = min === max ? fmtMult(min) : `${fmtMult(min)} – ${fmtMult(max)}`;
      const chance = min === max
        ? `${percent.format(captureChance(min) * 100)} %`
        : `${percent.format(captureChance(max) * 100)} – ${percent.format(captureChance(min) * 100)} %`;
      const name = el('td', `fs-name is-${kind.id}`, kind.name);
      row.append(name, el('td', '', prize), el('td', '', chance));
      body.append(row);
    }
    this.#dom.species.replaceChildren(thead, body);
  }

  #bind() {
    const d = this.#dom;
    d.fire.addEventListener('click', () => {
      if (!this.#fire()) this.#explainBlocked();
    });
    d.auto.addEventListener('click', () => {
      audio.click();
      this.#setAuto(!this.#auto);
    });
    d.aim.addEventListener('click', () => {
      audio.click();
      this.#aimAssist = !this.#aimAssist;
      this.#target = null;
      this.#savePrefs();
      this.#renderControls();
    });
    const canvas = d.canvas;
    const toWorld = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (!this.#geo || !rect.width) return null;
      return { x: ((event.clientX - rect.left) / rect.width) * this.#geo.w, y: ((event.clientY - rect.top) / rect.height) * this.#geo.h };
    };
    canvas.addEventListener('pointermove', (event) => {
      this.#pointer = toWorld(event);
    });
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      this.#pointer = toWorld(event);
      this.#holding = true;
      canvas.setPointerCapture?.(event.pointerId);
      audio.unlock();
      this.#aimAt(this.#pointer, true);
      if (!this.#fire()) this.#explainBlocked();
    });
    const release = () => {
      this.#holding = false;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('lostpointercapture', release);
    canvas.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.#angle = clamp(this.#angle + (event.key === 'ArrowLeft' ? -0.12 : 0.12), MIN_ANGLE, MAX_ANGLE);
        this.#pointer = null;
        this.#draw();
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (!this.#fire()) this.#explainBlocked();
      }
    });
    wallet.addEventListener('update', () => this.#renderControls());
    globalThis.addEventListener('resize', () => {
      if (this.#visible) this.#layout();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.#pause();
      else if (this.#visible) this.#ensureLoop();
    });
  }

  #setAuto(on) {
    this.#auto = Boolean(on);
    this.#renderControls();
    if (this.#auto) this.#ensureLoop();
  }

  #explainBlocked() {
    if (!session.playable) return;
    if (!wallet.canAfford(this.#bet)) this.#dom.message.textContent = `Saldo insuficiente para una bala de ${formatChips(this.#bet)} créditos`;
    else if (this.#bullets.used >= MAX_BULLETS) this.#dom.message.textContent = `Como mucho ${MAX_BULLETS} balas en el aire`;
  }

  #renderControls() {
    const d = this.#dom;
    for (const button of d.bullets.querySelectorAll('[data-bet]')) {
      const value = Number(button.dataset.bet);
      button.setAttribute('aria-pressed', String(value === this.#bet));
      button.disabled = !wallet.canAfford(value) && value !== this.#bet;
    }
    const affordable = wallet.canAfford(this.#bet);
    d.fire.disabled = !affordable || !session.playable;
    d.fire.textContent = `Disparar · ${formatChips(this.#bet)}`;
    d.auto.setAttribute('aria-pressed', String(this.#auto));
    d.aim.setAttribute('aria-pressed', String(this.#aimAssist));
    this.#renderStats();
  }

  #renderStats() {
    const shown = this.#statsShown;
    if (shown[0] === this.#volleyCount && shown[1] === this.#flying) return;
    shown[0] = this.#volleyCount;
    shown[1] = this.#flying;
    this.#dom.volley.textContent = String(this.#volleyCount);
    this.#dom.flying.textContent = String(this.#flying);
  }

  // ---------- Geometría y sprites ----------

  #layout() {
    const canvas = this.#dom.canvas;
    const width = Math.max(280, canvas.clientWidth || canvas.parentElement?.clientWidth || 320);
    const aspect = width < 560 ? 1.02 : width < 820 ? 0.7 : 0.5;
    const height = Math.round(width * aspect);
    const dpr = PIXEL_SCALE;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    this.#ctx = canvas.getContext('2d');
    const prev = this.#geo;
    this.#geo = { w: width, h: height, dpr, cx: width / 2, cy: height - CANNON_MARGIN };
    // Al cambiar de tamaño, todo lo que nada se reescala con el acuario.
    if (prev && (prev.w !== width || prev.h !== height)) {
      const sx = width / prev.w;
      const sy = height / prev.h;
      for (const fish of this.#fish.items) {
        if (!fish.active) continue;
        fish.x *= sx;
        fish.baseY *= sy;
        fish.y *= sy;
      }
      for (const bubble of this.#bubbles.items) {
        bubble.x *= sx;
        bubble.y *= sy;
      }
    }
    if (!prev || prev.dpr !== dpr) {
      this.#sprites.clear();
      this.#labels.clear();
      for (const kind of SPECIES) this.#sprites.set(kind.id, paintSpecies(kind, dpr));
      this.#bulletSprite = paintBullet(dpr);
      this.#cannon = paintCannon(dpr);
      for (const fish of this.#fish.items) fish.label = null;
    }
    this.#paintBackground();
    this.#draw();
  }

  // El fondo se pinta una vez en su propio lienzo, debajo del de la acción.
  #paintBackground() {
    const { w, h, dpr } = this.#geo;
    const canvas = this.#dom.bg;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const water = ctx.createLinearGradient(0, 0, 0, h);
    water.addColorStop(0, '#04263a');
    water.addColorStop(0.55, '#031827');
    water.addColorStop(1, '#010a12');
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, w, h);
    // Rayos de luz desde la superficie.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = (w * (i + 0.5)) / 5 + (i % 2 ? 30 : -20);
      const ray = ctx.createLinearGradient(x, 0, x + 60, h * 0.8);
      ray.addColorStop(0, 'rgba(90, 220, 255, 0.10)');
      ray.addColorStop(1, 'rgba(90, 220, 255, 0)');
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.moveTo(x - 30, 0);
      ctx.lineTo(x + 30, 0);
      ctx.lineTo(x + 140, h * 0.8);
      ctx.lineTo(x + 40, h * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Rejilla cibernética del fondo.
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 48) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y <= h; y += 48) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    // Fondo marino con la plataforma del cañón.
    const sand = ctx.createLinearGradient(0, h - 46, 0, h);
    sand.addColorStop(0, 'rgba(255, 43, 214, 0.0)');
    sand.addColorStop(1, 'rgba(255, 43, 214, 0.22)');
    ctx.fillStyle = sand;
    ctx.fillRect(0, h - 46, w, 46);
    ctx.strokeStyle = 'rgba(255, 43, 214, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, h - 8.5);
    ctx.lineTo(w, h - 8.5);
    ctx.stroke();
  }

  #label(multiplier, color) {
    const key = `${multiplier}|${color}`;
    let label = this.#labels.get(key);
    if (!label) {
      label = paintLabel(fmtMult(multiplier).replace(',00', ''), this.#geo.dpr, color);
      this.#labels.set(key, label);
    }
    return label;
  }

  // ---------- Criaturas ----------

  #population() {
    const { w, h } = this.#geo;
    return clamp(Math.round((w * h) / 42_000), 6, 15);
  }

  #spawn(kind, { boss = false } = {}) {
    const fish = this.#fish.acquire();
    if (!fish) return null;
    const { w, h } = this.#geo;
    const fromLeft = randomFloat() < 0.5;
    const size = kind.size;
    const top = size + 10;
    const bottom = h - CANNON_MARGIN - 70 - size;
    fish.kind = kind;
    fish.mult = kind.multipliers[Math.floor(randomFloat() * kind.multipliers.length)];
    fish.size = size;
    fish.dir = fromLeft ? 1 : -1;
    fish.x = fromLeft ? -size * 1.4 : w + size * 1.4;
    fish.baseY = top + randomFloat() * Math.max(10, bottom - top);
    fish.y = fish.baseY;
    const speed = kind.speed[0] + randomFloat() * (kind.speed[1] - kind.speed[0]);
    fish.vx = speed * fish.dir;
    fish.vy = 0;
    fish.amp = boss ? 24 : 8 + randomFloat() * (kind.id === 'jelly' ? 34 : 18);
    fish.freq = boss ? 0.35 : 0.5 + randomFloat() * 0.8;
    fish.phase = randomFloat() * TAU;
    fish.flash = -1e9;
    fish.hits = 0;
    fish.boss = boss;
    fish.leaving = false;
    fish.until = boss ? this.#clock + KRAKEN_STAY_MS : 0;
    fish.label = null;
    return fish;
  }

  // Al abrir la sala vacía, el acuario ya tiene criaturas nadando (no solo las que entran).
  #prefill() {
    if (this.#fish.used > 0 || !this.#geo) return;
    const count = Math.round(this.#population() * 0.7);
    for (let i = 0; i < count; i++) {
      const fish = this.#spawn(pickSpecies(randomFloat()));
      if (fish) fish.x = fish.size + randomFloat() * Math.max(10, this.#geo.w - fish.size * 2);
    }
  }

  #spawnKraken() {
    const kraken = this.#spawn(speciesById('kraken'), { boss: true });
    if (!kraken) return;
    this.#kraken = kraken;
    this.#dom.bossMult.textContent = fmtMult(kraken.mult).replace(',00', '');
    this.#dom.boss.hidden = false;
    this.#dom.message.textContent = `¡El Mega Kraken ${fmtMult(kraken.mult)} entra en la sala! Cada impacto lo captura con un ${percent.format(captureChance(kraken.mult) * 100)} %`;
    audio.radar();
    audio.riser(1.2);
  }

  #krakenGone() {
    this.#kraken = null;
    this.#dom.boss.hidden = true;
    this.#nextKraken = this.#clock + KRAKEN_EVERY_MS;
  }

  #moveFish(dt) {
    const { w } = this.#geo;
    let alive = 0;
    for (const fish of this.#fish.items) {
      if (!fish.active) continue;
      if (fish.boss) {
        // El Kraken patrulla la sala hasta que se cumple su tiempo y después se marcha.
        if (!fish.leaving && this.#clock >= fish.until) fish.leaving = true;
        if (!fish.leaving) {
          if (fish.x < fish.size && fish.vx < 0) fish.vx = -fish.vx;
          if (fish.x > w - fish.size && fish.vx > 0) fish.vx = -fish.vx;
          fish.dir = fish.vx >= 0 ? 1 : -1;
        }
      }
      fish.x += fish.vx * dt;
      const prevY = fish.y;
      fish.y = fish.baseY + Math.sin(this.#clock / 1000 * fish.freq * TAU + fish.phase) * fish.amp;
      fish.vy = dt > 0 ? (fish.y - prevY) / dt : 0;
      const margin = fish.size * 1.6;
      if ((fish.vx > 0 && fish.x > w + margin) || (fish.vx < 0 && fish.x < -margin)) {
        if (fish === this.#kraken) this.#krakenGone();
        this.#fish.release(fish);
        continue;
      }
      if (!fish.boss) alive++;
    }
    if (this.#clock >= this.#nextSpawn && alive < this.#population()) {
      this.#spawn(pickSpecies(randomFloat()));
      this.#nextSpawn = this.#clock + 350 + randomFloat() * 700;
    }
    if (!this.#kraken && this.#clock >= this.#nextKraken) this.#spawnKraken();
  }

  // ---------- Cañón y disparos ----------

  #aimAt(point, instant = false) {
    if (!point || !this.#geo) return;
    const angle = clamp(Math.atan2(point.y - this.#geo.cy, point.x - this.#geo.cx), MIN_ANGLE, MAX_ANGLE);
    if (instant) this.#angle = angle;
    return angle;
  }

  // Auto-apuntar: la criatura más valiosa a la vista (a igual premio, la más cercana), con
  // anticipación según la velocidad de la bala.
  #pickTarget() {
    const { w, cy } = this.#geo;
    let best = null;
    for (const fish of this.#fish.items) {
      if (!fish.active || fish.x < fish.size * 0.5 || fish.x > w - fish.size * 0.5 || fish.y > cy - 50) continue;
      if (!best || fish.mult > best.mult || (fish.mult === best.mult && Math.abs(fish.x - this.#geo.cx) < Math.abs(best.x - this.#geo.cx))) best = fish;
    }
    return best;
  }

  #steer(dt) {
    let goal = null;
    if (this.#aimAssist) {
      if (!this.#target?.active) this.#target = this.#pickTarget();
      const target = this.#target;
      if (target) {
        const dist = Math.hypot(target.x - this.#geo.cx, target.y - this.#geo.cy);
        const t = dist / BULLET_SPEED;
        goal = this.#aimAt({ x: target.x + target.vx * t, y: target.y + target.vy * t });
      }
    } else if (this.#pointer) {
      goal = this.#aimAt(this.#pointer);
    }
    if (goal === null || goal === undefined) return;
    const delta = goal - this.#angle;
    const step = AIM_SPEED * dt;
    this.#angle = Math.abs(delta) <= step ? goal : this.#angle + Math.sign(delta) * step;
  }

  #fire() {
    if (!this.#geo || !session.playable || !session.available('fish')) return false;
    if (this.#bullets.used >= MAX_BULLETS) return false;
    if (this.#clock - this.#lastShot < FIRE_INTERVAL_MS) return true;
    const bet = this.#bet;
    if (!wallet.hold('fish', bet)) {
      if (this.#auto) this.#setAuto(false);
      return false;
    }
    const now = this.#clock;
    if (!this.#volley || !this.#volley.open(now)) {
      if (this.#volley) this.#volley.sealed = true;
      this.#volley = new Volley(now);
      this.#volleys.push(this.#volley);
      session.beginRound({ game: 'fish', stake: bet });
    }
    this.#volley.fire(bet);
    // El número de la bala se compromete ahora (nonce consumido); decide la captura al impactar.
    const stream = session.stream('fish');
    const bullet = this.#bullets.acquire();
    const { cx, cy } = this.#geo;
    const cos = Math.cos(this.#angle);
    const sin = Math.sin(this.#angle);
    bullet.x = cx + cos * 34;
    bullet.y = cy + sin * 34;
    bullet.vx = cos * BULLET_SPEED;
    bullet.vy = sin * BULLET_SPEED;
    bullet.born = now;
    bullet.bounces = 0;
    bullet.bet = bet;
    bullet.roll = stream.float();
    bullet.meta = stream.meta;
    bullet.volley = this.#volley;
    this.#lastShot = now;
    this.#flying = this.#bullets.used;
    this.#recoil = 1;
    audio.ballTick(0.45);
    this.#ensureLoop();
    return true;
  }

  #moveBullets(dt) {
    const { w, h } = this.#geo;
    for (const bullet of this.#bullets.items) {
      if (!bullet.active) continue;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      // Rebota en las paredes y en la superficie, como en las salas de pesca arcade.
      if ((bullet.x < BULLET_RADIUS && bullet.vx < 0) || (bullet.x > w - BULLET_RADIUS && bullet.vx > 0)) {
        bullet.vx = -bullet.vx;
        bullet.bounces++;
      }
      if (bullet.y < BULLET_RADIUS && bullet.vy < 0) {
        bullet.vy = -bullet.vy;
        bullet.bounces++;
      }
      if (bullet.bounces > MAX_BOUNCES || bullet.y > h + 20 || this.#clock - bullet.born > BULLET_LIFETIME_MS) {
        this.#refund(bullet);
        continue;
      }
      for (const fish of this.#fish.items) {
        if (!fish.active) continue;
        const reach = fish.size * (fish.boss ? 0.62 : 0.8) + BULLET_RADIUS;
        const dx = fish.x - bullet.x;
        const dy = (fish.boss ? fish.y - fish.size * 0.2 : fish.y) - bullet.y;
        if (dx * dx + dy * dy <= reach * reach) {
          this.#hit(bullet, fish);
          break;
        }
      }
    }
    this.#flying = this.#bullets.used;
  }

  #hit(bullet, fish) {
    const shot = resolveShot(bullet.roll, fish.mult);
    const payout = shot.captured ? round2(bullet.bet * fish.mult) : 0;
    wallet.settle('fish', bullet.bet, payout);
    wallet.reveal('fish', { amount: payout, stake: bullet.bet });
    session.record({ meta: bullet.meta }, {
      stake: bullet.bet,
      payout,
      summary: `${fish.kind.name} ${fmtMult(fish.mult)} · ${shot.captured ? 'capturada' : 'escapa'}`,
      params: { species: fish.kind.id, multiplier: fish.mult },
    });
    bullet.volley.hit(shot.captured ? { multiplier: fish.mult, species: fish.kind.id, payout } : null);
    this.#burst(bullet.x, bullet.y, 5, '#bdf6ff', 90, 0.25);
    this.#bullets.release(bullet);
    if (shot.captured) this.#capture(fish, payout);
    else {
      fish.flash = this.#clock;
      fish.hits++;
    }
  }

  #capture(fish, payout) {
    const kind = fish.kind;
    const big = fish.mult >= 20;
    const color = this.#sprites.get(kind.id)?.color ?? '#7ff';
    const full = reducedMotion() ? 8 : fish.boss ? 90 : big ? 46 : fish.mult >= 8 ? 26 : 14;
    const count = settings.lite ? Math.ceil(full / 2) : full;
    this.#burst(fish.x, fish.y, count, color, fish.boss ? 420 : big ? 300 : 200, fish.boss ? 1.6 : 0.9);
    if (fish.boss) {
      this.#burst(fish.x, fish.y, 40, '#fff36b', 520, 1.8);
      this.#shake = 1;
      trauma(this.#dom.stage, 3);
    }
    this.#float(fish.x, fish.y - fish.size * 0.5, `+${formatChips(payout)}`, fish.mult >= 8 ? '#ffe066' : '#9dffcf', fish.mult >= 20);
    pushRecent(this.#dom.recent, fmtMult(fish.mult), outcomeTone(fish.mult));
    // El mensaje (región aria-live) solo anuncia las capturas grandes o una cada 1,5 s.
    if (fish.mult >= 8 || this.#clock - this.#lastNote > 1500) {
      this.#lastNote = this.#clock;
      this.#dom.message.textContent = `${kind.name} capturada ${fmtMult(fish.mult)}: +${formatChips(payout)} créditos`;
    }
    if (fish.boss) {
      audio.explode(1);
      audio.win(3);
      const rect = this.#dom.canvas.getBoundingClientRect();
      hud.celebrate(3, { x: rect.left + (fish.x / this.#geo.w) * rect.width, y: rect.top + (fish.y / this.#geo.h) * rect.height });
      this.#krakenGone();
    } else if (fish.mult >= 60) {
      audio.explode(0.7);
      audio.win(2);
    } else if (fish.mult >= 20) {
      audio.win(1);
      audio.shimmer();
    } else if (fish.mult >= 8) {
      audio.gem(7);
      audio.shimmer();
    } else {
      audio.gem(Math.round(fish.mult * 2));
    }
    if (this.#target === fish) this.#target = null;
    this.#fish.release(fish);
  }

  // Bala que no impactó: vuelve al saldo y deja de contar en su ronda.
  #refund(bullet) {
    wallet.refund('fish', bullet.bet);
    bullet.volley?.refund(bullet.bet);
    this.#bullets.release(bullet);
  }

  // Cierra las rondas vencidas y reporta las que ya tienen todas sus balas resueltas.
  #settleVolleys(force = false) {
    if (!this.#volleys.length) return;
    let removed = false;
    for (const volley of this.#volleys) {
      if (!volley.sealed && (force || this.#clock - volley.openedAt >= VOLLEY_MS || volley.fired >= VOLLEY_MAX)) volley.sealed = true;
      if (!volley.done) continue;
      removed = true;
      const round = volley.round();
      if (round.stake > 0 || round.returned > 0) {
        this.#volleyCount++;
        session.report(round);
      }
    }
    if (removed) {
      this.#volleys = this.#volleys.filter((volley) => !volley.done);
      if (this.#volley?.done) this.#volley = null;
    }
  }

  // ---------- Efectos ----------

  #burst(x, y, count, color, speed, life) {
    for (let i = 0; i < count; i++) {
      const p = this.#particles.acquire();
      if (!p) return;
      const angle = randomFloat() * TAU;
      const v = speed * (0.25 + randomFloat() * 0.75);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.max = life * (0.6 + randomFloat() * 0.4);
      p.life = p.max;
      p.size = 1.5 + randomFloat() * 2.5;
      p.color = color;
    }
  }

  #float(x, y, text, color, big) {
    const f = this.#floaters.acquire();
    if (!f) return;
    f.x = x;
    f.y = y;
    f.max = big ? 1.8 : 1.2;
    f.life = f.max;
    f.text = text;
    f.color = color;
    f.big = big;
  }

  #moveEffects(dt) {
    for (const p of this.#particles.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.#particles.release(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 2.2 * dt;
    }
    for (const f of this.#floaters.items) {
      if (!f.active) continue;
      f.life -= dt;
      f.y -= (f.big ? 38 : 46) * dt;
      if (f.life <= 0) this.#floaters.release(f);
    }
    const { w, h } = this.#geo;
    if (this.#bubbles.used < Math.min(BUBBLE_POOL, Math.round(w / 40)) && randomFloat() < dt * 6) {
      const b = this.#bubbles.acquire();
      if (b) {
        b.x = randomFloat() * w;
        b.y = h - 10;
        b.r = 1.5 + randomFloat() * 3.5;
        b.vy = 25 + randomFloat() * 45;
        b.phase = randomFloat() * TAU;
      }
    }
    for (const b of this.#bubbles.items) {
      if (!b.active) continue;
      b.y -= b.vy * dt;
      b.x += Math.sin(this.#clock / 600 + b.phase) * 8 * dt;
      if (b.y < -10) this.#bubbles.release(b);
    }
    this.#recoil = Math.max(0, this.#recoil - dt * 8);
    this.#shake = Math.max(0, this.#shake - dt * 1.5);
  }

  // ---------- Bucle y dibujo ----------

  #ensureLoop() {
    if (this.#raf || !this.#visible || document.hidden) return;
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#loop);
  }

  #loop = (now) => {
    this.#raf = 0;
    if (!this.#visible || document.hidden || !this.#geo) return;
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    this.#clock += dt * 1000;
    this.#moveFish(dt);
    this.#steer(dt);
    const interval = this.#holding ? FIRE_INTERVAL_MS : AUTO_INTERVAL_MS;
    if ((this.#holding || this.#auto) && this.#clock - this.#lastShot >= interval) {
      if (!this.#fire() && this.#auto && !wallet.canAfford(this.#bet)) {
        this.#setAuto(false);
        this.#dom.message.textContent = 'Auto-disparo detenido: saldo insuficiente para otra bala';
      }
    }
    this.#moveBullets(dt);
    this.#settleVolleys();
    this.#moveEffects(dt);
    this.#draw();
    this.#renderStats();
    this.#raf = requestAnimationFrame(this.#loop);
  };

  #draw() {
    const ctx = this.#ctx;
    const g = this.#geo;
    if (!ctx || !g) return;
    const { dpr, w, h } = g;
    const shakeX = this.#shake > 0 ? (randomFloat() - 0.5) * 10 * this.#shake : 0;
    const shakeY = this.#shake > 0 ? (randomFloat() - 0.5) * 10 * this.#shake : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);

    // Burbujas.
    ctx.strokeStyle = 'rgba(170, 240, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const b of this.#bubbles.items) {
      if (!b.active) continue;
      ctx.moveTo(b.x + b.r, b.y);
      ctx.arc(b.x, b.y, b.r, 0, TAU);
    }
    ctx.stroke();

    // Criaturas: sprite cacheado con rotación por la ondulación y volteo según la dirección.
    for (const fish of this.#fish.items) {
      if (!fish.active) continue;
      const sprite = this.#sprites.get(fish.kind.id);
      if (!sprite) continue;
      const upright = fish.kind.id === 'jelly' || fish.boss;
      const tilt = upright ? 0 : Math.atan2(fish.vy, Math.abs(fish.vx) || 1) * 0.6;
      const pulse = fish.kind.id === 'jelly' ? 1 + Math.sin(this.#clock / 260 + fish.phase) * 0.06 : 1;
      const cos = Math.cos(tilt) * pulse;
      const sin = Math.sin(tilt) * pulse;
      const flip = upright ? 1 : fish.dir;
      ctx.setTransform(dpr * flip * cos, dpr * flip * sin, -dpr * sin, dpr * cos, dpr * (fish.x + shakeX), dpr * (fish.y + shakeY));
      const flashing = this.#clock - fish.flash < 110;
      if (flashing) ctx.globalAlpha = 0.55;
      ctx.drawImage(sprite.canvas, -sprite.w / 2, -sprite.h / 2, sprite.w, sprite.h);
      ctx.globalAlpha = 1;
      if (fish.mult >= 8 || fish.kind.id === 'neon') {
        ctx.setTransform(dpr, 0, 0, dpr, dpr * (fish.x + shakeX), dpr * (fish.y + shakeY));
        fish.label ??= this.#label(fish.mult, fish.mult >= 60 ? '#ffd166' : fish.mult >= 8 ? '#ffffff' : '#b8fff0');
        const label = fish.label;
        const offset = fish.boss ? fish.size * 0.95 : fish.size * 0.9;
        ctx.drawImage(label.canvas, -label.w / 2, offset - label.h / 2, label.w, label.h);
      }
      if (flashing) {
        ctx.setTransform(dpr, 0, 0, dpr, dpr * (fish.x + shakeX), dpr * (fish.y + shakeY));
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, fish.boss ? -fish.size * 0.2 : 0, fish.size * (fish.boss ? 0.65 : 0.85), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);

    // Balas (sprite con halo).
    const shot = this.#bulletSprite;
    if (shot) {
      for (const bullet of this.#bullets.items) {
        if (bullet.active) ctx.drawImage(shot.canvas, bullet.x - shot.w / 2, bullet.y - shot.h / 2, shot.w, shot.h);
      }
    }

    // Partículas con mezcla aditiva (el color solo se reasigna cuando cambia: interpretar la
    // cadena en cada partícula es lo más caro del fotograma).
    ctx.globalCompositeOperation = 'lighter';
    let color = '';
    for (const p of this.#particles.items) {
      if (!p.active) continue;
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      if (p.color !== color) {
        color = p.color;
        ctx.fillStyle = color;
      }
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Números flotantes.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let font = '';
    for (const f of this.#floaters.items) {
      if (!f.active) continue;
      const k = f.life / f.max;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      const wanted = f.big ? FLOAT_FONT_BIG : FLOAT_FONT;
      if (wanted !== font) {
        font = wanted;
        ctx.font = font;
      }
      const x = snap(f.x);
      const y = snap(f.y);
      const drop = f.big ? 4 : 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillText(f.text, x + drop, y + drop);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;

    // Cañón: tubo girado con su retroceso y la base encima.
    const { cx, cy } = g;
    const cannon = this.#cannon;
    if (cannon) {
      ctx.setTransform(dpr, 0, 0, dpr, dpr * (cx + shakeX), dpr * (cy + shakeY));
      ctx.rotate(this.#angle);
      ctx.drawImage(cannon.barrel.canvas, -cannon.barrel.w / 2 - this.#recoil * 6, -cannon.barrel.h / 2, cannon.barrel.w, cannon.barrel.h);
      ctx.setTransform(dpr, 0, 0, dpr, dpr * (cx + shakeX), dpr * (cy + shakeY));
      ctx.drawImage(cannon.base.canvas, -cannon.base.w / 2, -cannon.base.h / 2, cannon.base.w, cannon.base.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Pausa el bucle y devuelve las balas en vuelo (pestaña oculta o cambio de mesa).
  #pause() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#holding = false;
    if (this.#auto) this.#setAuto(false);
    for (const bullet of this.#bullets.items) if (bullet.active) this.#refund(bullet);
    this.#flying = 0;
    this.#settleVolleys(true);
    this.#renderStats();
  }

  onShow() {
    this.#visible = true;
    this.#layout();
    this.#prefill();
    this.#ensureLoop();
  }

  onHide() {
    this.#visible = false;
    this.#pause();
  }
}
