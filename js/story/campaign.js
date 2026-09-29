// La leyenda de «El Último Crédito»: máquina de estados de la campaña (intro → playing →
// victory | gameover), zona actual, títulos, logros, encargos, favores del Sindicato, ayudas
// del Club VIP (XP, bono diario, rescates y tapetes), estadísticas y la Bitácora del Crupier.
// Sin DOM: las mesas le informan de cada ronda y la interfaz escucha sus eventos.

import { storage as defaultStore } from '../engine/storage.js';
import { randomInt } from '../engine/rng.js';
import { wallet as defaultWallet } from '../engine/wallet.js';
import { vip as defaultVip, feltById } from '../engine/vip.js';
import { ZONES, zoneById, FREEDOM_GOAL, FAVORS_PER_LEGEND, CRITICAL_SHARE, CRITICAL_MIN_BETS, highestZoneFor } from './zones.js';
import { TITLES, titleIndexFor } from './titles.js';
import { ACHIEVEMENTS, achievementById } from './achievements.js';
import { drawContract, advanceContract, contractType, ACTIVE_CONTRACTS } from './contracts.js';
import { narrate } from './narrative.js';

export const STORY_KEY = 'crd.story.v1';
export const HALL_KEY = 'crd.story.hall.v1';
export const LEGEND_KEYS = Object.freeze(['crd.wallet.v2', 'crd.blackjack.v2', 'crd.roulette.v1', 'crd.slots.v2']);
const LEGACY_KEYS = Object.freeze(['crd.wallet.v1', 'crd.blackjack.v1', 'crd.slots.v1', 'crd.audio.v1']);
const STATUSES = Object.freeze(['intro', 'playing', 'victory', 'gameover']);
const LOG_LIMIT = 60;
const EPS = 1e-9;
const STREAK_MARKS = new Set([3, 5, 7, 10, 15, 20]);

const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const fmt = (value) => numberFormat.format(value);
const round2 = (value) => Math.round(value * 100) / 100;
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function freshStats(balance = 1) {
  return {
    rounds: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    wagered: 0,
    returned: 0,
    biggestWin: 0,
    maxBalance: balance,
    streak: 0,
    bestStreak: 0,
    worstStreak: 0,
    criticalWins: 0,
    criticalLosses: 0,
    favorsUsed: 0,
    contractsDone: 0,
    rewards: 0,
    vipCredits: 0,
    vipRescues: 0,
    dailyBonuses: 0,
  };
}

function freshState(legend, now, balance) {
  return {
    version: 1,
    legend,
    status: 'intro',
    started: now,
    ended: null,
    zone: 'alley',
    unlocked: ['alley'],
    peak: 0,
    favorsLeft: FAVORS_PER_LEGEND,
    achievements: {},
    contracts: {},
    title: titleIndexFor(balance),
    stats: freshStats(balance),
    brokeNotice: false,
    log: [],
  };
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !STATUSES.includes(raw.status)) return null;
  const zoneIds = ZONES.map((zone) => zone.id);
  const stats = freshStats(1);
  for (const key of Object.keys(stats)) if (isNum(raw.stats?.[key])) stats[key] = raw.stats[key];
  const contracts = {};
  for (const id of zoneIds) {
    const list = Array.isArray(raw.contracts?.[id]) ? raw.contracts[id] : [];
    contracts[id] = list
      .filter((c) => c && contractType(c.type) && isNum(c.goal) && isNum(c.progress) && isNum(c.reward) && typeof c.text === 'string')
      .slice(0, ACTIVE_CONTRACTS)
      .map((c) => ({ type: c.type, text: c.text, goal: c.goal, progress: c.progress, reward: c.reward }));
  }
  const achievements = {};
  for (const item of ACHIEVEMENTS) if (isNum(raw.achievements?.[item.id])) achievements[item.id] = raw.achievements[item.id];
  const log = Array.isArray(raw.log)
    ? raw.log.filter((e) => e && isNum(e.id) && isNum(e.t) && typeof e.text === 'string' && typeof e.speaker === 'string').slice(-LOG_LIMIT)
    : [];
  return {
    version: 1,
    legend: Number.isInteger(raw.legend) && raw.legend > 0 ? raw.legend : 1,
    status: raw.status,
    started: isNum(raw.started) ? raw.started : Date.now(),
    ended: isNum(raw.ended) ? raw.ended : null,
    zone: zoneIds.includes(raw.zone) ? raw.zone : 'alley',
    unlocked: [...new Set(['alley', ...(Array.isArray(raw.unlocked) ? raw.unlocked.filter((id) => zoneIds.includes(id)) : [])])],
    peak: Number.isInteger(raw.peak) ? Math.min(ZONES.length - 1, Math.max(0, raw.peak)) : 0,
    favorsLeft: Number.isInteger(raw.favorsLeft) ? Math.min(FAVORS_PER_LEGEND, Math.max(0, raw.favorsLeft)) : FAVORS_PER_LEGEND,
    achievements,
    contracts,
    title: Number.isInteger(raw.title) ? Math.min(TITLES.length - 1, Math.max(0, raw.title)) : 1,
    stats,
    brokeNotice: raw.brokeNotice === true,
    log,
  };
}

