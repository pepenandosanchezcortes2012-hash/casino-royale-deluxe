// Carrera del jugador en la torre del Sindicato:
// - XP por ronda = (apuesta × 0,25 + premio × 0,5) ÷ escala del piso desbloqueado (× 2 con el Pase
//   del Padrino). La escala (0,1 · 1 · 10 · 100) hace que subir de nivel cueste lo mismo en
//   todos los pisos: lo que cuenta son las apuestas en proporción a tu piso.
// - Niveles 1–50 con curva creciente (XP para pasar del nivel n al n+1 = 100 · n^1,6).
// - 6 rangos VIP por nivel: Bronce, Plata, Oro, Platino, Diamante y El Padrino.
// - Recompensas en créditos × escala del piso desbloqueado: créditos por nivel, cofre común cada
//   5 niveles y cofre legendario en cada rango.
// - 10 misiones diarias que dependen del piso desbloqueado (se eligen a medianoche). Solo cuentan
//   las rondas con una apuesta de al menos la mínima de tu piso más alto, y los importes de las
//   misiones se miden en la escala de ese piso.
// Sin DOM y sin tocar el monedero: los créditos se acumulan en `pendingChips` y la aplicación los
// cobra con collectChips().

import { storage as defaultStore } from './storage.js';

export const PROGRESS_KEY = 'crd.climb.progress.v1';
export const MAX_LEVEL = 50;
export const XP_RATES = Object.freeze({ bet: 0.25, win: 0.5 });
export const LEVEL_CHIPS = 100;
export const DAILY_MISSIONS = 10;
const GENERIC_MISSIONS = 4;

// XP necesaria para pasar del nivel `level` al siguiente.
export const xpToNext = (level) => (level >= MAX_LEVEL ? Infinity : Math.round(100 * level ** 1.6));

// LEVEL_XP[n] = XP total necesaria para alcanzar el nivel n (LEVEL_XP[1] = 0).
export const LEVEL_XP = Object.freeze(Array.from({ length: MAX_LEVEL + 1 }, (_, level) => {
  let total = 0;
  for (let n = 1; n < level; n++) total += xpToNext(n);
  return level === 0 ? 0 : total;
}));

// Rangos VIP: nivel mínimo y créditos extra (× escala) por minuto en el Reloj de la Abundancia.
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

const positive = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

// XP de una ronda. `scale` = escala del piso desbloqueado (1 en la Bahía Arcade).
export function roundXp({ stake = 0, returned = 0 } = {}, multiplier = 1, scale = 1) {
  const value = ((Math.max(0, stake) * XP_RATES.bet + Math.max(0, returned) * XP_RATES.win) * multiplier) / (positive(scale) || 1);
  return Number.isFinite(value) ? value : 0;
}

// Recompensa al alcanzar un nivel (en la escala 1): créditos y, cada 5 niveles, un cofre
// (legendario si es un rango nuevo).
export function levelReward(level) {
  const rankUp = VIP_RANKS.some((rank) => rank.level === level && level > 1);
  return {
    chips: level * LEVEL_CHIPS,
    chest: rankUp ? 'legendary' : level % 5 === 0 ? 'common' : null,
  };
}

const isGame = (round, ...games) => games.includes(round.game);
const won = (round) => round.net > 0;

// Misiones. `floor` = piso que abre sus mesas; `games` = mesas necesarias (alguna). `track(r)`
// devuelve cuánto avanza con una ronda que ya cumple la apuesta mínima; `amount` indica que la
// meta es un importe (se mide en la escala del piso y se muestra multiplicado por ella).
const mission = (item) => Object.freeze({ floor: 0, games: null, amount: false, free: false, ...item });

