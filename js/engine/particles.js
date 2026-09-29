// Partículas en Canvas a pantalla completa: confeti con aleteo y chispas doradas aditivas.
// El bucle solo corre mientras haya partículas vivas.

import { randomFloat, randomBetween, pick } from './rng.js';

const CONFETTI = ['#f7e08a', '#d4af37', '#ff4d6d', '#ffffff', '#4dd0e1', '#7ee081', '#b388ff'];
const GOLD = ['#fff3b0', '#f7e08a', '#d4af37', '#b8860b', '#ffe37a', '#ffffff'];
const GRAVITY = 900;
const MAX_PARTICLES = 1400;

export class ParticleSystem {
  #canvas;
  #ctx;
  #particles = [];
  #running = false;
  #last = 0;
  #width = 0;
  #height = 0;
  #reduced;

  constructor(canvas) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.#reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
    this.#resize();
    globalThis.addEventListener('resize', () => this.#resize(), { passive: true });
  }

  #resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.#width = globalThis.innerWidth;
    this.#height = globalThis.innerHeight;
    this.#canvas.width = Math.round(this.#width * dpr);
    this.#canvas.height = Math.round(this.#height * dpr);
    this.#ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  #scale(count) {
    return this.#reduced.matches ? Math.ceil(count / 4) : count;
  }

  #add(particle) {
    if (this.#particles.length < MAX_PARTICLES) this.#particles.push(particle);
  }

  confetti(x, y, count = 120, spread = Math.PI / 1.6) {
    for (let i = 0; i < this.#scale(count); i++) {
      const angle = -Math.PI / 2 + randomBetween(-spread / 2, spread / 2);
      const speed = randomBetween(420, 980);
      this.#add({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: randomBetween(6, 11),
        h: randomBetween(9, 16),
        rot: randomFloat() * Math.PI * 2,
        spin: randomBetween(-9, 9),
        flutter: randomFloat() * Math.PI * 2,
        color: pick(CONFETTI),
        life: randomBetween(2.4, 3.6),
        age: 0,
      });
    }
    this.#start();
  }

  sparks(x, y, count = 60) {
    for (let i = 0; i < this.#scale(count); i++) {
      const angle = randomFloat() * Math.PI * 2;
      const speed = randomBetween(120, 520);
      this.#add({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        size: randomBetween(1.4, 3.2),
        life: randomBetween(0.6, 1.3),
        age: 0,
      });
    }
    this.#start();
  }

  // Lluvia de confeti que cae desde arriba (paleta dorada por defecto).
  rain(count = 40, palette = GOLD) {
    for (let i = 0; i < this.#scale(count); i++) {
      this.#add({
        kind: 'confetti',
        x: randomFloat() * this.#width,
        y: -20 - randomFloat() * 60,
        vx: randomBetween(-60, 60),
        vy: randomBetween(80, 260),
        w: randomBetween(5, 10),
        h: randomBetween(8, 15),
        rot: randomFloat() * Math.PI * 2,
        spin: randomBetween(-7, 7),
        flutter: randomFloat() * Math.PI * 2,
        color: pick(palette),
        life: randomBetween(4.5, 6.5),
        age: 0,
      });
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
    if (this.#running) return;
    this.#running = true;
    this.#last = performance.now();
    requestAnimationFrame(this.#frame);
  }

  #frame = (now) => {
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    const ctx = this.#ctx;
    ctx.clearRect(0, 0, this.#width, this.#height);

    const alive = [];
    for (const p of this.#particles) {
      p.age += dt;
      if (p.age >= p.life || p.y > this.#height + 60) continue;
      if (p.kind === 'confetti') {
        p.vx *= 1 - 1.4 * dt;
        p.vy = p.vy * (1 - 1.1 * dt) + GRAVITY * 0.55 * dt;
        p.x += (p.vx + Math.sin(p.flutter) * 40) * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        p.flutter += 8 * dt;
        const fade = Math.min(1, (p.life - p.age) * 2);
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.flutter));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      } else {
        p.vx *= 1 - 1.8 * dt;
        p.vy = p.vy * (1 - 1.8 * dt) + GRAVITY * 0.35 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const t = 1 - p.age / p.life;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const r = p.size * 4;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        glow.addColorStop(0, `rgba(255, 248, 210, ${t})`);
        glow.addColorStop(0.35, `rgba(247, 200, 70, ${0.7 * t})`);
        glow.addColorStop(1, 'rgba(212, 150, 30, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      alive.push(p);
    }
    this.#particles = alive;

    if (alive.length > 0) {
      requestAnimationFrame(this.#frame);
    } else {
      this.#running = false;
      ctx.clearRect(0, 0, this.#width, this.#height);
    }
  };
}
