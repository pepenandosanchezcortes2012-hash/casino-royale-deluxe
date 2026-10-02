// Piso 5 secreto, el Núcleo del Servidor: diálogo a pantalla completa con la arena del combate
// contra la IA Central (lógica en js/arcade/boss-battle.js). El lienzo es de 320 × 240 píxeles
// reales y el navegador lo amplía sin suavizado. El bucle requestAnimationFrame solo corre con el
// combate en marcha, el diálogo abierto y la pestaña visible; al cerrar se detiene todo y vuelve la
// música de la mesa.

import { audio } from '../audio.js';
import { climb } from '../climb/climb.js';
import { storage } from '../storage.js';
import { randomFloat } from '../engine/rng.js';
import { BossBattle, ARENA, BOSS_HP, PLAYER_LIVES } from '../arcade/boss-battle.js';
import { bossSprite, playerShip } from './pixel-sprites.js';
import { pixelContext } from './pixel-art.js';
import { pixelIcon } from './svg.js';
import { hud, formatChips } from './hud.js';

const CORE_KEY = 'crd.arcade.core.v1';
const BULLET_COLORS = ['#3fd8ff', '#ff3fd0', '#ff2b4a'];

class BossUi {
  #dom = null;
  #ctx = null;
  #battle = null;
  #sprites = null;
  #bg = null;
  #raf = 0;
  #last = 0;
  #keys = { left: false, right: false };
  #pointerX = null;
  #scene = 'tower';
  #hitSound = 0;

