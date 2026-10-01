// «The Syndicate Climb»: la escalada de 10 créditos a 10.000.000 por los 4 pisos del Sindicato.
// Máquina de estados (intro → playing → victory), piso actual y piso desbloqueado, récord,
// limosna con enfriamiento, títulos, logros, encargos por piso, jugadas críticas, estadísticas y
// la Bitácora del Sindicato. Sin DOM: las mesas le informan de cada ronda (a través de la sesión)
// y la interfaz escucha sus eventos. Todo se guarda en localStorage.

import { storage as defaultStore } from '../storage.js';
import { randomInt } from '../engine/rng.js';
import { wallet as defaultWallet } from '../engine/wallet.js';
import {
  FLOORS, GOAL, RESCUE_AMOUNT, RESCUE_COOLDOWN_MS, CRITICAL_SHARE, CRITICAL_MIN_BETS,
  floorById, floorByLevel, isFloorId, limitsFor, goalProgress,
} from './floors.js';
import { TITLES, titleIndexFor } from './titles.js';
import { ACHIEVEMENTS, achievementById } from './achievements.js';
import { drawContract, advanceContract, contractType, strongWin, ACTIVE_CONTRACTS } from './contracts.js';
import { narrate } from './narrative.js';

export const CLIMB_KEY = 'crd.climb.v1';
export const HALL_KEY = 'crd.climb.hall.v1';
// Partida de una escalada: al empezar otra se borran el monedero y las jugadas a medias.
export const RUN_KEYS = Object.freeze([
  'crd.climb.wallet.v1',
  'crd.climb.blackjack.v2',
  'crd.climb.roulette.v1',
  'crd.climb.slots.v2',
  'crd.climb.mines.round.v1',
  'crd.climb.towers.round.v1',
  'crd.climb.videopoker.round.v1',
  'crd.climb.crash.round.v1',
]);
const STATUSES = Object.freeze(['intro', 'playing', 'victory']);
const LOG_LIMIT = 60;
const OWNERS_LIMIT = 5;
export const OWNER_NAME_MAX = 24;
const EPS = 1e-9;
const STREAK_MARKS = new Set([3, 5, 7, 10, 15, 20]);
const COMEBACK_AT = 1000;
const SKYLINE_AT = 5_000_000;

const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' });
const fmt = (value) => numberFormat.format(value);
const round2 = (value) => Math.round(value * 100) / 100;
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

// Alias del epílogo: texto plano, sin caracteres de control y como mucho 24 caracteres.
export function cleanOwnerName(name) {
  const text = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return [...text].slice(0, OWNER_NAME_MAX).join('');
}

function freshStats(balance) {
  return {
    rounds: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    wagered: 0,
    returned: 0,
    biggestWin: 0,
    bestMultiplier: 0,
    maxBalance: balance,
    streak: 0,
    bestStreak: 0,
    worstStreak: 0,
    strongStreak: 0,
    criticalWins: 0,
    criticalLosses: 0,
    contractsDone: 0,
    rewards: 0,
    rescues: 0,
    rescueCredits: 0,
    travels: 0,
  };
}

