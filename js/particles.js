// Partículas en Canvas a pantalla completa: confeti con aleteo y chispas aditivas.
// Sin basura para el recolector: un pool fijo de partículas preasignadas (estructura de arrays
// tipados, se reutilizan al morir) y un sprite de chispa pintado una sola vez en un lienzo aparte
// que se estampa con drawImage. El bucle solo corre mientras haya partículas vivas.

import { randomFloat, randomBetween, pick } from './engine/rng.js';

const CONFETTI = ['#f7e08a', '#d4af37', '#ff4d6d', '#ffffff', '#4dd0e1', '#7ee081', '#b388ff'];
const GOLD = ['#fff3b0', '#f7e08a', '#d4af37', '#b8860b', '#ffe37a', '#ffffff'];
const GRAVITY = 900;
const MAX_PARTICLES = 1400;
const SPRITE = 64;
const CONFETTI_KIND = 0;
const SPARK_KIND = 1;

export class ParticleSystem {
  #canvas;
  #ctx;
  #running = false;
  #last = 0;
  #width = 0;
  #height = 0;
  #dpr = 1;
  #reduced;
  #n = 0;
  #kind = new Uint8Array(MAX_PARTICLES);
  #color = new Uint8Array(MAX_PARTICLES);
  #x = new Float32Array(MAX_PARTICLES);
  #y = new Float32Array(MAX_PARTICLES);
  #vx = new Float32Array(MAX_PARTICLES);
  #vy = new Float32Array(MAX_PARTICLES);
  #w = new Float32Array(MAX_PARTICLES);
  #h = new Float32Array(MAX_PARTICLES);
  #rot = new Float32Array(MAX_PARTICLES);
  #spin = new Float32Array(MAX_PARTICLES);
  #flutter = new Float32Array(MAX_PARTICLES);
  #life = new Float32Array(MAX_PARTICLES);
  #age = new Float32Array(MAX_PARTICLES);
  #colors = [];
  #colorIndex = new Map();
  #sprite = null;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
    for (const color of [...CONFETTI, ...GOLD]) this.#colorId(color);
    this.setTint('#f7c846');
    this.#resize();
    globalThis.addEventListener('resize', () => this.#resize(), { passive: true });
  }

