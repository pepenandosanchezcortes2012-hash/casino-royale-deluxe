// Cyber-Fish Hunter: acuario en Canvas 2D con un cañón que apunta al cursor o al dedo. Cada bala
// es una apuesta provably fair (fish-math.js): su número se compromete al disparar y decide la
// captura al impactar (r < 0,96 / multiplicador). Peces, balas, partículas, burbujas y números
// flotantes salen de pools de tamaño fijo (el bucle no crea objetos), las criaturas son sprites
// pixel art de 3 fotogramas (js/ui/pixel-sprites.js) rasterizados una sola vez y el bucle requestAnimationFrame solo corre con la mesa
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
import { pixelContext } from '../ui/pixel-art.js';
import { fishFrames, fishColor, cannonSprites, bulletSprite } from '../ui/pixel-sprites.js';
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
const PIXEL_FONT = '"Press Start 2P", ui-monospace, monospace';
const CANNON_MARGIN = 30;
const AIM_SPEED = 7;
const TAU = Math.PI * 2;
const MIN_ANGLE = -Math.PI + 0.12;
const MAX_ANGLE = -0.12;
const round2 = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percent = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
// Press Start 2P vive en una rejilla de 8 px: a 16 y 32 px CSS cada píxel de la fuente cae justo en
// 1 y 2 píxeles del lienzo.
const FLOAT_FONT = `16px ${PIXEL_FONT}`;
const FLOAT_FONT_BIG = `32px ${PIXEL_FONT}`;
const LABEL_FONT = '16px "Silkscreen", ui-monospace, monospace';
// Fotogramas de nado en vaivén.
const SWIM = [0, 1, 2, 1];
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

// ---------- Sprites pixel art (se rasterizan una vez: 1 celda = 1 píxel del lienzo) ----------

// Lienzo de un sprite y su tamaño en píxeles CSS (cada celda mide 1 / PIXEL_SCALE píxeles CSS).
function bake({ grid, palette }) {
  return { canvas: grid.toCanvas(palette), w: grid.w / PIXEL_SCALE, h: grid.h / PIXEL_SCALE };
}

// Tres fotogramas de nado por especie (aletas y cola) que se reproducen en vaivén 0-1-2-1.
function paintSpecies(kind) {
  const frames = fishFrames(kind.id).map(bake);
  return { frames, w: frames[0].w, h: frames[0].h, color: fishColor(kind.id) };
}

