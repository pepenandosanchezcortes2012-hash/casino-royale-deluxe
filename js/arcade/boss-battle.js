// Núcleo del Servidor (piso 5 secreto): combate de reflejos y patrones contra la IA Central en
// 3 fases. Esta es solo la lógica (sin DOM ni lienzo), con paso de tiempo fijo y azar inyectable
// para poder probarla; el dibujo y los controles viven en js/ui/boss-ui.js.
// No hay apuesta: es un minijuego de habilidad. Ganar da gloria, cofres y un récord.
// - Fase 1 (100–67 % de vida): abanicos de 3 balas apuntadas.
// - Fase 2 (67–34 %): espiral giratoria continua.
// - Fase 3 (34–0 %): columnas láser avisadas con antelación + ráfagas apuntadas y más velocidad.
// La nave del jugador dispara sola; tiene 3 vidas y 1,5 s de invulnerabilidad tras cada impacto.

export const ARENA = Object.freeze({ w: 320, h: 240 });
export const BOSS_HP = 300;
export const PLAYER_LIVES = 3;
export const PHASES = Object.freeze([1, 2 / 3, 1 / 3]);
const STEP = 1 / 120;
const PLAYER_SPEED = 150;
const PLAYER_Y = 218;
const PLAYER_HALF = 5;
const SHOT_EVERY = 0.12;
const SHOT_SPEED = 260;
const INVULNERABLE = 1.5;
const MAX_ENEMY = 220;
const MAX_SHOTS = 24;
const LASER_WARN = 0.9;
const LASER_ON = 0.6;
const LASER_HALF = 7;

// Fase (1–3) para una vida restante dada.
export function phaseFor(hp, max = BOSS_HP) {
  const ratio = hp / max;
  return ratio > PHASES[1] ? 1 : ratio > PHASES[2] ? 2 : 3;
}

// Puntuación final: daño, vidas conservadas y rapidez.
export function bossScore({ damage, lives, seconds, won }) {
  const time = won ? Math.max(0, Math.round(3000 - seconds * 20)) : 0;
  return damage * 10 + (won ? lives * 500 + time : 0);
}

export class BossBattle {
  #rand;
  #acc = 0;
  #shotClock = 0;
  #patternClock = 0;
  #spin = 0;
  #laserClock = 4;

  constructor({ rand = Math.random } = {}) {
    this.#rand = rand;
    this.state = 'ready';
    this.time = 0;
    this.boss = { x: ARENA.w / 2, y: 46, w: 56, h: 40, hp: BOSS_HP, max: BOSS_HP, flash: 0 };
    this.player = { x: ARENA.w / 2, y: PLAYER_Y, lives: PLAYER_LIVES, invulnerable: 0 };
    this.enemy = [];
    this.shots = [];
    this.lasers = [];
    this.events = [];
    this.damage = 0;
    this.phase = 1;
  }

  start() {
    if (this.state === 'ready') this.state = 'playing';
  }

  get score() {
    return bossScore({ damage: this.damage, lives: this.player.lives, seconds: this.time, won: this.state === 'won' });
  }

  // Avanza `dt` segundos. `input` = { dir: -1…1 } o { targetX } (puntero/dedo).
  update(dt, input = {}) {
    if (this.state !== 'playing') return;
    this.#acc += Math.min(0.1, Math.max(0, dt));
    while (this.#acc >= STEP && this.state === 'playing') {
      this.#acc -= STEP;
      this.#step(STEP, input);
    }
  }