  // Color de las chispas (dorado en la historia, el acento del tema en el Cripto-Casino).
  setTint(color) {
    const sprite = document.createElement('canvas');
    sprite.width = SPRITE;
    sprite.height = SPRITE;
    const g = sprite.getContext('2d');
    const half = SPRITE / 2;
    const glow = g.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, 'rgba(255, 250, 225, 1)');
    glow.addColorStop(0.3, color);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, SPRITE, SPRITE);
    this.#sprite = sprite;
  }

  #colorId(color) {
    if (!this.#colorIndex.has(color) && this.#colors.length < 255) {
      this.#colorIndex.set(color, this.#colors.length);
      this.#colors.push(color);
    }
    return this.#colorIndex.get(color) ?? 0;
  }

  #resize() {
    this.#dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.#width = globalThis.innerWidth;
    this.#height = globalThis.innerHeight;
    this.#canvas.width = Math.round(this.#width * this.#dpr);
    this.#canvas.height = Math.round(this.#height * this.#dpr);
  }

  #scale(count) {
    return this.#reduced.matches ? Math.ceil(count / 4) : count;
  }

  // Reserva una partícula del pool (-1 si está lleno).
  #spawn(kind) {
    if (this.#n >= MAX_PARTICLES) return -1;
    const i = this.#n++;
    this.#kind[i] = kind;
    this.#age[i] = 0;
    return i;
  }

  // Libera la partícula i moviendo la última a su hueco (el pool queda compacto).
  #kill(i) {
    const last = --this.#n;
    if (i === last) return;
    this.#kind[i] = this.#kind[last];
    this.#color[i] = this.#color[last];
    this.#x[i] = this.#x[last];
    this.#y[i] = this.#y[last];
    this.#vx[i] = this.#vx[last];
    this.#vy[i] = this.#vy[last];
    this.#w[i] = this.#w[last];
    this.#h[i] = this.#h[last];
    this.#rot[i] = this.#rot[last];
    this.#spin[i] = this.#spin[last];
    this.#flutter[i] = this.#flutter[last];
    this.#life[i] = this.#life[last];
    this.#age[i] = this.#age[last];
  }

  #confettiAt(x, y, vx, vy, color, life) {
    const i = this.#spawn(CONFETTI_KIND);
    if (i < 0) return;
    this.#x[i] = x;
    this.#y[i] = y;
    this.#vx[i] = vx;
    this.#vy[i] = vy;
    this.#w[i] = randomBetween(6, 11);
    this.#h[i] = randomBetween(9, 16);
    this.#rot[i] = randomFloat() * Math.PI * 2;
    this.#spin[i] = randomBetween(-9, 9);
    this.#flutter[i] = randomFloat() * Math.PI * 2;
    this.#color[i] = this.#colorId(color);
    this.#life[i] = life;
  }

  confetti(x, y, count = 120, spread = Math.PI / 1.6) {
    for (let n = 0; n < this.#scale(count); n++) {
      const angle = -Math.PI / 2 + randomBetween(-spread / 2, spread / 2);
      const speed = randomBetween(420, 980);
      this.#confettiAt(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, pick(CONFETTI), randomBetween(2.4, 3.6));
    }
    this.#start();
  }

  sparks(x, y, count = 60) {
    for (let n = 0; n < this.#scale(count); n++) {
      const i = this.#spawn(SPARK_KIND);
      if (i < 0) break;
      const angle = randomFloat() * Math.PI * 2;
      const speed = randomBetween(120, 520);
      this.#x[i] = x;
      this.#y[i] = y;
      this.#vx[i] = Math.cos(angle) * speed;
      this.#vy[i] = Math.sin(angle) * speed - 120;
      this.#w[i] = randomBetween(1.4, 3.2);
      this.#life[i] = randomBetween(0.6, 1.3);
    }
    this.#start();
  }

  // Lluvia de confeti que cae desde arriba (paleta dorada por defecto).
  rain(count = 40, palette = GOLD) {
    for (let n = 0; n < this.#scale(count); n++) {
      this.#confettiAt(randomFloat() * this.#width, -20 - randomFloat() * 60, randomBetween(-60, 60), randomBetween(80, 260), pick(palette), randomBetween(4.5, 6.5));
    }
    this.#start();
  }

  // Tormenta dorada del gran final: lluvia continua, ráfagas de confeti y chispas.
  goldStorm(seconds = 8) {
    const end = performance.now() + seconds * 1000;
    const tick = () => {
      if (performance.now() > end) return;
      this.rain(18);
      if (randomFloat() < 0.35) this.sparks(randomBetween(0.15, 0.85) * this.#width, randomBetween(0.15, 0.6) * this.#height, 40);
      if (randomFloat() < 0.12) this.confetti(randomBetween(0.2, 0.8) * this.#width, this.#height, 60);
      setTimeout(tick, 120);
    };
    tick();
  }

  // Nivel 1: chispas; 2: confeti + chispas; 3: jackpot con ráfagas encadenadas.
  celebrate(level = 1, origin = null) {
    const x = origin?.x ?? this.#width / 2;
    const y = origin?.y ?? this.#height / 2;
    this.sparks(x, y, 50 + level * 30);
    if (level >= 2) {
      this.confetti(this.#width * 0.2, this.#height, 90);
      this.confetti(this.#width * 0.8, this.#height, 90);
    }
    if (level >= 3) {
      for (let i = 1; i <= 4; i++) {
        setTimeout(() => {
          this.sparks(randomBetween(0.2, 0.8) * this.#width, randomBetween(0.2, 0.5) * this.#height, 90);
          this.confetti(this.#width / 2, this.#height, 110, Math.PI / 1.2);
        }, i * 420);
      }
    }
  }

  #start() {
    if (this.#running || !this.#n) return;
    this.#running = true;
    this.#last = performance.now();
    requestAnimationFrame(this.#frame);
  }

  #frame = (now) => {
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    const ctx = this.#ctx;
    const dpr = this.#dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Física y retirada de las partículas muertas (recorrido inverso para poder compactar).
    for (let i = this.#n - 1; i >= 0; i--) {
      this.#age[i] += dt;
      if (this.#age[i] >= this.#life[i] || this.#y[i] > this.#height + 60) {
        this.#kill(i);
        continue;
      }
      if (this.#kind[i] === CONFETTI_KIND) {
        this.#vx[i] *= 1 - 1.4 * dt;
        this.#vy[i] = this.#vy[i] * (1 - 1.1 * dt) + GRAVITY * 0.55 * dt;
        this.#x[i] += (this.#vx[i] + Math.sin(this.#flutter[i]) * 40) * dt;
        this.#y[i] += this.#vy[i] * dt;
        this.#rot[i] += this.#spin[i] * dt;
        this.#flutter[i] += 8 * dt;
      } else {
        this.#vx[i] *= 1 - 1.8 * dt;
        this.#vy[i] = this.#vy[i] * (1 - 1.8 * dt) + GRAVITY * 0.35 * dt;
        this.#x[i] += this.#vx[i] * dt;
        this.#y[i] += this.#vy[i] * dt;
      }
    }

    // Confeti: una matriz por pieza (rotación + aleteo) sin save/restore.
    for (let i = 0; i < this.#n; i++) {
      if (this.#kind[i] !== CONFETTI_KIND) continue;
      const cos = Math.cos(this.#rot[i]);
      const sin = Math.sin(this.#rot[i]);
      const flap = Math.cos(this.#flutter[i]);
      ctx.globalAlpha = Math.min(1, (this.#life[i] - this.#age[i]) * 2);
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin * flap, dpr * cos * flap, dpr * this.#x[i], dpr * this.#y[i]);
      ctx.fillStyle = this.#colors[this.#color[i]];
      ctx.fillRect(-this.#w[i] / 2, -this.#h[i] / 2, this.#w[i], this.#h[i]);
    }

    // Chispas: el sprite cacheado, en modo aditivo.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.#n; i++) {
      if (this.#kind[i] !== SPARK_KIND) continue;
      const r = this.#w[i] * 4;
      ctx.globalAlpha = 1 - this.#age[i] / this.#life[i];
      ctx.drawImage(this.#sprite, this.#x[i] - r, this.#y[i] - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (this.#n > 0) {
      requestAnimationFrame(this.#frame);
    } else {
      this.#running = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    }
  };
}
