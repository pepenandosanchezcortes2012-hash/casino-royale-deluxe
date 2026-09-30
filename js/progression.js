// Progresión global del jugador (compartida por el Modo Historia y el Cripto-Casino):
// - XP por ronda = apuesta × 0,25 + premio × 0,5 (× 2 con el Pase del Padrino).
// - Niveles 1–50 con curva creciente (XP para pasar del nivel n al n+1 = 100 · n^1,6).
// - 6 rangos VIP por nivel: Bronce, Plata, Oro, Platino, Diamante y El Padrino.
// - Recompensas: fichas por nivel, cofre común cada 5 niveles y cofre legendario en cada rango.
// - 10 misiones diarias acumulativas (se reinician a medianoche) que pagan fichas y XP.
// Sin DOM y sin tocar el monedero: las fichas se acumulan en `pendingChips` y el Cripto-Casino las
// cobra con collectChips(); lo que se gane en la historia espera allí a la próxima visita.

import { storage as defaultStore } from './storage.js';

export const PROGRESS_KEY = 'crd.progress.v1';
export const MAX_LEVEL = 50;
export const XP_RATES = Object.freeze({ bet: 0.25, win: 0.5 });
export const LEVEL_CHIPS = 100;

// XP necesaria para pasar del nivel `level` al siguiente.
export const xpToNext = (level) => (level >= MAX_LEVEL ? Infinity : Math.round(100 * level ** 1.6));

// LEVEL_XP[n] = XP total necesaria para alcanzar el nivel n (LEVEL_XP[1] = 0).
export const LEVEL_XP = Object.freeze(Array.from({ length: MAX_LEVEL + 1 }, (_, level) => {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpToNext(n);
  return level === 0 ? 0 : total;
}));

// Rangos VIP: nivel mínimo y fichas extra por minuto en el Reloj de la Abundancia.
export const VIP_RANKS = Object.freeze([
  Object.freeze({ id: 'bronze', name: 'Bronce', level: 1, abundance: 0, color: '#cd7f32' }),
  Object.freeze({ id: 'silver', name: 'Plata', level: 10, abundance: 10, color: '#c9d1d9' }),
  Object.freeze({ id: 'gold', name: 'Oro', level: 20, abundance: 20, color: '#f5c542' }),
  Object.freeze({ id: 'platinum', name: 'Platino', level: 30, abundance: 30, color: '#9fe8ff' }),
  Object.freeze({ id: 'diamond', name: 'Diamante', level: 40, abundance: 40, color: '#6fb6ff' }),
  Object.freeze({ id: 'godfather', name: 'El Padrino', level: 50, abundance: 50, color: '#ff3b5c' }),
]);

export function levelFor(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= LEVEL_XP[level + 1]) level++;
  return level;
}

export function rankIndexFor(level) {
  let index = 0;
  while (index + 1 < VIP_RANKS.length && level >= VIP_RANKS[index + 1].level) index++;
  return index;
}

export const rankFor = (level) => VIP_RANKS[rankIndexFor(level)];

export function roundXp({ stake = 0, returned = 0 } = {}, multiplier = 1) {
  const value = (Math.max(0, stake) * XP_RATES.bet + Math.max(0, returned) * XP_RATES.win) * multiplier;
  return Number.isFinite(value) ? value : 0;
}

// Recompensa al alcanzar un nivel: fichas y, cada 5 niveles, un cofre (legendario si es un rango).
export function levelReward(level) {
  const rankUp = VIP_RANKS.some((rank) => rank.level === level && level > 1);
  return {
    chips: level * LEVEL_CHIPS,
    chest: rankUp ? 'legendary' : level % 5 === 0 ? 'common' : null,
  };
}

const isGame = (...games) => (round) => games.includes(round.game);