  // Eventos desde la última lectura (para sonido y efectos): 'shot', 'hit', 'hurt', 'phase', 'laser', 'won', 'lost'.
  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  #emit(type, detail = {}) {
    if (this.events.length < 64) this.events.push({ type, ...detail });
  }

  #step(dt, input) {
    this.time += dt;
    const p = this.player;
    const b = this.boss;
    // Movimiento del jugador.
    let dir = Number(input.dir) || 0;
    if (Number.isFinite(input.targetX)) dir = Math.abs(input.targetX - p.x) < 2 ? 0 : Math.sign(input.targetX - p.x);
    p.x = Math.min(ARENA.w - 10, Math.max(10, p.x + dir * PLAYER_SPEED * dt));
    p.invulnerable = Math.max(0, p.invulnerable - dt);
    b.flash = Math.max(0, b.flash - dt);
    // Movimiento del jefe: vaivén que se acelera por fase.
    b.x = ARENA.w / 2 + Math.sin(this.time * (0.5 + this.phase * 0.25)) * (60 + this.phase * 20);

    // Disparo automático del jugador.
    this.#shotClock -= dt;
    if (this.#shotClock <= 0 && this.shots.length < MAX_SHOTS) {
      this.#shotClock = SHOT_EVERY;
      this.shots.push({ x: p.x, y: p.y - 8 });
      this.#emit('shot');
    }
    for (const s of this.shots) s.y -= SHOT_SPEED * dt;
    this.shots = this.shots.filter((s) => {
      if (s.y < -4) return false;
      if (Math.abs(s.x - b.x) <= b.w / 2 && Math.abs(s.y - b.y) <= b.h / 2) {
        b.hp = Math.max(0, b.hp - 1);
        b.flash = 0.06;
        this.damage += 1;
        this.#emit('hit');
        return false;
      }
      return true;
    });
    if (b.hp <= 0) {
      this.state = 'won';
      this.#emit('won');
      return;
    }
    const phase = phaseFor(b.hp, b.max);
    if (phase !== this.phase) {
      this.phase = phase;
      this.enemy.length = 0;
      this.#emit('phase', { phase });
    }

    this.#patterns(dt);

    // Balas enemigas y colisión con la nave (caja de 5 px de radio).
    for (const e of this.enemy) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
    this.enemy = this.enemy.filter((e) => e.x > -8 && e.x < ARENA.w + 8 && e.y > -8 && e.y < ARENA.h + 8);
    if (p.invulnerable <= 0) {
      const hitBullet = this.enemy.findIndex((e) => Math.abs(e.x - p.x) <= PLAYER_HALF + 2 && Math.abs(e.y - p.y) <= PLAYER_HALF + 2);
      const hitLaser = this.lasers.some((l) => l.on && Math.abs(l.x - p.x) <= LASER_HALF + PLAYER_HALF - 2);
      if (hitBullet >= 0 || hitLaser) {
        if (hitBullet >= 0) this.enemy.splice(hitBullet, 1);
        p.lives -= 1;
        p.invulnerable = INVULNERABLE;
        this.#emit('hurt', { lives: p.lives });
        if (p.lives <= 0) {
          this.state = 'lost';
          this.#emit('lost');
        }
      }
    }
  }

  #fire(x, y, angle, speed) {
    if (this.enemy.length >= MAX_ENEMY) return;
    this.enemy.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }

  #aimed(count, spread, speed) {
    const b = this.boss;
    const base = Math.atan2(this.player.y - b.y, this.player.x - b.x);
    for (let i = 0; i < count; i++) this.#fire(b.x, b.y + 16, base + (i - (count - 1) / 2) * spread, speed);
  }

  #patterns(dt) {
    const b = this.boss;
    this.#patternClock -= dt;
    if (this.phase === 1) {
      if (this.#patternClock <= 0) {
        this.#patternClock = 1.0;
        this.#aimed(3, 0.22, 90);
      }
    } else if (this.phase === 2) {
      this.#spin += dt * 2.4;
      if (this.#patternClock <= 0) {
        this.#patternClock = 0.09;
        for (const offset of [0, Math.PI]) this.#fire(b.x, b.y + 10, this.#spin + offset, 80);
      }
    } else {
      if (this.#patternClock <= 0) {
        this.#patternClock = 0.85;
        this.#aimed(5, 0.18, 120);
      }
      // Láseres: aviso, disparo y desaparición.
      this.#laserClock -= dt;
      if (this.#laserClock <= 0) {
        this.#laserClock = 2.2;
        const x = Math.round(16 + this.#rand() * (ARENA.w - 32));
        this.lasers.push({ x, t: 0, on: false });
        this.#emit('laser');
      }
      for (const l of this.lasers) {
        l.t += dt;
        l.on = l.t >= LASER_WARN && l.t < LASER_WARN + LASER_ON;
      }
      this.lasers = this.lasers.filter((l) => l.t < LASER_WARN + LASER_ON);
    }
  }
}