export class Campaign extends EventTarget {
  #wallet;
  #vip;
  #store;
  #rand;
  #now;
  #s;
  #hall;
  #games = new Map();
  #critical = null;
  #checkTimer = 0;
  #logSeq = 0;

  constructor({ wallet = defaultWallet, vip = defaultVip, store = defaultStore, rand = randomInt, now = () => Date.now() } = {}) {
    super();
    this.#wallet = wallet;
    this.#vip = vip;
    this.#store = store;
    this.#rand = rand;
    this.#now = now;
    this.#hall = this.#loadHall();
    const saved = sanitize(store.read(STORY_KEY, null));
    if (saved) {
      this.#s = saved;
    } else {
      // Nueva leyenda: se borran las partidas anteriores, también las de versiones previas.
      for (const key of [...LEGEND_KEYS, ...LEGACY_KEYS]) store.remove(key);
      wallet.reset?.();
      this.#hall.legends += 1;
      this.#saveHall();
      this.#s = freshState(this.#hall.legends, now(), wallet.balance);
      this.#save();
    }
    this.#logSeq = this.#s.log.reduce((max, entry) => Math.max(max, entry.id), 0);
    wallet.addEventListener?.('change', () => this.#scheduleCheck());
  }

  // ---------- Lectura ----------

  get status() {
    return this.#s.status;
  }

  get playable() {
    return this.#s.status === 'playing';
  }

  get state() {
    return structuredClone(this.#s);
  }

  get zone() {
    return zoneById(this.#s.zone);
  }

  get title() {
    return TITLES[this.#s.title];
  }

  get contracts() {
    return structuredClone(this.#s.contracts[this.#s.zone] ?? []);
  }

  get log() {
    return this.#s.log.slice();
  }

  get hall() {
    return { ...this.#hall };
  }

  get favorAmount() {
    return ZONES[this.#s.peak].favor;
  }

  limits(game) {
    const zone = this.zone;
    return { ...zone[game], minBet: zone.minBet, chips: zone.chips, zone: zone.id };
  }

  register(id, api) {
    this.#games.set(id, api);
  }

  #pending() {
    return this.#wallet.inPlay > EPS || [...this.#games.values()].some((game) => game.hasPendingPlay?.());
  }

  // ---------- Flujo de la leyenda ----------

  begin() {
    if (this.#s.status !== 'intro') return;
    this.#s.status = 'playing';
    this.#s.started = this.#now();
    this.#log('begin', {}, 'story');
    this.#log('arrive', {}, 'story');
    this.#ensureContracts();
    this.#save();
    this.#emit('status', { status: 'playing' });
  }

  travelStatus(id) {
    const target = zoneById(id);
    if (target.id === this.#s.zone) return { ok: false, reason: 'here' };
    if (!this.playable) return { ok: false, reason: 'status' };
    if (this.#pending()) return { ok: false, reason: 'pending' };
    if (this.#wallet.balance + EPS < target.entry) return { ok: false, reason: 'funds', need: target.entry };
    return { ok: true };
  }

  travel(id) {
    const status = this.travelStatus(id);
    if (status.ok) {
      this.#move(zoneById(id), false);
      this.#afterBalance();
    }
    return status;
  }

  #move(zone, forced) {
    const from = this.zone;
    this.#s.zone = zone.id;
    if (!this.#s.unlocked.includes(zone.id)) this.#s.unlocked.push(zone.id);
    this.#s.peak = Math.max(this.#s.peak, ZONES.indexOf(zone));
    this.#log(forced ? 'demoted' : 'arrive', { zone: zone.name }, 'story');
    if (zone.id === 'neon') this.#achieve('neon-lights');
    if (zone.id === 'penthouse') this.#achieve('thin-air');
    this.#ensureContracts();
    this.#save();
    this.#emit('zone', { zone, from, forced });
    for (const game of this.#games.values()) game.onZone?.(zone);
  }

  // Jugada crítica: arriesgar la mitad o más del bankroll con al menos 10 apuestas mínimas en
  // juego, o apostarlo todo. Así el drama no se repite en cada apuesta mínima con poco saldo.
  #isCritical(stake, bankroll) {
    if (!(stake > 0) || !(bankroll > 0)) return false;
    if (stake + EPS >= bankroll) return true;
    return stake + EPS >= CRITICAL_SHARE * bankroll && stake + EPS >= CRITICAL_MIN_BETS * this.zone.minBet;
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

  // Resultado de una ronda terminada (tras acreditar el premio). `tags` describe lo ocurrido.
  report({ game, stake = 0, returned = 0, tags = [], coach = null }) {
    if (this.#s.status !== 'playing') return;
    const st = this.#s.stats;
    const net = round2(returned - stake);
    const bankroll = this.#wallet.balance - net;
    const previousStreak = st.streak;

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
    st.bestStreak = Math.max(st.bestStreak, st.streak);
    st.worstStreak = Math.min(st.worstStreak, st.streak);

    const critical = this.#critical?.game === game || this.#isCritical(stake, bankroll);
    this.#critical = null;
    if (critical && net > EPS) st.criticalWins += 1;
    if (critical && net < -EPS) st.criticalLosses += 1;

    this.#narrateRound({ net, stake, bankroll, critical });

    // Club VIP: 1 XP por crédito apostado; el rango se conserva entre leyendas.
    const promotion = this.#vip.addXp(stake);
    if (promotion) {
      const { rank } = promotion;
      this.#log('vip-rankup', { rank: rank.name, daily: fmt(rank.daily), rescue: fmt(rank.rescue) }, 'win');
      this.#emit('rankup', promotion);
    }

    const has = (tag) => tags.includes(tag);
    if (net > EPS) {
      this.#achieve('first-win');
      if (stake > 0 && stake + EPS >= bankroll) this.#achieve('all-in');
      if (has('natural')) this.#achieve('natural');
      if (has('straight')) this.#achieve('straight');
      if (has('side-win')) this.#achieve('side-hustle');
      if (has('call-win')) this.#achieve('announced');
      if (critical) this.#achieve('all-or-nothing');
      if (previousStreak <= -5) this.#achieve('steel-nerves');
      if (st.streak >= 5) this.#achieve('hot-hand');
    }
    if (has('cascade3')) this.#achieve('avalanche');
    if (has('super')) this.#achieve('super-bonus');
    if (has('freespins')) this.#achieve('golden-rain');
    if (coach && coach.total >= 25 && coach.right / coach.total >= 0.9) this.#achieve('strategist');

    this.#progressContracts({ game, stake, returned, net, tags }, st.streak);
    this.#save();
    this.#emit('round', { game, stake, returned, net, critical, tags });
    this.#afterBalance();
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
    } else if (this.#rand(100) < 35) {
      this.#log(net > 0 ? 'win' : 'loss', { amount }, net > 0 ? 'win' : 'loss');
    }
  }

  // ---------- Encargos y logros ----------

  // Tablero de encargos de la zona: siempre ACTIVE_CONTRACTS objetivos de tipos distintos.
  #ensureContracts(exclude = []) {
    const id = this.#s.zone;
    const list = this.#s.contracts[id] ?? [];
    this.#s.contracts[id] = list;
    while (list.length < ACTIVE_CONTRACTS) {
      const contract = drawContract(this.zone, [...exclude, ...list.map((c) => c.type)], this.#rand);
      list.push(contract);
      this.#log('contract-new', { text: contract.text, reward: fmt(contract.reward) }, 'system');
    }
  }

  #progressContracts(round, streak) {
    const id = this.#s.zone;
    const list = this.#s.contracts[id] ?? [];
    const done = [];
    for (const contract of list) {
      const progress = Math.min(contract.goal, advanceContract(contract, round, streak));
      if (progress === contract.progress) continue;
      contract.progress = progress;
      if (progress >= contract.goal) done.push(contract);
      else this.#emit('contract', { contract, done: false });
    }
    if (!done.length) return;
    for (const contract of done) {
      this.#s.stats.contractsDone += 1;
      this.#grant(contract.reward);
      this.#log('contract-done', { reward: fmt(contract.reward) }, 'system');
      this.#emit('contract', { contract, done: true });
    }
    this.#s.contracts[id] = list.filter((contract) => !done.includes(contract));
    this.#ensureContracts(done.map((contract) => contract.type));
  }

  #achieve(id) {
    if (Object.hasOwn(this.#s.achievements, id)) return false;
    const def = achievementById(id);
    if (!def) return false;
    this.#s.achievements[id] = this.#now();
    if (def.reward > 0) {
      this.#grant(def.reward);
      this.#log('achievement', { name: def.name, reward: fmt(def.reward) }, 'system');
    }
    this.#emit('achievement', { achievement: def });
    return true;
  }

  #grant(amount, { reason = 'story', stat = 'rewards' } = {}) {
    if (!(amount > 0)) return;
    this.#wallet.grant(amount, reason);
    this.#s.stats[stat] = round2(this.#s.stats[stat] + amount);
  }

  // ---------- Saldo: títulos, desbloqueos y final ----------

  #afterBalance() {
    for (let pass = 0; pass < 3; pass++) {
      const balance = this.#wallet.balance;
      const st = this.#s.stats;
      st.maxBalance = Math.max(st.maxBalance, balance);
      const index = titleIndexFor(balance);
      if (index !== this.#s.title) {
        const up = index > this.#s.title;
        this.#s.title = index;
        this.#log(up ? 'title-up' : 'title-down', { title: TITLES[index].name }, up ? 'win' : 'loss');
        this.#emit('title', { title: TITLES[index], up });
      }
      for (const zone of ZONES) {
        if (zone.entry > 0 && balance + EPS >= zone.entry && !this.#s.unlocked.includes(zone.id)) {
          this.#s.unlocked.push(zone.id);
          this.#log('unlock', { zone: zone.name }, 'system', zone.id);
          this.#emit('unlock', { zone });
        }
      }
      const rewarded = balance + EPS >= 25000 && this.#achieve('shark');
      if (!rewarded) break;
    }
    this.#save();
    this.#scheduleCheck();
  }

  #scheduleCheck() {
    clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => this.checkEnd(), 60);
  }

  // Victoria, degradación de zona, bancarrota con favores y game over. Solo con las mesas en reposo.
  checkEnd() {
    if (this.#s.status !== 'playing' || this.#pending()) return;
    const balance = this.#wallet.balance;
    if (balance + EPS >= FREEDOM_GOAL) {
      this.#finish('victory');
      return;
    }
    const zone = this.zone;
    if (zone.stay > 0 && balance + EPS < zone.stay) this.#move(ZONES[highestZoneFor(balance, 'entry')], true);
    if (balance + EPS < ZONES[0].minBet) {
      const life = this.lifelines();
      if (life.any) {
        if (!this.#s.brokeNotice) {
          this.#s.brokeNotice = true;
          this.#log('broke', { options: this.#lifelineText(life) }, 'system');
          this.#save();
          this.#emit('broke', life);
        }
      } else {
        this.#finish('gameover');
      }
    }
  }

  #broke() {
    return this.playable && this.#wallet.balance + EPS < ZONES[0].minBet && !this.#pending();
  }

  favorStatus() {
    const broke = this.#broke();
    return { available: broke && this.#s.favorsLeft > 0, broke, amount: this.favorAmount, left: this.#s.favorsLeft };
  }

  // Salvavidas de la leyenda: el bono diario del Club VIP (cuando quieras, una vez al día), los
  // rescates VIP (de 1 a 5 por leyenda según el rango) y los favores del Sindicato (3 por
  // leyenda). Rescates y favores solo con el saldo a cero. Sin ninguno disponible, Game Over.
  lifelines() {
    const broke = this.#broke();
    const daily = this.#vip.dailyStatus(this.#now());
    const rescue = this.#vip.rescueStatus(this.#s.legend);
    const favors = this.#s.favorsLeft;
    return {
      broke,
      daily: { available: this.playable && daily.available, amount: daily.amount, nextAt: daily.nextAt },
      rescue: { available: broke && rescue.left > 0, left: rescue.left, total: rescue.total, amount: rescue.amount, rank: this.#vip.rank.name },
      favor: { available: broke && favors > 0, left: favors, amount: this.favorAmount },
      any: daily.available || rescue.left > 0 || favors > 0,
    };
  }

  #lifelineText(life) {
    const parts = [];
    if (life.daily.available) parts.push(`el bono diario del Club VIP (+${fmt(life.daily.amount)})`);
    if (life.rescue.left > 0) parts.push(`${life.rescue.left === 1 ? 'un rescate VIP' : `${life.rescue.left} rescates VIP`} (+${fmt(life.rescue.amount)})`);
    if (life.favor.left > 0) parts.push(`${life.favor.left === 1 ? 'un favor' : `${life.favor.left} favores`} del Sindicato (+${fmt(life.favor.amount)})`);
    return parts.join(', ');
  }

  claimDaily() {
    if (!this.playable) return 0;
    const amount = this.#vip.claimDaily(this.#now());
    if (!(amount > 0)) return 0;
    this.#s.brokeNotice = false;
    this.#s.stats.dailyBonuses += 1;
    this.#grant(amount, { reason: 'daily', stat: 'vipCredits' });
    this.#log('vip-daily', { amount: fmt(amount) }, 'system');
    this.#emit('vip', { kind: 'daily', amount });
    this.#afterBalance();
    return amount;
  }

  takeRescue() {
    const life = this.lifelines();
    if (!life.rescue.available) return 0;
    const amount = this.#vip.useRescue(this.#s.legend);
    if (!(amount > 0)) return 0;
    const left = life.rescue.left - 1;
    this.#s.brokeNotice = false;
    this.#s.stats.vipRescues += 1;
    this.#grant(amount, { reason: 'rescue', stat: 'vipCredits' });
    this.#log('vip-rescue', { amount: fmt(amount), rank: life.rescue.rank, n: left }, 'system');
    this.#emit('vip', { kind: 'rescue', amount, left });
    this.#afterBalance();
    return amount;
  }

  // Tapetes de lujo: se pagan con créditos de la leyenda y quedan en el Club para siempre.
  buyFelt(id) {
    const felt = feltById(id);
    if (!felt) return { ok: false, reason: 'unknown' };
    if (this.#vip.owns(id)) {
      this.#vip.equipFelt(id);
      this.#emit('felt', { felt, bought: false });
      return { ok: true, bought: false };
    }
    if (!this.playable) return { ok: false, reason: 'status' };
    if (this.#pending()) return { ok: false, reason: 'pending' };
    if (!this.#wallet.spend(felt.price, 'felt')) return { ok: false, reason: 'funds', need: felt.price };
    this.#vip.addFelt(id);
    this.#vip.equipFelt(id);
    this.#log('felt', { name: felt.name, price: fmt(felt.price) }, 'info');
    this.#emit('felt', { felt, bought: true });
    this.#afterBalance();
    return { ok: true, bought: true };
  }

  takeFavor() {
    const status = this.favorStatus();
    if (!status.available) return 0;
    this.#s.favorsLeft -= 1;
    this.#s.stats.favorsUsed += 1;
    this.#s.brokeNotice = false;
    this.#grant(status.amount);
    this.#log('favor', { amount: fmt(status.amount), n: this.#s.favorsLeft }, 'system');
    this.#emit('favor', { amount: status.amount, left: this.#s.favorsLeft });
    this.#afterBalance();
    return status.amount;
  }

  #finish(result) {
    this.#s.status = result;
    this.#s.ended = this.#now();
    this.#s.stats.maxBalance = Math.max(this.#s.stats.maxBalance, this.#wallet.balance);
    if (result === 'victory') {
      this.#achieve('destiny');
      this.#hall.victories += 1;
      const ms = this.#s.ended - this.#s.started;
      if (!this.#hall.bestMs || ms < this.#hall.bestMs) this.#hall.bestMs = ms;
    }
    this.#hall.bestBalance = Math.max(this.#hall.bestBalance, this.#s.stats.maxBalance);
    this.#saveHall();
    this.#log(result, {}, 'story');
    this.#save();
    this.#emit('status', { status: result });
  }

  // Borra la leyenda actual; al recargar la página empieza una nueva con 1 crédito.
  restart() {
    for (const key of [STORY_KEY, ...LEGEND_KEYS]) this.#store.remove(key);
  }

  // ---------- Bitácora y persistencia ----------

  #log(kind, params = {}, tone = 'info', zoneId = this.#s.zone) {
    const { text, speaker } = narrate(kind, zoneId, params, this.#rand);
    if (!text) return;
    const entry = { id: ++this.#logSeq, t: this.#now(), zone: this.#s.zone, kind, tone, speaker, text };
    this.#s.log.push(entry);
    if (this.#s.log.length > LOG_LIMIT) this.#s.log.splice(0, this.#s.log.length - LOG_LIMIT);
    this.#emit('log', { entry });
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('update', { detail: { type } }));
  }

  #save() {
    this.#store.write(STORY_KEY, this.#s);
  }

  #loadHall() {
    const raw = this.#store.read(HALL_KEY, null) ?? {};
    const int = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
    return { legends: int(raw.legends), victories: int(raw.victories), bestMs: int(raw.bestMs), bestBalance: isNum(raw.bestBalance) ? raw.bestBalance : 0 };
  }

  #saveHall() {
    this.#store.write(HALL_KEY, this.#hall);
  }
}

export const campaign = new Campaign();