// Misiones diarias. `track(round)` devuelve cuánto avanza la misión con esa ronda.
export const MISSIONS = Object.freeze([
  Object.freeze({ id: 'rounds', text: 'Juega 40 rondas', goal: 40, chips: 400, xp: 150, track: (r) => (r.stake > 0 ? 1 : 0) }),
  Object.freeze({ id: 'wager', text: 'Apuesta 5.000 fichas en total', goal: 5000, chips: 500, xp: 200, track: (r) => Math.max(0, r.stake) }),
  Object.freeze({ id: 'wins', text: 'Gana 15 rondas', goal: 15, chips: 400, xp: 150, track: (r) => (r.net > 0 ? 1 : 0) }),
  Object.freeze({ id: 'blackjack', text: 'Gana 5 manos de blackjack', goal: 5, chips: 300, xp: 120, track: (r) => (isGame('blackjack')(r) && r.net > 0 ? 1 : 0) }),
  Object.freeze({ id: 'roulette', text: 'Juega 10 tiradas de ruleta', goal: 10, chips: 250, xp: 100, track: (r) => (isGame('roulette')(r) && r.stake > 0 ? 1 : 0) }),
  Object.freeze({ id: 'avalanche', text: 'Consigue 3 avalanchas dobles en las slots', goal: 3, chips: 350, xp: 140, track: (r) => (isGame('slots')(r) && r.tags.includes('cascade2') ? 1 : 0) }),
  Object.freeze({ id: 'plinko', text: 'Lanza 25 bolas de Plinko', goal: 25, chips: 250, xp: 100, track: (r) => (isGame('plinko')(r) ? 1 : 0) }),
  Object.freeze({ id: 'crash', text: 'Retírate en Crash a ×2 o más 3 veces', goal: 3, chips: 350, xp: 140, track: (r) => (isGame('crash')(r) && r.multiplier >= 2 ? 1 : 0) }),
  Object.freeze({ id: 'safe', text: 'Descubre 12 casillas seguras en Minas o Torres', goal: 12, chips: 300, xp: 120, track: (r) => (isGame('mines', 'towers')(r) ? Math.max(0, r.safe | 0) : 0) }),
  Object.freeze({ id: 'big', text: 'Consigue un premio de ×10 o más', goal: 1, chips: 600, xp: 250, track: (r) => (r.stake > 0 && r.multiplier >= 10 ? 1 : 0) }),
]);
export const MISSION_BONUS = Object.freeze({ chest: 'common', chips: 1000 });

