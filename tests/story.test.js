// Pruebas de la campaña «El Último Crédito» con un monedero simulado y almacenamiento en memoria.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Campaign } from '../js/story/campaign.js';
import { VipClub, RANKS, FELTS, localDayKey } from '../js/engine/vip.js';
import { ZONES, zoneById, highestZoneFor, FREEDOM_GOAL } from '../js/story/zones.js';
import { TITLES, titleFor } from '../js/story/titles.js';
import { ACHIEVEMENTS } from '../js/story/achievements.js';
import { CONTRACT_TYPES, ACTIVE_CONTRACTS, drawContract, advanceContract } from '../js/story/contracts.js';
import { narrate, NARRATIVE_KINDS, PROLOGUE } from '../js/story/narrative.js';

function memoryStore() {
  const map = new Map();
  return {
    read: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    write: (key, value) => map.set(key, JSON.stringify(value)),
    remove: (key) => map.delete(key),
  };
}

function fakeWallet(balance = 1) {
  return {
    balance,
    inPlay: 0,
    grant(amount) {
      this.balance += amount;
      return amount;
    },
    canAfford(amount) {
      return amount <= this.balance;
    },
    spend(amount) {
      if (amount > this.balance) return false;
      this.balance -= amount;
      return true;
    },
    reset() {
      this.balance = 1;
    },
  };
}

// Crea una leyenda ya comenzada; `rand` fijo hace deterministas los encargos. El Club VIP
// comparte el almacenamiento y el reloj de la prueba (`clock.t` se puede adelantar).
function legend({ balance = 1, rand = () => 0, store = memoryStore(), clock = { t: Date.UTC(2026, 8, 28, 12) } } = {}) {
  const wallet = fakeWallet(balance);
  const now = () => (clock.t += 1000);
  const vip = new VipClub({ store, now });
  const campaign = new Campaign({ wallet, vip, store, rand, now });
  // Una leyenda nueva reinicia el monedero a 1 crédito; el saldo de la prueba se fija después.
  wallet.balance = balance;
  campaign.begin();
  return { campaign, wallet, store, vip, clock };
}

// Simula una ronda: aplica el resultado al monedero y la reporta.
function play(ctx, { game = 'roulette', stake, returned, tags = [] }) {
  ctx.wallet.balance += returned - stake;
  ctx.campaign.report({ game, stake, returned, tags });
  ctx.campaign.checkEnd();
}

test('Zonas: límites, umbrales de entrada y permanencia', () => {
  assert.deepEqual(ZONES.map((z) => z.id), ['alley', 'neon', 'penthouse']);
  const alley = zoneById('alley');
  assert.equal(alley.minBet, 1);
  assert.equal(alley.blackjack.maxMain, 10);
  assert.equal(alley.roulette.spotMax, 10);
  assert.equal(Math.max(...alley.slots.bets), 10);
  assert.equal(alley.blackjack.seats, 1);
  assert.equal(alley.roulette.racetrack, false);
  assert.equal(zoneById('neon').blackjack.seats, 3);
  assert.equal(zoneById('penthouse').entry, 5000);
  for (const zone of ZONES) assert.ok(zone.stay <= zone.entry);
  assert.equal(highestZoneFor(249), 0);
  assert.equal(highestZoneFor(250), 1);
  assert.equal(highestZoneFor(5000), 2);
  assert.equal(FREEDOM_GOAL, 100000);
});

test('Títulos dinámicos según el saldo', () => {
  assert.equal(titleFor(0).name, 'Alma en Pena');
  assert.equal(titleFor(1).name, 'Rata del Callejón');
  assert.equal(titleFor(5000).name, 'High-Roller');
  assert.equal(titleFor(100000).name, 'Dueño del Destino');
  for (let i = 1; i < TITLES.length; i++) assert.ok(TITLES[i].min > TITLES[i - 1].min);
});

test('Encargos: tablero sin repetidos, filtro por zona y recompensa por factor', () => {
  const alley = zoneById('alley');
  const types = new Set();
  for (let i = 0; i < 200; i++) {
    const c = drawContract(alley, ['wins'], (n) => i % n);
    assert.notEqual(c.type, 'wins');
    assert.ok(!['side', 'call'].includes(c.type), 'las apuestas laterales y el racetrack no existen en el Callejón');
    types.add(c.type);
  }
  assert.ok(types.size >= 10);
  const neon = zoneById('neon');
  const def = CONTRACT_TYPES.find((t) => t.type === 'wins');
  assert.equal(drawContract(neon, CONTRACT_TYPES.filter((t) => t.type !== 'wins').map((t) => t.type), () => 0).reward, def.base * neon.contractFactor);
  const contract = { type: 'outside', goal: 2, progress: 0 };
  assert.equal(advanceContract(contract, { game: 'roulette', stake: 1, returned: 2, net: 1, tags: ['outside'] }, 1), 1);
  assert.equal(advanceContract(contract, { game: 'roulette', stake: 1, returned: 0, net: -1, tags: [] }, -1), 0);
  assert.equal(advanceContract({ type: 'big-win', goal: 1, progress: 0 }, { game: 'roulette', stake: 1, returned: 36, net: 35, tags: [] }, 1), 1);
  assert.equal(advanceContract({ type: 'streak', goal: 3, progress: 1 }, { game: 'slots', stake: 1, returned: 3, net: 2, tags: [] }, 3), 3);
});