export const MISSIONS = Object.freeze([
  mission({ id: 'rounds', text: 'Juega 40 rondas', goal: 40, chips: 400, xp: 150, track: () => 1 }),
  mission({ id: 'wager', text: 'Apuesta {goal} créditos en total', goal: 5000, chips: 500, xp: 200, amount: true, track: (r) => r.scaledStake }),
  mission({ id: 'wins', text: 'Gana 15 rondas', goal: 15, chips: 400, xp: 150, track: (r) => (won(r) ? 1 : 0) }),
  mission({ id: 'big', text: 'Consigue un premio de ×10 o más', goal: 1, chips: 600, xp: 250, track: (r) => (r.multiplier >= 10 ? 1 : 0) }),
  // Subsuelo.
  mission({ id: 'dice', floor: 1, games: ['dice'], text: 'Gana 10 tiradas de dados', goal: 10, chips: 300, xp: 120, track: (r) => (isGame(r, 'dice') && won(r) ? 1 : 0) }),
  mission({ id: 'dice-risk', floor: 1, games: ['dice'], text: 'Gana 2 tiradas de dados con un 25 % o menos', goal: 2, chips: 350, xp: 140, track: (r) => (isGame(r, 'dice') && won(r) && r.chance <= 25 ? 1 : 0) }),
  mission({ id: 'safe', floor: 1, games: ['mines', 'towers'], text: 'Descubre 12 casillas seguras en Minas o Torres', goal: 12, chips: 300, xp: 120, track: (r) => (isGame(r, 'mines', 'towers') ? Math.max(0, r.safe | 0) : 0) }),
  mission({ id: 'mines-cash', floor: 1, games: ['mines'], text: 'Retírate 2 veces en Minas con ×3 o más', goal: 2, chips: 350, xp: 140, track: (r) => (isGame(r, 'mines') && r.multiplier >= 3 ? 1 : 0) }),
  mission({ id: 'towers-cash', floor: 1, games: ['towers'], text: 'Retírate 3 veces en la Torre con ×2 o más', goal: 3, chips: 350, xp: 140, track: (r) => (isGame(r, 'towers') && r.multiplier >= 2 ? 1 : 0) }),
  mission({ id: 'towers-high', floor: 1, games: ['towers'], text: 'Supera 5 pisos de la Torre en una sola subida', goal: 1, chips: 300, xp: 120, track: (r) => (isGame(r, 'towers') && (r.safe | 0) >= 5 ? 1 : 0) }),
  // Bahía Arcade.
  mission({ id: 'fish', floor: 2, games: ['fish'], text: 'Captura 30 criaturas en Cyber-Fish Hunter', goal: 30, chips: 350, xp: 140, track: (r) => (isGame(r, 'fish') ? Math.max(0, r.captures | 0) : 0) }),
  mission({ id: 'plinko', floor: 2, games: ['plinko'], text: 'Lanza 25 bolas de Plinko', goal: 25, chips: 250, xp: 100, track: (r) => (isGame(r, 'plinko') ? 1 : 0) }),
  mission({ id: 'avalanche', floor: 2, games: ['slots'], text: 'Consigue 3 avalanchas dobles en las slots', goal: 3, chips: 350, xp: 140, track: (r) => (isGame(r, 'slots') && r.tags.includes('cascade2') ? 1 : 0) }),
  // Salón VIP.
  mission({ id: 'crash', floor: 3, games: ['crash'], text: 'Retírate en Crash a ×2 o más 3 veces', goal: 3, chips: 350, xp: 140, track: (r) => (isGame(r, 'crash') && r.multiplier >= 2 ? 1 : 0) }),
  mission({ id: 'roulette', floor: 3, games: ['roulette'], text: 'Juega 10 tiradas de ruleta', goal: 10, chips: 250, xp: 100, track: (r) => (isGame(r, 'roulette') ? 1 : 0) }),
  mission({ id: 'vpoker', floor: 3, games: ['video_poker'], text: 'Consigue 3 manos con premio en Video Póker', goal: 3, chips: 300, xp: 120, track: (r) => (isGame(r, 'video_poker') && r.returned > 0 ? 1 : 0) }),
  // Cripto-Olympus.
  mission({ id: 'blackjack', floor: 4, games: ['blackjack'], text: 'Gana 5 manos de blackjack', goal: 5, chips: 300, xp: 120, track: (r) => (isGame(r, 'blackjack') && won(r) ? 1 : 0) }),
  mission({ id: 'wheel', floor: 4, games: ['wheel'], text: 'Gira la Rueda de la Fortuna Legendaria', goal: 1, chips: 200, xp: 80, free: true, track: (r) => (isGame(r, 'wheel') ? 1 : 0) }),
]);
export const missionById = (id) => MISSIONS.find((item) => item.id === id) ?? null;
export const MISSION_BONUS = Object.freeze({ chest: 'common', chips: 1000 });