// Etiqueta «×8» cacheada por multiplicador, en Silkscreen (más estrecha) con sombra dura.
function paintLabel(text, color) {
  const w = 8 + text.length * 12;
  const h = 22;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * PIXEL_SCALE);
  canvas.height = Math.ceil(h * PIXEL_SCALE);
  const ctx = pixelContext(canvas);
  ctx.setTransform(PIXEL_SCALE, 0, 0, PIXEL_SCALE, (w / 2) * PIXEL_SCALE, (h / 2) * PIXEL_SCALE);
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.fillText(text, 2, 2);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
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
    this.#ctx = pixelContext(canvas);
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
      for (const kind of SPECIES) this.#sprites.set(kind.id, paintSpecies(kind));
      this.#bulletSprite = bake(bulletSprite());
      const cannon = cannonSprites();
      this.#cannon = { base: bake(cannon.base), barrel: bake(cannon.barrel) };
      for (const fish of this.#fish.items) fish.label = null;
    }
    this.#paintBackground();
    this.#draw();
  }

  // El fondo se pinta una vez en su propio lienzo, debajo del de la acción, directamente en
  // píxeles del lienzo: agua en bandas planas con tramado entre ellas, haces de luz escalonados,
  // rejilla de puntos, fondo marino con algas y la plataforma del cañón.
  #paintBackground() {
    const { w, h, dpr } = this.#geo;
    const canvas = this.#dom.bg;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    canvas.width = cw;
    canvas.height = ch;
    const ctx = pixelContext(canvas);
    const bands = ['#06344f', '#05293f', '#041f31', '#031827', '#02121e', '#010d17', '#010a12'];
    const bandH = Math.ceil(ch / bands.length);
    bands.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * bandH, cw, bandH);
    });
    // Tramado de damero de 2 filas en cada frontera de banda.
    for (let i = 1; i < bands.length; i++) {
      ctx.fillStyle = bands[i];
      for (let y = i * bandH - 2; y < i * bandH; y++) for (let x = y % 2; x < cw; x += 2) ctx.fillRect(x, y, 1, 1);
    }
    // Haces de luz: escalones diagonales semitransparentes.
    ctx.fillStyle = '#5adcff';
    for (let i = 0; i < 5; i++) {
      const x0 = Math.round((cw * (i + 0.4)) / 5);
      for (let y = 0; y < ch * 0.7; y += 2) {
        ctx.globalAlpha = 0.07 * (1 - y / (ch * 0.7));
        ctx.fillRect(Math.round(x0 + y * 0.35), y, 8 + Math.floor(y / 24), 2);
      }
    }
    ctx.globalAlpha = 1;
    // Destellos fijos cerca de la superficie y rejilla de puntos cibernética.
    ctx.fillStyle = '#c8f6ff';
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 53 + (i % 3) * 17) % cw, (i * 29) % Math.max(1, Math.round(ch * 0.18)), 2, 1);
    ctx.fillStyle = 'rgba(0, 229, 255, 0.18)';
    for (let y = 12; y < ch - 20; y += 24) for (let x = 12; x < cw; x += 24) ctx.fillRect(x, y, 1, 1);
    // Fondo marino: arena morada con perfil ondulado y algas en escalera.
    for (let x = 0; x < cw; x++) {
      const top = ch - 10 - Math.round(2 * Math.sin(x / 9) + 2 * Math.sin(x / 23));
      ctx.fillStyle = '#2a0a2e';
      ctx.fillRect(x, top, 1, ch - top);
      ctx.fillStyle = '#7a1f6e';
      ctx.fillRect(x, top, 1, 1);
    }
    for (let i = 0; i < 9; i++) {
      const x0 = Math.round(((i + 0.5) * cw) / 9 + (i % 2 ? 6 : -4));
      const tall = 14 + ((i * 7) % 18);
      for (let y = 0; y < tall; y++) {
        ctx.fillStyle = y % 6 < 3 ? '#2fbf55' : '#127a30';
        ctx.fillRect(x0 + (Math.floor(y / 4) % 2), ch - 10 - y, 2, 1);
      }
    }
    ctx.fillStyle = '#ff2bd6';
    ctx.fillRect(0, ch - 4, cw, 1);
  }

  #label(multiplier, color) {
    const key = `${multiplier}|${color}`;
    let label = this.#labels.get(key);
    if (!label) {
      label = paintLabel(fmtMult(multiplier).replace(',00', ''), color);
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
      p.size = 2 + Math.floor(randomFloat() * 2) * 2;
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
        b.r = 2 + Math.floor(randomFloat() * 3) * 2;
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

    // Burbujas cuadradas: marco de 1 píxel con un brillo en la esquina.
    ctx.fillStyle = 'rgba(170, 240, 255, 0.45)';
    for (const b of this.#bubbles.items) {
      if (!b.active) continue;
      const s = b.r * 2;
      const x = snap(b.x - b.r);
      const y = snap(b.y - b.r);
      ctx.fillRect(x + 2, y, s - 4, 2);
      ctx.fillRect(x + 2, y + s - 2, s - 4, 2);
      ctx.fillRect(x, y + 2, 2, s - 4);
      ctx.fillRect(x + s - 2, y + 2, 2, s - 4);
      ctx.fillRect(x + 2, y + 2, 2, 2);
    }

    // Criaturas: fotograma de nado del sprite, volteado según la dirección y sin rotar (los
    // píxeles no se tuercen). La posición se ajusta a la rejilla del lienzo.
    for (const fish of this.#fish.items) {
      if (!fish.active) continue;
      const sprite = this.#sprites.get(fish.kind.id);
      if (!sprite) continue;
      const upright = fish.kind.id === 'jelly' || fish.boss;
      const flip = upright ? 1 : fish.dir;
      const beat = fish.boss ? 260 : fish.kind.id === 'jelly' ? 200 : 130;
      const frame = sprite.frames[SWIM[Math.floor(this.#clock / beat + fish.phase * 4) % SWIM.length]];
      const fx = snap(fish.x + shakeX);
      const fy = snap(fish.y + shakeY);
      ctx.setTransform(dpr * flip, 0, 0, dpr, dpr * fx, dpr * fy);
      const flashing = this.#clock - fish.flash < 110;
      if (flashing) ctx.globalAlpha = 0.55;
      ctx.drawImage(frame.canvas, -snap(frame.w / 2), -snap(frame.h / 2), frame.w, frame.h);
      ctx.globalAlpha = 1;
      if (fish.mult >= 8 || fish.kind.id === 'neon') {
        ctx.setTransform(dpr, 0, 0, dpr, dpr * fx, dpr * fy);
        fish.label ??= this.#label(fish.mult, fish.mult >= 60 ? '#ffd166' : fish.mult >= 8 ? '#ffffff' : '#b8fff0');
        const label = fish.label;
        const offset = snap(fish.boss ? fish.size * 0.95 : fish.size * 0.9);
        ctx.drawImage(label.canvas, -snap(label.w / 2), offset - snap(label.h / 2), label.w, label.h);
      }
      if (flashing) {
        // Retícula de esquinas en lugar de un aro.
        ctx.setTransform(dpr, 0, 0, dpr, dpr * fx, dpr * fy);
        const half = snap(fish.size * (fish.boss ? 0.7 : 0.9));
        const arm = snap(half * 0.4);
        const cy = fish.boss ? -snap(fish.size * 0.2) : 0;
        ctx.fillStyle = '#ffffff';
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            const x = sx < 0 ? -half : half - 2;
            const y = cy + (sy < 0 ? -half : half - 2);
            ctx.fillRect(sx < 0 ? x : x - arm + 2, y, arm, 2);
            ctx.fillRect(x, sy < 0 ? y : y - arm + 2, 2, arm);
          }
        }
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);

    // Balas: cruz pixel de 5 × 5.
    const shot = this.#bulletSprite;
    if (shot) {
      for (const bullet of this.#bullets.items) {
        if (bullet.active) ctx.drawImage(shot.canvas, snap(bullet.x - shot.w / 2), snap(bullet.y - shot.h / 2), shot.w, shot.h);
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
      ctx.fillRect(snap(p.x - p.size / 2), snap(p.y - p.size / 2), p.size, p.size);
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
      ctx.drawImage(cannon.barrel.canvas, -cannon.barrel.w / 2 - snap(this.#recoil * 6), -cannon.barrel.h / 2, cannon.barrel.w, cannon.barrel.h);
      ctx.setTransform(dpr, 0, 0, dpr, dpr * snap(cx + shakeX), dpr * snap(cy + shakeY));
      // La cúpula de la base tiene su centro a 2 celdas del borde inferior del sprite.
      ctx.drawImage(cannon.base.canvas, -cannon.base.w / 2, -cannon.base.h + 4, cannon.base.w, cannon.base.h);
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