test('Narrativa: todas las voces existen y sustituyen los marcadores', () => {
  assert.ok(PROLOGUE.length >= 5);
  for (const kind of NARRATIVE_KINDS) {
    for (const zone of ['alley', 'neon', 'penthouse']) {
      const params = { amount: '12', n: 3, title: 'X', name: 'Y', reward: '5', text: 'Z', zone: 'W', share: 60, options: 'O', rank: 'Oro', daily: '500', rescue: '1.000', price: '1.000' };
      const { text, speaker } = narrate(kind, zone, params, () => 0);
      assert.ok(text.length > 0, `${kind}/${zone}`);
      assert.ok(!/\{\w+\}/.test(text), `marcador sin sustituir en ${kind}`);
      assert.ok(speaker.length > 0);
    }
  }
  assert.equal(narrate('win', 'penthouse', { amount: '5' }, () => 0).speaker, 'SIBILA');
  assert.equal(narrate('vip-rescue', 'alley', {}, () => 0).speaker, 'Club VIP');
});

test('Leyenda nueva: intro → partida, 1 crédito, 3 favores y tablero de encargos', () => {
  const wallet = fakeWallet(1);
  const store = memoryStore();
  const campaign = new Campaign({ wallet, vip: new VipClub({ store, now: () => 5 }), store, rand: () => 0, now: () => 5 });
  assert.equal(campaign.status, 'intro');
  assert.equal(campaign.playable, false);
  campaign.begin();
  assert.equal(campaign.status, 'playing');
  assert.equal(campaign.zone.id, 'alley');
  assert.equal(campaign.state.favorsLeft, 3);
  assert.equal(campaign.contracts.length, ACTIVE_CONTRACTS);
  assert.equal(new Set(campaign.contracts.map((c) => c.type)).size, ACTIVE_CONTRACTS);
  assert.ok(campaign.log.some((entry) => entry.kind === 'contract-new'));
});

test('Primera victoria y all-in: logros pagados una sola vez', () => {
  const ctx = legend();
  play(ctx, { stake: 1, returned: 2 });
  const first = ACHIEVEMENTS.find((a) => a.id === 'first-win').reward;
  const allIn = ACHIEVEMENTS.find((a) => a.id === 'all-in').reward;
  const after = ctx.wallet.balance;
  assert.ok(after >= 2 + first + allIn, `saldo ${after}`);
  const achievements = ctx.campaign.state.achievements;
  assert.ok('first-win' in achievements && 'all-in' in achievements);
  play(ctx, { stake: 1, returned: 2 });
  const firstWinLogs = ctx.campaign.log.filter((entry) => entry.kind === 'achievement' && entry.text.includes('Primer Crédito'));
  assert.equal(firstWinLogs.length, 1, 'los logros no se repiten');
});

test('Jugada crítica: se detecta al arriesgar la mitad del saldo', () => {
  const ctx = legend({ balance: 100 });
  let critical = null;
  ctx.campaign.addEventListener('critical', (event) => {
    critical = event.detail;
  });
  ctx.wallet.balance -= 40;
  assert.equal(ctx.campaign.beginRound({ game: 'roulette', stake: 40 }), false);
  ctx.wallet.balance += 40;
  ctx.wallet.balance -= 60;
  assert.equal(ctx.campaign.beginRound({ game: 'roulette', stake: 60 }), true);
  assert.ok(critical && critical.share >= 0.5);
  ctx.wallet.balance += 60;
  ctx.wallet.balance += 60;
  ctx.campaign.report({ game: 'roulette', stake: 60, returned: 120, tags: [] });
  assert.equal(ctx.campaign.state.stats.criticalWins, 1);
  assert.ok('all-or-nothing' in ctx.campaign.state.achievements);
});