  init() {
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      dialog: $('boss-dialog'),
      close: $('boss-close'),
      canvas: $('boss-canvas'),
      overlay: $('boss-overlay'),
      message: $('boss-message'),
      start: $('boss-start'),
      hp: $('boss-hp'),
      hpMeter: $('boss-hp-meter'),
      phase: $('boss-phase'),
      lives: $('boss-lives'),
      score: $('boss-score'),
    };
    const d = this.#dom;
    document.addEventListener('core:open', () => this.open());
    d.close.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('close', () => this.#stop());
    d.start.addEventListener('click', () => this.#begin());
    d.dialog.addEventListener('keydown', (event) => this.#key(event, true));
    d.dialog.addEventListener('keyup', (event) => this.#key(event, false));
    const aim = (event) => {
      const rect = d.canvas.getBoundingClientRect();
      this.#pointerX = ((event.clientX - rect.left) / rect.width) * ARENA.w;
    };
    d.canvas.addEventListener('pointerdown', (event) => {
      d.canvas.setPointerCapture?.(event.pointerId);
      aim(event);
    });
    d.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'mouse' || event.buttons) aim(event);
    });
    d.canvas.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'mouse') this.#pointerX = null;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.#pause();
      else this.#resume();
    });
  }

  open() {
    if (climb.status !== 'victory') return;
    const d = this.#dom;
    this.#ctx ??= pixelContext(d.canvas);
    this.#sprites ??= {
      boss: [1, 2, 3].map((phase) => [0, 1].map((frame) => {
        const art = bossSprite(phase, frame);
        return art.grid.toCanvas(art.palette);
      })),
      ship: (() => {
        const art = playerShip();
        return art.grid.toCanvas(art.palette);
      })(),
    };
    this.#bg ??= this.#paintBackground();
    this.#battle = new BossBattle({ rand: randomFloat });
    this.#scene = audio.scene;
    audio.setScene('boss');
    this.#showOverlay('Esquiva los patrones de la IA Central. Tu nave dispara sola: muévete con ← → (o A / D), arrastrando el dedo o con el ratón.', 'Empezar');
    this.#renderHud();
    this.#draw(0);
    if (!d.dialog.open) d.dialog.showModal();
    d.start.focus();
  }

  #begin() {
    audio.click();
    if (!this.#battle || this.#battle.state !== 'ready') this.#battle = new BossBattle({ rand: randomFloat });
    this.#battle.start();
    this.#dom.overlay.hidden = true;
    this.#dom.canvas.focus?.();
    this.#dom.dialog.focus();
    this.#keys = { left: false, right: false };
    this.#resume();
  }

  #showOverlay(text, button) {
    this.#dom.message.textContent = text;
    this.#dom.start.textContent = button;
    this.#dom.overlay.hidden = false;
  }

  #key(event, down) {
    const left = event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A';
    const right = event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D';
    if (!left && !right) return;
    event.preventDefault();
    if (left) this.#keys.left = down;
    if (right) this.#keys.right = down;
    this.#pointerX = null;
  }

  #resume() {
    if (this.#raf || !this.#dom?.dialog.open || document.hidden || this.#battle?.state !== 'playing') return;
    this.#last = performance.now();
    this.#raf = requestAnimationFrame(this.#loop);
  }

  #pause() {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  // Cerrar el diálogo: se para el bucle y vuelve la música de la mesa.
  #stop() {
    this.#pause();
    this.#battle = null;
    audio.setScene(this.#scene === 'boss' ? 'tower' : this.#scene);
  }

  #loop = (now) => {
    this.#raf = 0;
    const battle = this.#battle;
    if (!battle || battle.state !== 'playing') return;
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    const input = this.#pointerX !== null ? { targetX: this.#pointerX } : { dir: (this.#keys.right ? 1 : 0) - (this.#keys.left ? 1 : 0) };
    battle.update(dt, input);
    for (const event of battle.drainEvents()) this.#sound(event);
    this.#draw(now);
    this.#renderHud();
    if (battle.state === 'won' || battle.state === 'lost') this.#finish(battle);
    else this.#raf = requestAnimationFrame(this.#loop);
  };

  #sound(event) {
    if (event.type === 'hit' && performance.now() - this.#hitSound > 90) {
      this.#hitSound = performance.now();
      audio.click();
    } else if (event.type === 'hurt') {
      audio.error();
      hud.shake?.();
    } else if (event.type === 'phase') {
      audio.danger();
    } else if (event.type === 'laser') {
      audio.alert();
    }
  }

  #finish(battle) {
    const score = battle.score;
    if (battle.state === 'won') {
      audio.fanfare();
      const saved = storage.read(CORE_KEY, null);
      const clears = Math.max(0, Number(saved?.clears) || 0);
      const best = Math.max(Number(saved?.best) || 0, score);
      storage.write(CORE_KEY, { clears: clears + 1, best });
      this.#showOverlay(`¡IA Central desconectada! ${formatChips(score)} puntos en ${Math.round(battle.time)} s. Recompensa: cofre legendario${clears === 0 ? ' (y otro más por ser la primera vez)' : ''}. Mejor marca: ${formatChips(best)}.`, 'Otra vez');
      document.dispatchEvent(new CustomEvent('core:won', { detail: { score, firstClear: clears === 0 } }));
      hud.toast(`Núcleo superado: ${formatChips(score)} puntos`, 'success', 5000);
    } else {
      audio.lose();
      this.#showOverlay(`Tu nave ha caído en la fase ${battle.phase}. ${formatChips(score)} puntos. La IA Central sigue al ${Math.round((battle.boss.hp / BOSS_HP) * 100)} %.`, 'Reintentar');
      this.#battle = new BossBattle({ rand: randomFloat });
    }
  }

  #renderHud() {
    const d = this.#dom;
    const battle = this.#battle;
    if (!battle) return;
    const hp = battle.boss.hp;
    d.hp.style.width = `${(hp / BOSS_HP) * 100}%`;
    d.hpMeter.setAttribute('aria-valuenow', String(hp));
    d.phase.textContent = String(battle.phase);
    if (d.lives.childElementCount !== battle.player.lives) {
      d.lives.replaceChildren(...Array.from({ length: Math.max(0, battle.player.lives) }, () => pixelIcon('px-plane')));
      d.lives.setAttribute('aria-label', `${battle.player.lives} de ${PLAYER_LIVES} vidas`);
    }
    d.score.textContent = formatChips(battle.score);
  }

  // Fondo fijo: columnas de servidores con luces y una rejilla tramada.
  #paintBackground() {
    const canvas = document.createElement('canvas');
    canvas.width = ARENA.w;
    canvas.height = ARENA.h;
    const ctx = pixelContext(canvas);
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    for (let x = 0; x < ARENA.w; x += 40) {
      ctx.fillStyle = '#0f1424';
      ctx.fillRect(x + 4, 0, 14, ARENA.h);
      ctx.fillStyle = '#141a2e';
      ctx.fillRect(x + 4, 0, 1, ARENA.h);
      for (let y = 6; y < ARENA.h; y += 12) {
        ctx.fillStyle = (x / 40 + y / 12) % 3 === 0 ? '#2bff9a' : (x + y) % 7 === 0 ? '#ff3fd0' : '#1d6fd6';
        ctx.fillRect(x + 7 + ((y / 12) % 2) * 6, y, 2, 1);
      }
    }
    ctx.fillStyle = 'rgba(63, 216, 255, 0.12)';
    for (let y = 0; y < ARENA.h; y += 2) for (let x = (y / 2) % 2; x < ARENA.w; x += 8) ctx.fillRect(x, y, 1, 1);
    return canvas;
  }

  #draw(now) {
    const ctx = this.#ctx;
    const battle = this.#battle;
    if (!ctx || !battle) return;
    ctx.drawImage(this.#bg, 0, 0);
    const b = battle.boss;
    const color = BULLET_COLORS[battle.phase - 1];
    // Láseres: aviso parpadeante y columna encendida.
    for (const l of battle.lasers) {
      if (l.on) {
        ctx.fillStyle = color;
        ctx.fillRect(l.x - 7, 0, 14, ARENA.h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(l.x - 2, 0, 4, ARENA.h);
      } else if (Math.floor(l.t * 10) % 2 === 0) {
        ctx.fillStyle = color;
        for (let y = 0; y < ARENA.h; y += 6) {
          ctx.fillRect(l.x - 7, y, 1, 3);
          ctx.fillRect(l.x + 6, y, 1, 3);
        }
      }
    }
    // Jefe con latido de 2 fotogramas y destello al recibir impactos.
    const frames = this.#sprites.boss[battle.phase - 1];
    const sprite = frames[Math.floor(now / 300) % 2];
    const bx = Math.round(b.x - sprite.width / 2);
    const by = Math.round(b.y - sprite.height / 2);
    ctx.drawImage(sprite, bx, by);
    if (b.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      ctx.drawImage(sprite, bx, by);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // Disparos del jugador y balas de la IA.
    ctx.fillStyle = '#ffcf3a';
    for (const s of battle.shots) ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 3, 2, 5);
    ctx.fillStyle = color;
    for (const e of battle.enemy) ctx.fillRect(Math.round(e.x) - 2, Math.round(e.y) - 2, 4, 4);
    ctx.fillStyle = '#ffffff';
    for (const e of battle.enemy) ctx.fillRect(Math.round(e.x) - 1, Math.round(e.y) - 1, 2, 2);
    // Nave (parpadea mientras es invulnerable).
    const p = battle.player;
    if (p.invulnerable <= 0 || Math.floor(now / 80) % 2 === 0) {
      const ship = this.#sprites.ship;
      ctx.drawImage(ship, Math.round(p.x - ship.width / 2), Math.round(p.y - ship.height / 2));
    }
  }
}

export const bossUi = new BossUi();