// Las 10 misiones del día con las mesas de tu piso más alto: las 4 generales y 6 de mesas,
// empezando por las del piso recién abierto.
export function dailyMissions(games) {
  const generic = MISSIONS.filter((item) => !item.games).slice(0, GENERIC_MISSIONS);
  const specific = MISSIONS
    .filter((item) => item.games && item.games.some((game) => games.includes(game)))
    .sort((a, b) => b.floor - a.floor || MISSIONS.indexOf(a) - MISSIONS.indexOf(b))
    .slice(0, DAILY_MISSIONS - generic.length);
  return [...generic, ...specific].map((item) => item.id);
}

// Texto de una misión con su meta en créditos de tu piso.
export function missionText(item, scale = 1) {
  return item.text.replace('{goal}', new Intl.NumberFormat('es-ES', { useGrouping: 'always' }).format(Math.round(item.goal * scale)));
}

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
const FIRST_FLOOR_GAMES = Object.freeze(['mines', 'dice', 'towers']);

function freshMissions(day, ids = null) {
  return { day, ids, progress: {}, done: [], bonus: false };
}

function sanitize(raw, today) {
  const state = { xp: 0, pendingChips: 0, missions: freshMissions(today), stats: { rounds: 0, wagered: 0, returned: 0, best: 0 } };
  if (!raw || typeof raw !== 'object') return state;
  if (finite(raw.xp)) state.xp = Math.min(raw.xp, LEVEL_XP[MAX_LEVEL] * 4);
  if (finite(raw.pendingChips)) state.pendingChips = Math.floor(raw.pendingChips);
  const m = raw.missions;
  if (m && typeof m === 'object' && DAY.test(m.day) && m.day === today && Array.isArray(m.ids)) {
    const ids = [...new Set(m.ids.filter((id) => missionById(id)))].slice(0, DAILY_MISSIONS);
    if (ids.length) {
      state.missions.ids = ids;
      for (const id of ids) {
        const goal = missionById(id).goal;
        if (finite(m.progress?.[id])) state.missions.progress[id] = Math.min(goal, m.progress[id]);
      }
      if (Array.isArray(m.done)) state.missions.done = ids.filter((id) => m.done.includes(id));
      state.missions.bonus = m.bonus === true;
    }
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
  // Escala, apuesta mínima y mesas del piso desbloqueado (las inyecta attach()).
  #scale = () => 1;
  #minStake = () => 0;
  #games = () => FIRST_FLOOR_GAMES;

  constructor({ store = defaultStore, now = () => Date.now(), scale = null, minStake = null, games = null } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#configure({ scale, minStake, games });
    this.#s = sanitize(store.read(PROGRESS_KEY, null), localDay(now()));
  }

  #configure({ scale, minStake, games }) {
    if (scale) this.#scale = scale;
    if (minStake) this.#minStake = minStake;
    if (games) this.#games = games;
  }

  #save() {
    this.#store.write(PROGRESS_KEY, this.#s);
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #scaleNow() {
    return positive(this.#scale()) || 1;
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

  get scale() {
    return this.#scaleNow();
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

  // Suma XP y reparte las recompensas de cada nivel alcanzado (en créditos de tu piso).
  addXp(amount, reason = 'xp') {
    if (!(amount > 0) || !Number.isFinite(amount)) return { gained: 0, levels: [] };
    const before = this.level;
    const beforeRank = rankIndexFor(before);
    this.#s.xp += amount;
    const after = this.level;
    const scale = this.#scaleNow();
    const levels = [];
    for (let level = before + 1; level <= after; level++) {
      const reward = levelReward(level);
      const chips = Math.round(reward.chips * scale);
      this.#s.pendingChips += chips;
      levels.push({ level, chips, chest: reward.chest });
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

  // Cobra los créditos acumulados (niveles y misiones). Devuelve el importe.
  collectChips() {
    const amount = this.#s.pendingChips;
    if (amount <= 0) return 0;
    this.#s.pendingChips = 0;
    this.#save();
    this.#emit('change', { reason: 'collect' });
    return amount;
  }

  // ---------- Rondas y misiones ----------

  // `round`: { game, stake, returned, tags, safe, chance, captures, … }.
  addRound(round, { multiplier = 1 } = {}) {
    const scale = this.#scaleNow();
    const info = {
      ...round,
      game: String(round?.game ?? ''),
      stake: finite(round?.stake) ? round.stake : 0,
      returned: finite(round?.returned) ? round.returned : 0,
      tags: Array.isArray(round?.tags) ? round.tags : [],
    };
    info.net = info.returned - info.stake;
    info.multiplier = info.stake > 0 ? info.returned / info.stake : 0;
    info.scaledStake = info.stake / scale;
    const stats = this.#s.stats;
    stats.rounds += info.stake > 0 ? 1 : 0;
    stats.wagered += info.stake;
    stats.returned += info.returned;
    stats.best = Math.max(stats.best, info.multiplier);
    this.#track(info, multiplier);
    const xp = roundXp(info, multiplier, scale);
    if (xp > 0) this.addXp(xp, 'round');
    else this.#save();
    return xp;
  }

  #rollover() {
    const today = localDay(this.#now());
    const m = this.#s.missions;
    if (m.day !== today || !m.ids) {
      this.#s.missions = freshMissions(today, dailyMissions(this.#games()));
      this.#save();
      this.#emit('change', { reason: 'missions-reset' });
    }
  }

  #track(round, multiplier) {
    this.#rollover();
    const m = this.#s.missions;
    const qualifies = round.stake > 0 && round.stake + 1e-9 >= this.#minStake();
    const completed = [];
    for (const id of m.ids) {
      const item = missionById(id);
      if (!item || m.done.includes(id)) continue;
      if (!(item.free || qualifies)) continue;
      const step = item.track(round);
      if (!(step > 0)) continue;
      m.progress[id] = Math.min(item.goal, (m.progress[id] ?? 0) + step);
      if (m.progress[id] >= item.goal) {
        m.done.push(id);
        completed.push(item);
      }
    }
    if (!completed.length) return;
    const scale = this.#scaleNow();
    const rewards = completed.map((item) => ({ item, chips: Math.round(item.chips * scale) }));
    for (const { chips } of rewards) this.#s.pendingChips += chips;
    let bonus = 0;
    if (m.done.length === m.ids.length && !m.bonus) {
      m.bonus = true;
      bonus = Math.round(MISSION_BONUS.chips * scale);
      this.#s.pendingChips += bonus;
    }
    this.#save();
    for (const { item, chips } of rewards) {
      const text = missionText(item, scale);
      this.#emit('mission', { mission: { id: item.id, text, chips }, done: m.done.length, total: m.ids.length });
      this.#emit('reward', { chips, chest: null, reason: `Misión: ${text}` });
    }
    for (const { item } of rewards) this.addXp(item.xp * multiplier, 'mission');
    if (bonus) {
      this.#emit('missions-complete', { chest: MISSION_BONUS.chest, chips: bonus });
      this.#emit('reward', { chips: bonus, chest: MISSION_BONUS.chest, reason: 'Las 10 misiones del día' });
    }
  }

  missions() {
    this.#rollover();
    const m = this.#s.missions;
    const scale = this.#scaleNow();
    return m.ids.map((id) => {
      const item = missionById(id);
      return {
        id,
        text: missionText(item, scale),
        goal: item.goal,
        chips: Math.round(item.chips * scale),
        xp: item.xp,
        progress: m.progress[id] ?? 0,
        done: m.done.includes(id),
        amount: item.amount,
        scale,
      };
    });
  }

  get missionsDone() {
    this.#rollover();
    return this.#s.missions.done.length;
  }

  get missionsTotal() {
    this.#rollover();
    return this.#s.missions.ids.length;
  }

  // Bono por completar las misiones del día, en créditos de tu piso.
  get missionBonus() {
    return { chest: MISSION_BONUS.chest, chips: Math.round(MISSION_BONUS.chips * this.#scaleNow()) };
  }

  get missionsResetAt() {
    return nextMidnight(this.#now());
  }

  // Conecta la progresión al bus: cada ronda terminada suma XP y avanza las misiones.
  // `scale`, `minStake` y `games` describen el piso desbloqueado más alto.
  attach(bus, { xpMultiplier = () => 1, scale = null, minStake = null, games = null } = {}) {
    this.#configure({ scale, minStake, games });
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