test('Jugada crítica con poco saldo: solo el todo o nada', () => {
  const ctx = legend({ balance: 8 });
  // 5 de 8 créditos es más de la mitad, pero son menos de 10 apuestas mínimas: sin drama.
  ctx.wallet.balance -= 5;
  assert.equal(ctx.campaign.beginRound({ game: 'slots', stake: 5 }), false);
  ctx.wallet.balance += 5;
  // Apostarlo todo sí es crítico, aunque sea un único crédito.
  ctx.wallet.balance -= 8;
  assert.equal(ctx.campaign.beginRound({ game: 'slots', stake: 8 }), true);
});

test('Encargos cumplidos pagan y se reponen con otro tipo', () => {
  const ctx = legend({ balance: 50 });
  const before = ctx.campaign.contracts;
  const target = before.find((c) => c.type !== 'streak' && c.type !== 'big-win') ?? before[0];
  const tagFor = { outside: 'outside', dozen: 'dozen', straight: 'straight', natural: 'natural', double: 'double-win', split: 'split-win', cascade: 'cascade2', 'free-spins': 'freespins' };
  const game = target.type === 'bj-wins' ? 'blackjack' : target.type === 'slot-wins' ? 'slots' : 'roulette';
  const done0 = ctx.campaign.state.stats.contractsDone;
  for (let i = 0; i < target.goal; i++) {
    play(ctx, { game, stake: 1, returned: 11, tags: tagFor[target.type] ? [tagFor[target.type]] : [] });
  }
  const state = ctx.campaign.state;
  assert.ok(state.stats.contractsDone > done0, 'el encargo se completa');
  assert.equal(ctx.campaign.contracts.length, ACTIVE_CONTRACTS);
  assert.ok(state.stats.rewards >= target.reward);
});

test('Bancarrota: favores, rescate VIP y bono diario antes del Game Over', () => {
  const ctx = legend();
  const bust = () => play(ctx, { stake: ctx.wallet.balance, returned: 0 });
  bust();
  let life = ctx.campaign.lifelines();
  assert.equal(life.broke, true);
  assert.equal(life.favor.available, true);
  assert.equal(life.favor.amount, zoneById('alley').favor);
  assert.equal(life.rescue.available, true);
  assert.equal(life.rescue.amount, RANKS[0].rescue);
  assert.equal(life.daily.available, true);
  assert.ok(ctx.campaign.log.some((entry) => entry.kind === 'broke' && entry.text.includes('rescate VIP')));

  for (let i = 0; i < 3; i++) {
    assert.equal(ctx.campaign.takeFavor(), zoneById('alley').favor);
    bust();
    assert.equal(ctx.campaign.status, 'playing', 'quedan el rescate VIP y el bono diario');
  }
  assert.equal(ctx.campaign.favorStatus().left, 0);

  assert.equal(ctx.campaign.takeRescue(), RANKS[0].rescue);
  assert.equal(ctx.campaign.takeRescue(), 0, 'el rescate no se acumula con saldo');
  bust();
  assert.equal(ctx.campaign.status, 'playing', 'queda el bono diario');
  assert.equal(ctx.campaign.takeRescue(), 0, 'Bronce: un rescate por leyenda');

  assert.equal(ctx.campaign.claimDaily(), RANKS[0].daily);
  bust();
  life = ctx.campaign.lifelines();
  assert.equal(life.any, false);
  assert.equal(ctx.campaign.status, 'gameover');
  assert.equal(ctx.campaign.playable, false);
  const stats = ctx.campaign.state.stats;
  assert.equal(stats.vipRescues, 1);
  assert.equal(stats.dailyBonuses, 1);
  assert.equal(stats.vipCredits, RANKS[0].rescue + RANKS[0].daily);
});

test('Club VIP: 1 XP por crédito apostado y rangos que sobreviven a la leyenda', () => {
  const store = memoryStore();
  const ctx = legend({ balance: 20000, store });
  let promotion = null;
  ctx.campaign.addEventListener('rankup', (event) => {
    promotion = event.detail;
  });
  play(ctx, { stake: 4000, returned: 4000 });
  assert.equal(ctx.vip.xp, 4000);
  assert.equal(ctx.vip.rank.id, 'bronze');
  play(ctx, { stake: 1000, returned: 0 });
  assert.equal(ctx.vip.rank.id, 'silver');
  assert.equal(promotion?.rank.id, 'silver');
  assert.ok(ctx.campaign.log.some((entry) => entry.kind === 'vip-rankup' && entry.speaker === 'Club VIP'));
  // Reiniciar la leyenda no borra la carrera VIP.
  ctx.campaign.restart();
  const next = legend({ store });
  assert.equal(next.campaign.state.legend, 2);
  assert.equal(next.vip.xp, 5000);
  assert.equal(next.vip.rank.id, 'silver');
  assert.equal(next.campaign.lifelines().rescue.total, RANKS[1].rescues);
});