// Día natural local (AAAA-MM-DD): las misiones se renuevan a medianoche del jugador.
export function localDay(time) {
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function nextMidnight(time) {
  const date = new Date(time);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function freshMissions(day) {
  return { day, progress: Object.fromEntries(MISSIONS.map((m) => [m.id, 0])), done: [], bonus: false };
}

function sanitize(raw, today) {
  const state = { xp: 0, pendingChips: 0, missions: freshMissions(today), stats: { rounds: 0, wagered: 0, returned: 0, best: 0 } };
  if (!raw || typeof raw !== 'object') return state;
  if (finite(raw.xp)) state.xp = Math.min(raw.xp, LEVEL_XP[MAX_LEVEL] * 4);
  if (finite(raw.pendingChips)) state.pendingChips = Math.floor(raw.pendingChips);
  const m = raw.missions;
  if (m && typeof m === 'object' && DAY.test(m.day) && m.day === today) {
    for (const mission of MISSIONS) if (finite(m.progress?.[mission.id])) state.missions.progress[mission.id] = Math.min(mission.goal, m.progress[mission.id]);
    if (Array.isArray(m.done)) state.missions.done = MISSIONS.map((mission) => mission.id).filter((id) => m.done.includes(id));
    state.missions.bonus = m.bonus === true;
  }
  if (raw.stats && typeof raw.stats === 'object') {
    for (const key of Object.keys(state.stats)) if (finite(raw.stats[key])) state.stats[key] = raw.stats[key];
  }
  return state;
}

export class Progression extends EventTarget {
  #store;
  #now;
  #s;

  constructor({ store = defaultStore, now = () => Date.now() } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#s = sanitize(store.read(PROGRESS_KEY, null), localDay(now()));
  }

  #save() {
    this.#store.write(PROGRESS_KEY, this.#s);
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---------- Nivel y rango ----------

  get xp() {
    return this.#s.xp;
  }

  get level() {
    return levelFor(this.#s.xp);
  }

  get rank() {
    return rankFor(this.level);
  }

  get stats() {
    return { ...this.#s.stats };
  }

  get pendingChips() {
    return this.#s.pendingChips;
  }

  progress() {
    const level = this.level;
    const start = LEVEL_XP[level];
    const needed = xpToNext(level);
    const into = this.#s.xp - start;
    const index = rankIndexFor(level);
    return {
      level,
      xp: this.#s.xp,
      into,
      needed,
      ratio: level >= MAX_LEVEL ? 1 : Math.min(1, Math.max(0, into / needed)),
      rank: VIP_RANKS[index],
      nextRank: VIP_RANKS[index + 1] ?? null,
      max: level >= MAX_LEVEL,
    };
  }

  // Suma XP y reparte las recompensas de cada nivel alcanzado.
  addXp(amount, reason = 'xp') {
    if (!(amount > 0) || !Number.isFinite(amount)) return { gained: 0, levels: [] };
    const before = this.level;
    const beforeRank = rankIndexFor(before);
    this.#s.xp += amount;
    const after = this.level;
    const levels = [];
    for (let level = before + 1; level <= after; level++) {
      const reward = levelReward(level);
      this.#s.pendingChips += reward.chips;
      levels.push({ level, ...reward });
    }
    this.#save();
    this.#emit('xp', { gained: amount, reason, xp: this.#s.xp });
    for (const item of levels) {
      this.#emit('levelup', item);
      this.#emit('reward', { chips: item.chips, chest: item.chest, reason: `Nivel ${item.level}` });
    }
    const afterRank = rankIndexFor(after);
    if (afterRank > beforeRank) this.#emit('rankup', { rank: VIP_RANKS[afterRank], previous: VIP_RANKS[beforeRank] });
    this.#emit('change', { reason });
    return { gained: amount, levels };
  }

  // Cobra las fichas acumuladas (niveles y misiones). Devuelve el importe.
  collectChips() {
    const amount = this.#s.pendingChips;
    if (amount <= 0) return 0;
    this.#s.pendingChips = 0;
    this.#save();
    this.#emit('change', { reason: 'collect' });
    return amount;
  }

  // ---------- Rondas y misiones ----------

  // `round`: { game, stake, returned, net, multiplier, tags, mode, safe }.
  addRound(round, { multiplier = 1 } = {}) {
    const info = {
      game: String(round?.game ?? ''),
      stake: finite(round?.stake) ? round.stake : 0,
      returned: finite(round?.returned) ? round.returned : 0,
      tags: Array.isArray(round?.tags) ? round.tags : [],
      mode: round?.mode ?? 'free',
      safe: round?.safe ?? 0,
    };
    info.net = info.returned - info.stake;
    info.multiplier = info.stake > 0 ? info.returned / info.stake : 0;
    const stats = this.#s.stats;
    stats.rounds += info.stake > 0 ? 1 : 0;
    stats.wagered += info.stake;
    stats.returned += info.returned;
    stats.best = Math.max(stats.best, info.multiplier);
    if (info.mode === 'free') this.#track(info, multiplier);
    const xp = roundXp(info, multiplier);
    if (xp > 0) this.addXp(xp, 'round');
    else this.#save();
    return xp;
  }

  #rollover() {
    const today = localDay(this.#now());
    if (this.#s.missions.day !== today) {
      this.#s.missions = freshMissions(today);
      this.#save();
      this.#emit('change', { reason: 'missions-reset' });
    }
  }

  #track(round, multiplier) {
    this.#rollover();
    const m = this.#s.missions;
    const completed = [];
    for (const mission of MISSIONS) {
      if (m.done.includes(mission.id)) continue;
      const step = mission.track(round);
      if (!(step > 0)) continue;
      m.progress[mission.id] = Math.min(mission.goal, m.progress[mission.id] + step);
      if (m.progress[mission.id] >= mission.goal) {
        m.done.push(mission.id);
        completed.push(mission);
      }
    }
    if (!completed.length) return;
    for (const mission of completed) {
      this.#s.pendingChips += mission.chips;
      this.#emit('mission', { mission, done: m.done.length, total: MISSIONS.length });
      this.#emit('reward', { chips: mission.chips, chest: null, reason: `Misión: ${mission.text}` });
    }
    let bonus = false;
    if (m.done.length === MISSIONS.length && !m.bonus) {
      m.bonus = true;
      bonus = true;
      this.#s.pendingChips += MISSION_BONUS.chips;
    }
    this.#save();
    for (const mission of completed) this.addXp(mission.xp * multiplier, 'mission');
    if (bonus) {
      this.#emit('missions-complete', { ...MISSION_BONUS });
      this.#emit('reward', { chips: MISSION_BONUS.chips, chest: MISSION_BONUS.chest, reason: 'Las 10 misiones del día' });
    }
  }

  missions() {
    this.#rollover();
    const m = this.#s.missions;
    return MISSIONS.map((mission) => ({
      id: mission.id,
      text: mission.text,
      goal: mission.goal,
      chips: mission.chips,
      xp: mission.xp,
      progress: m.progress[mission.id],
      done: m.done.includes(mission.id),
    }));
  }

  get missionsDone() {
    this.#rollover();
    return this.#s.missions.done.length;
  }

  get missionsResetAt() {
    return nextMidnight(this.#now());
  }

  // Conecta la progresión al bus: cada ronda terminada suma XP y avanza las misiones.
  attach(bus, { xpMultiplier = () => 1 } = {}) {
    const offRound = bus.on('round:end', (round) => this.addRound(round, { multiplier: xpMultiplier() }));
    const onReward = (event) => {
      if (event.detail.chest) bus.emit('reward:chest', { tier: event.detail.chest, reason: event.detail.reason });
      if (event.detail.chips) bus.emit('reward:chips', { amount: event.detail.chips, reason: event.detail.reason });
    };
    this.addEventListener('reward', onReward);
    return () => {
      offRound();
      this.removeEventListener('reward', onReward);
    };
  }
}

export const progression = new Progression();