function freshState(run, now, balance) {
  return {
    version: 1,
    run,
    status: 'intro',
    started: now,
    ended: null,
    floor: FLOORS[0].id,
    unlocked: 1,
    record: balance,
    rescueAt: 0,
    rescued: false,
    achievements: {},
    contracts: {},
    title: titleIndexFor(balance),
    stats: freshStats(balance),
    brokeNotice: false,
    owner: null,
    log: [],
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !STATUSES.includes(raw.status)) return null;
  const stats = freshStats(0);
  for (const key of Object.keys(stats)) if (isNum(raw.stats?.[key])) stats[key] = raw.stats[key];
  const contracts = {};
  for (const item of FLOORS) {
    const entries = Array.isArray(raw.contracts?.[item.id]) ? raw.contracts[item.id] : [];
    contracts[item.id] = entries
      .filter((c) => c && contractType(c.type) && isNum(c.goal) && isNum(c.progress) && isNum(c.reward) && typeof c.text === 'string')
      .slice(0, ACTIVE_CONTRACTS)
      .map((c) => ({ type: c.type, text: c.text, goal: c.goal, progress: Math.min(c.goal, Math.max(0, c.progress)), reward: c.reward }));
  }
  const achievements = {};
  for (const item of ACHIEVEMENTS) if (isNum(raw.achievements?.[item.id])) achievements[item.id] = raw.achievements[item.id];
  const log = Array.isArray(raw.log)
    ? raw.log.filter((e) => e && isNum(e.id) && isNum(e.t) && typeof e.text === 'string' && typeof e.speaker === 'string').slice(-LOG_LIMIT)
    : [];
  const unlocked = Number.isInteger(raw.unlocked) ? Math.min(FLOORS.length, Math.max(1, raw.unlocked)) : 1;
  const floor = isFloorId(raw.floor) && floorById(raw.floor).level <= unlocked ? raw.floor : FLOORS[0].id;
  const owner = raw.owner && typeof raw.owner.name === 'string' && isNum(raw.owner.at) ? { name: cleanOwnerName(raw.owner.name) || 'Anónimo', at: raw.owner.at } : null;
  return {
    version: 1,
    run: Number.isInteger(raw.run) && raw.run > 0 ? raw.run : 1,
    status: raw.status,
    started: isNum(raw.started) ? raw.started : Date.now(),
    ended: isNum(raw.ended) ? raw.ended : null,
    floor,
    unlocked,
    record: isNum(raw.record) && raw.record >= 0 ? raw.record : 0,
    rescueAt: isNum(raw.rescueAt) && raw.rescueAt >= 0 ? raw.rescueAt : 0,
    rescued: raw.rescued === true,
    achievements,
    contracts,
    title: Number.isInteger(raw.title) ? Math.min(TITLES.length - 1, Math.max(0, raw.title)) : 1,
    stats,
    brokeNotice: raw.brokeNotice === true,
    owner,
    log,
  };
}

export class Climb extends EventTarget {
  #wallet;
  #store;
  #rand;
  #now;
  #s;
  #hall;
  #games = new Map();
  #critical = null;
  #checkTimer = 0;
  #logSeq = 0;