test('Club VIP: bono diario una vez por día natural', () => {
  const clock = { t: new Date(2026, 8, 28, 10, 0).getTime() };
  const ctx = legend({ clock });
  assert.equal(ctx.campaign.claimDaily(), RANKS[0].daily);
  assert.equal(ctx.wallet.balance, 1 + RANKS[0].daily);
  assert.equal(ctx.campaign.claimDaily(), 0, 'solo uno al día');
  const status = ctx.vip.dailyStatus();
  assert.equal(status.available, false);
  assert.equal(localDayKey(new Date(status.nextAt)), '2026-09-29');
  clock.t = new Date(2026, 8, 29, 0, 5).getTime();
  assert.equal(ctx.campaign.claimDaily(), RANKS[0].daily, 'al día siguiente vuelve');
});

test('Tapetes de lujo: se pagan con créditos y se conservan entre leyendas', () => {
  const store = memoryStore();
  const ctx = legend({ balance: 1200, store });
  const sapphire = FELTS.find((felt) => felt.id === 'sapphire');
  assert.equal(ctx.campaign.buyFelt('crimson').reason, 'funds');
  const result = ctx.campaign.buyFelt('sapphire');
  assert.equal(result.ok, true);
  assert.equal(ctx.wallet.balance, 1200 - sapphire.price);
  assert.equal(ctx.vip.felt, 'sapphire');
  assert.ok(ctx.campaign.log.some((entry) => entry.kind === 'felt'));
  assert.equal(ctx.campaign.buyFelt('zone').ok, true, 'el tapete de la zona es gratis');
  assert.equal(ctx.vip.felt, 'zone');
  ctx.campaign.restart();
  const next = legend({ store });
  assert.ok(next.vip.owns('sapphire'));
  assert.equal(next.campaign.buyFelt('sapphire').bought, false, 'ya es tuyo: solo se equipa');
  assert.equal(next.wallet.balance, 1);
});

test('Ascenso, degradación con histéresis y logros de zona', () => {
  const ctx = legend({ balance: 300 });
  ctx.campaign.checkEnd();
  assert.equal(ctx.campaign.travelStatus('penthouse').reason, 'funds');
  const status = ctx.campaign.travel('neon');
  assert.equal(status.ok, true);
  assert.equal(ctx.campaign.zone.id, 'neon');
  assert.ok('neon-lights' in ctx.campaign.state.achievements);
  const balance = ctx.wallet.balance;
  assert.ok(balance >= 400, 'Luces de Neón paga 100');
  // Por encima de la permanencia (100) se sigue en el Salón aunque no llegue a la entrada (250).
  play(ctx, { stake: balance - 150, returned: 0 });
  assert.equal(ctx.campaign.zone.id, 'neon');
  // Por debajo de 100 los gorilas te devuelven al Callejón.
  play(ctx, { stake: ctx.wallet.balance - 60, returned: 0 });
  assert.equal(ctx.campaign.zone.id, 'alley');
  assert.ok(ctx.campaign.log.some((entry) => entry.kind === 'demoted'));
});

test('Gran final: 100.000 créditos dan la libertad', () => {
  const ctx = legend({ balance: 90000 });
  let finished = null;
  ctx.campaign.addEventListener('status', (event) => {
    finished = event.detail.status;
  });
  play(ctx, { stake: 10000, returned: 20000 });
  assert.equal(ctx.campaign.status, 'victory');
  assert.equal(finished, 'victory');
  assert.ok('destiny' in ctx.campaign.state.achievements);
  assert.equal(ctx.campaign.hall.victories, 1);
  // Terminada la leyenda, las rondas ya no cuentan.
  const rounds = ctx.campaign.state.stats.rounds;
  ctx.campaign.report({ game: 'roulette', stake: 1, returned: 0 });
  assert.equal(ctx.campaign.state.stats.rounds, rounds);
});

test('Persistencia: la leyenda se reanuda y reiniciar crea una nueva', () => {
  const wallet = fakeWallet(1);
  const store = memoryStore();
  const vip = new VipClub({ store, now: () => 10 });
  const first = new Campaign({ wallet, vip, store, rand: () => 0, now: () => 10 });
  first.begin();
  wallet.balance += 1;
  first.report({ game: 'roulette', stake: 1, returned: 2 });
  const resumed = new Campaign({ wallet, vip, store, rand: () => 0, now: () => 20 });
  assert.equal(resumed.status, 'playing');
  assert.equal(resumed.state.stats.rounds, 1);
  resumed.restart();
  const fresh = new Campaign({ wallet, vip, store, rand: () => 0, now: () => 30 });
  assert.equal(fresh.status, 'intro');
  assert.equal(fresh.state.legend, 2);
});