  constructor({ wallet = defaultWallet, store = defaultStore, rand = randomInt, now = () => Date.now() } = {}) {
    super();
    this.#wallet = wallet;
    this.#store = store;
    this.#rand = rand;
    this.#now = now;
    this.#hall = this.#loadHall();
    const saved = sanitize(store.read(CLIMB_KEY, null));
    if (saved) {
      this.#s = saved;
      this.#s.record = Math.max(this.#s.record, wallet.balance);
    } else {
      // Nueva escalada: monedero de 10 créditos y ninguna jugada a medias de la anterior.
      for (const key of RUN_KEYS) store.remove(key);
      wallet.reset?.();
      this.#hall.runs += 1;
      this.#saveHall();
      this.#s = freshState(this.#hall.runs, now(), wallet.balance);
      this.#save();
    }
    this.#logSeq = this.#s.log.reduce((max, entry) => Math.max(max, entry.id), 0);
    wallet.addEventListener?.('change', () => this.#scheduleCheck());
  }

  // ---------- Lectura ----------

  get status() {
    return this.#s.status;
  }

  // Se puede jugar desde que empieza la escalada, también después de la victoria.
  get playable() {
    return this.#s.status !== 'intro';
  }

  get state() {
    return structuredClone(this.#s);
  }

  get floor() {
    return floorById(this.#s.floor);
  }

  get unlockedLevel() {
    return this.#s.unlocked;
  }

  get unlockedFloor() {
    return floorByLevel(this.#s.unlocked);
  }

  // Siguiente tarjeta de acceso por conseguir (null con los 4 pisos abiertos).
  get nextFloor() {
    return FLOORS[this.#s.unlocked] ?? null;
  }

  get title() {
    return TITLES[this.#s.title];
  }

  get record() {
    return Math.max(this.#s.record, this.#wallet.balance);
  }

  get progress() {
    return goalProgress(this.#wallet.balance);
  }

  get contracts() {
    return structuredClone(this.#s.contracts[this.#s.floor] ?? []);
  }

  get log() {
    return this.#s.log.slice();
  }

  get hall() {
    return structuredClone(this.#hall);
  }

  get owner() {
    return this.#s.owner ? { ...this.#s.owner } : null;
  }

  limits(game) {
    return limitsFor(this.floor, game);
  }

  // ¿Se puede jugar a esta mesa en el piso actual?
  available(game) {
    return this.floor.games.includes(game);
  }

  register(id, api) {
    this.#games.set(id, api);
  }

  #pending() {
    return this.#wallet.inPlay > EPS || [...this.#games.values()].some((game) => game.hasPendingPlay?.());
  }

  get pending() {
    return this.#pending();
  }

  // ---------- Flujo de la escalada ----------

  begin() {
    if (this.#s.status !== 'intro') return;
    this.#s.status = 'playing';
    this.#s.started = this.#now();
    this.#log('begin', {}, 'story');
    this.#log('arrive', {}, 'story');
    this.#ensureContracts();
    this.#save();
    this.#emit('status', { status: 'playing' });
    this.#afterBalance();
  }

  travelStatus(id) {
    if (!isFloorId(id)) return { ok: false, reason: 'unknown' };
    const target = floorById(id);
    if (target.id === this.#s.floor) return { ok: false, reason: 'here' };
    if (!this.playable) return { ok: false, reason: 'status' };
    if (target.level > this.#s.unlocked) return { ok: false, reason: 'locked', need: target.unlockAt };
    if (this.#pending()) return { ok: false, reason: 'pending' };
    return { ok: true };
  }

  travel(id) {
    const status = this.travelStatus(id);
    if (!status.ok) return status;
    const target = floorById(id);
    const from = this.floor;
    this.#s.floor = target.id;
    this.#s.stats.travels += 1;
    this.#log('arrive', {}, 'story', target.id);
    this.#ensureContracts();
    this.#save();
    this.#emit('floor', { floor: target, from });
    for (const game of this.#games.values()) game.onZone?.(target);
    return status;
  }

  // Jugada crítica: arriesgar la mitad o más del saldo con al menos 10 apuestas mínimas en juego,
  // o apostarlo todo. Así el drama no se repite en cada apuesta mínima con poco saldo.
  #isCritical(stake, bankroll) {
    if (!(stake > 0) || !(bankroll > 0)) return false;
    if (stake + EPS >= bankroll) return true;
    return stake + EPS >= CRITICAL_SHARE * bankroll && stake + EPS >= CRITICAL_MIN_BETS * this.floor.minBet;
  }

  // Aviso previo de una ronda (con la apuesta ya retenida): anuncia las jugadas críticas.
  beginRound({ game, stake }) {
    if (!this.playable || !(stake > 0)) return false;
    const bankroll = this.#wallet.balance + stake;
    if (!this.#isCritical(stake, bankroll)) return false;
    const share = stake / bankroll;
    this.#critical = { game, stake, share };
    this.#log('critical-start', { share: Math.round(share * 100) }, 'critical');
    this.#emit('critical', { game, stake, share });
    return true;
  }

  // Resultado de una ronda terminada (tras acreditar el premio). `tags` describe lo ocurrido;
  // las mesas pueden añadir datos propios (chance de los dados, capturas de Cyber-Fish…).
  report(round) {
    if (!this.playable || !round) return;
    const game = String(round.game ?? '');
    const stake = isNum(round.stake) && round.stake > 0 ? round.stake : 0;
    const returned = isNum(round.returned) && round.returned > 0 ? round.returned : 0;
    if (stake <= 0 && returned <= 0) return;
    const tags = Array.isArray(round.tags) ? round.tags : [];
    const st = this.#s.stats;
    const net = round2(returned - stake);
    const bankroll = this.#wallet.balance - net;
    const previousStreak = st.streak;
    const info = { ...round, game, stake, returned, net, tags, multiplier: stake > 0 ? returned / stake : 0 };

    st.rounds += 1;
    st.wagered = round2(st.wagered + stake);
    st.returned = round2(st.returned + returned);
    if (net > EPS) {
      st.wins += 1;
      st.streak = st.streak > 0 ? st.streak + 1 : 1;
      st.biggestWin = Math.max(st.biggestWin, net);
    } else if (net < -EPS) {
      st.losses += 1;
      st.streak = st.streak < 0 ? st.streak - 1 : -1;
    } else {
      st.pushes += 1;
    }
    if (stake > 0) {
      st.bestMultiplier = Math.max(st.bestMultiplier, round2(info.multiplier));
      st.strongStreak = strongWin(info) ? st.strongStreak + 1 : 0;
    }
    st.bestStreak = Math.max(st.bestStreak, st.streak);
    st.worstStreak = Math.min(st.worstStreak, st.streak);

    const critical = (this.#critical?.game === game && stake > 0) || this.#isCritical(stake, bankroll);
    this.#critical = null;
    if (critical && net > EPS) st.criticalWins += 1;
    if (critical && net < -EPS) st.criticalLosses += 1;

    this.#narrateRound({ net, stake, bankroll, critical });
    this.#roundAchievements(info, { bankroll, critical, previousStreak });
    this.#progressContracts(info, st.strongStreak);
    this.#save();
    this.#emit('round', { game, stake, returned, net, critical, tags });
    this.#afterBalance();
  }

  #roundAchievements(r, { bankroll, critical, previousStreak }) {
    const has = (tag) => r.tags.includes(tag);
    const st = this.#s.stats;
    if (r.net > EPS) {
      this.#achieve('first-win');
      if (r.stake > 0 && r.stake + EPS >= bankroll) this.#achieve('all-in');
      if (critical) this.#achieve('all-or-nothing');
      if (previousStreak <= -5) this.#achieve('steel-nerves');
      if (r.game === 'dice' && r.chance <= 2) this.#achieve('sniper');
    }
    if (st.strongStreak >= 5) this.#achieve('hot-hand');
    if (r.game === 'mines' && r.stake > 0 && r.multiplier >= 10) this.#achieve('deminer');
    if (r.game === 'crash' && r.stake > 0 && r.multiplier >= 20) this.#achieve('moon');
    if (has('towers-top')) this.#achieve('tower-top');
    if (has('fish-shark')) this.#achieve('fish-shark');
    if (has('fish-kraken')) this.#achieve('fish-kraken');
    if (has('cascade3')) this.#achieve('avalanche');
    if (has('freespins')) this.#achieve('golden-rain');
    if (has('straight')) this.#achieve('straight');
    if (has('vp-fourKind') || has('vp-straightFlush') || has('vp-royal')) this.#achieve('quads');
    if (has('natural')) this.#achieve('natural');
    if (has('side-win')) this.#achieve('side-hustle');
  }

  #narrateRound({ net, stake, bankroll, critical }) {
    const streak = this.#s.stats.streak;
    const amount = fmt(Math.abs(net));
    if (critical) {
      if (net > EPS) this.#log('critical-win', { amount }, 'win');
      else if (net < -EPS) this.#log('critical-loss', { amount }, 'loss');
      else this.#log('push', {}, 'info');
      return;
    }
    if (net > EPS && STREAK_MARKS.has(streak)) {
      this.#log('streak-win', { n: streak }, 'win');
      return;
    }
    if (net < -EPS && STREAK_MARKS.has(-streak)) {
      this.#log('streak-loss', { n: -streak }, 'loss');
      return;
    }
    if (net > EPS && net >= Math.max(stake * 5, bankroll * 0.25, 1)) this.#log('big-win', { amount }, 'win');
    else if (net < -EPS && -net >= Math.max(bankroll * 0.25, 1)) this.#log('big-loss', { amount }, 'loss');
    else if (Math.abs(net) <= EPS) {
      if (this.#rand(3) === 0) this.#log('push', {}, 'info');
    } else if (this.#rand(100) < 25) {
      this.#log(net > 0 ? 'win' : 'loss', { amount }, net > 0 ? 'win' : 'loss');
    }
  }

  // ---------- Encargos y logros ----------

  // Tablero de encargos del piso: siempre ACTIVE_CONTRACTS objetivos de tipos distintos.
  #ensureContracts(exclude = []) {
    const id = this.#s.floor;
    const entries = this.#s.contracts[id] ?? [];
    this.#s.contracts[id] = entries;
    while (entries.length < ACTIVE_CONTRACTS) {
      const contract = drawContract(this.floor, [...exclude, ...entries.map((c) => c.type)], this.#rand);
      entries.push(contract);
      this.#log('contract-new', { text: contract.text, reward: fmt(contract.reward) }, 'system');
    }
  }

  #progressContracts(round, streak) {
    const id = this.#s.floor;
    const entries = this.#s.contracts[id] ?? [];
    const done = [];
    for (const contract of entries) {
      const progress = Math.min(contract.goal, advanceContract(contract, round, streak));
      if (progress === contract.progress) continue;
      contract.progress = progress;
      if (progress >= contract.goal) done.push(contract);
      else this.#emit('contract', { contract: { ...contract }, done: false });
    }
    if (!done.length) return;
    for (const contract of done) {
      this.#s.stats.contractsDone += 1;
      this.#grant(contract.reward);
      this.#log('contract-done', { reward: fmt(contract.reward) }, 'system');
      this.#emit('contract', { contract: { ...contract }, done: true });
    }
    this.#s.contracts[id] = entries.filter((contract) => !done.includes(contract));
    this.#ensureContracts(done.map((contract) => contract.type));
  }

  #achieve(id) {
    if (Object.hasOwn(this.#s.achievements, id)) return false;
    const item = achievementById(id);
    if (!item) return false;
    this.#s.achievements[id] = this.#now();
    if (item.reward > 0) {
      this.#grant(item.reward);
      this.#log('achievement', { name: item.name, reward: fmt(item.reward) }, 'system');
    } else {
      this.#log('achievement-plain', { name: item.name }, 'system');
    }
    this.#emit('achievement', { achievement: item });
    return true;
  }

  #grant(amount, { reason = 'climb', stat = 'rewards' } = {}) {
    if (!(amount > 0)) return;
    this.#wallet.grant(amount, reason);
    this.#s.stats[stat] = round2(this.#s.stats[stat] + amount);
  }

  // ---------- Saldo: récord, títulos, tarjetas de acceso ----------

  // Revisa el saldo: récord, título, tarjetas de acceso y logros de saldo. Solo guarda si algo
  // cambió (el saldo cambia muchas veces por segundo con el disparo continuo de Cyber-Fish).
  #afterBalance({ schedule = true, dirty = true } = {}) {
    let changed = dirty;
    for (let pass = 0; pass < 4; pass++) {
      const balance = this.#wallet.balance;
      const st = this.#s.stats;
      if (balance > st.maxBalance) {
        st.maxBalance = balance;
        changed = true;
      }
      if (balance > this.#s.record) {
        this.#s.record = balance;
        changed = true;
      }
      if (this.#hall.bestBalance < this.#s.record) {
        this.#hall.bestBalance = this.#s.record;
        this.#saveHall();
      }
      const index = titleIndexFor(balance);
      if (index !== this.#s.title) {
        const up = index > this.#s.title;
        this.#s.title = index;
        changed = true;
        this.#log(up ? 'title-up' : 'title-down', { title: TITLES[index].name }, up ? 'win' : 'loss');
        this.#emit('title', { title: TITLES[index], up });
      }
      let rewarded = false;
      if (this.playable) {
        for (const item of FLOORS) {
          if (item.level > this.#s.unlocked && balance + EPS >= item.unlockAt) {
            this.#s.unlocked = item.level;
            changed = true;
            this.#log('unlock', {}, 'system', item.id);
            this.#emit('unlock', { floor: item });
            rewarded = this.#achieve(`card-${item.level}`) || rewarded;
          }
        }
        if (this.#s.rescued && balance + EPS >= COMEBACK_AT) {
          this.#s.rescued = false;
          changed = true;
          rewarded = this.#achieve('comeback') || rewarded;
        }
        if (balance + EPS >= SKYLINE_AT) rewarded = this.#achieve('skyline') || rewarded;
      }
      if (rewarded) changed = true;
      else break;
    }
    if (changed) this.#save();
    if (schedule) this.#scheduleCheck();
  }

  #scheduleCheck() {
    clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => this.checkEnd(), 60);
  }

  // Tras cualquier cambio de saldo (también los que no salen de una ronda: misiones, reliquias,
  // la rueda…): tarjetas de acceso y récord al momento; victoria y aviso de bancarrota solo con
  // las mesas en reposo.
  checkEnd() {
    if (!this.playable) return;
    this.#afterBalance({ schedule: false, dirty: false });
    if (this.#pending()) return;
    const balance = this.#wallet.balance;
    if (this.#s.status === 'playing' && balance + EPS >= GOAL) {
      this.#finish();
      return;
    }
    if (this.#broke()) {
      if (!this.#s.brokeNotice) {
        this.#s.brokeNotice = true;
        this.#log('broke', {}, 'system');
        this.#save();
        this.#emit('broke', this.rescueStatus());
      }
    } else if (this.#s.brokeNotice) {
      this.#s.brokeNotice = false;
      this.#save();
    }
  }

  #broke() {
    return this.playable && this.#wallet.balance + EPS < FLOORS[0].minBet && !this.#pending();
  }

  // Limosna: +10 créditos con el saldo a cero, como mucho una vez cada 5 minutos. Un reloj que
  // retrocede no alarga la espera más allá de esos 5 minutos.
  rescueStatus(now = this.#now()) {
    const broke = this.#broke();
    const last = this.#s.rescueAt;
    const readyAt = last ? Math.min(last, now) + RESCUE_COOLDOWN_MS : 0;
    const wait = Math.max(0, readyAt - now);
    return { broke, available: broke && wait <= 0, wait, readyAt, amount: RESCUE_AMOUNT, count: this.#s.stats.rescues };
  }

  takeRescue() {
    const status = this.rescueStatus();
    if (!status.available) return 0;
    this.#s.rescueAt = this.#now();
    this.#s.rescued = true;
    this.#s.brokeNotice = false;
    this.#s.stats.rescues += 1;
    this.#grant(RESCUE_AMOUNT, { reason: 'rescue', stat: 'rescueCredits' });
    this.#log('rescue', { amount: fmt(RESCUE_AMOUNT) }, 'system');
    this.#achieve('alms');
    this.#emit('rescue', { amount: RESCUE_AMOUNT, readyAt: this.#s.rescueAt + RESCUE_COOLDOWN_MS });
    this.#afterBalance();
    return RESCUE_AMOUNT;
  }

  #finish() {
    this.#s.status = 'victory';
    this.#s.ended = this.#now();
    this.#s.stats.maxBalance = Math.max(this.#s.stats.maxBalance, this.#wallet.balance);
    this.#achieve('owner');
    this.#hall.victories += 1;
    const ms = this.#s.ended - this.#s.started;
    if (!this.#hall.bestMs || ms < this.#hall.bestMs) this.#hall.bestMs = ms;
    this.#hall.bestBalance = Math.max(this.#hall.bestBalance, this.#s.stats.maxBalance);
    this.#saveHall();
    this.#log('victory', {}, 'story');
    this.#save();
    this.#emit('status', { status: 'victory' });
  }

  // Epílogo interactivo: el jugador se proclama Dueño Absoluto del Sindicato con su alias.
  claimThrone(name) {
    if (this.#s.status !== 'victory' || this.#s.owner) return null;
    const clean = cleanOwnerName(name) || 'Anónimo';
    const at = this.#now();
    this.#s.owner = { name: clean, at };
    const ms = (this.#s.ended ?? at) - this.#s.started;
    this.#hall.owners = [{ name: clean, at, ms, run: this.#s.run }, ...this.#hall.owners].slice(0, OWNERS_LIMIT);
    this.#saveHall();
    this.#log('owner', { name: clean }, 'story');
    this.#save();
    this.#emit('owner', { name: clean });
    return clean;
  }

  // Borra la escalada actual; al recargar la página empieza otra con 10 créditos.
  // La carrera (niveles, reliquias), las semillas y el salón de la fama se conservan.
  restart() {
    if (this.#pending()) return false;
    for (const key of [CLIMB_KEY, ...RUN_KEYS]) this.#store.remove(key);
    return true;
  }

  // ---------- Bitácora y persistencia ----------

  #log(kind, params = {}, tone = 'info', floorId = this.#s.floor) {
    const { text, speaker } = narrate(kind, floorId, params, this.#rand);
    if (!text) return;
    const entry = { id: ++this.#logSeq, t: this.#now(), floor: floorId, kind, tone, speaker, text };
    this.#s.log.push(entry);
    if (this.#s.log.length > LOG_LIMIT) this.#s.log.splice(0, this.#s.log.length - LOG_LIMIT);
    this.#emit('log', { entry });
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('update', { detail: { type } }));
  }

  #save() {
    this.#store.write(CLIMB_KEY, this.#s);
  }

  #loadHall() {
    const raw = this.#store.read(HALL_KEY, null) ?? {};
    const owners = Array.isArray(raw.owners)
      ? raw.owners
        .filter((o) => o && typeof o.name === 'string' && isNum(o.at) && isNum(o.ms))
        .slice(0, OWNERS_LIMIT)
        .map((o) => ({ name: cleanOwnerName(o.name) || 'Anónimo', at: o.at, ms: Math.max(0, o.ms), run: count(o.run) }))
      : [];
    return {
      runs: count(raw.runs),
      victories: count(raw.victories),
      bestMs: count(raw.bestMs),
      bestBalance: isNum(raw.bestBalance) && raw.bestBalance >= 0 ? raw.bestBalance : 0,
      owners,
    };
  }

  #saveHall() {
    this.#store.write(HALL_KEY, this.#hall);
  }
}

export const climb = new Climb();
