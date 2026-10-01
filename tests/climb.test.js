// Pruebas de «The Syndicate Climb» con un monedero simulado y almacenamiento en memoria.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Climb, CLIMB_KEY, HALL_KEY, RUN_KEYS, cleanOwnerName } from '../js/climb/climb.js';
import {
  FLOORS, GOAL, START_BALANCE, RESCUE_AMOUNT, RESCUE_COOLDOWN_MS, GAME_ORDER,
  floorById, gameFloor, limitsFor, rangeText, goalProgress, floorForBalance, maxStake,
} from '../js/climb/floors.js';
import { TITLES, titleFor } from '../js/climb/titles.js';
import { ACHIEVEMENTS } from '../js/climb/achievements.js';
import { CONTRACT_TYPES, ACTIVE_CONTRACTS, contractPool, drawContract, advanceContract } from '../js/climb/contracts.js';
import { narrate, NARRATIVE_KINDS, PROLOGUE, EPILOGUE, HOSTS } from '../js/climb/narrative.js';

function memoryStore() {
  const map = new Map();
  return {
    map,
    read: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    write: (key, value) => map.set(key, JSON.stringify(value)),
    remove: (key) => map.delete(key),
  };
}

function fakeWallet(balance = START_BALANCE) {
  return {
    balance,
    inPlay: 0,
    grant(amount) {
      this.balance += amount;
      return amount;
    },
    reset() {
      this.balance = START_BALANCE;
    },
  };
}

// Escalada ya comenzada; `rand` fijo hace deterministas los encargos y `clock.t` se puede adelantar.
function climbing({ balance = START_BALANCE, rand = () => 0, store = memoryStore(), clock = { t: Date.UTC(2026, 8, 30, 12) } } = {}) {
  const wallet = fakeWallet(balance);
  const now = () => clock.t;
  const climb = new Climb({ wallet, store, rand, now });
  wallet.balance = balance;
  climb.begin();
  return { climb, wallet, store, clock };
}

// Simula una ronda: aplica el resultado al monedero y la reporta.
function play(ctx, { game = 'dice', stake, returned, tags = [], ...extra }) {
  ctx.wallet.balance += returned - stake;
  ctx.climb.report({ game, stake, returned, tags, ...extra });
}

test('Pisos: rangos de apuesta, mesas acumuladas y límites por mesa', () => {
  assert.equal(FLOORS.length, 4);
  assert.deepEqual(FLOORS.map((f) => f.unlockAt), [0, 10_000, 100_000, 1_000_000]);
  assert.deepEqual(FLOORS.map((f) => [f.minBet, f.maxBet]), [[1, 50], [50, 1000], [1000, 25_000], [10_000, Infinity]]);
  assert.deepEqual(FLOORS[0].games, ['mines', 'dice', 'towers']);
  assert.deepEqual(FLOORS[1].unlocks, ['fish', 'plinko', 'slots']);
  assert.deepEqual(FLOORS[2].unlocks, ['crash', 'roulette', 'video_poker']);
  assert.deepEqual(FLOORS[3].unlocks, ['blackjack', 'wheel']);
  assert.equal(FLOORS[3].games.length, 11, 'el Olimpo libera las 11 mesas');
  assert.deepEqual([...GAME_ORDER].sort(), [...FLOORS[3].games].sort());
  assert.equal(gameFloor('fish').level, 2);
  assert.equal(gameFloor('blackjack').level, 4);
  // Cada lista de importes respeta el rango de su piso.
  for (const f of FLOORS) {
    for (const [game, values] of Object.entries(f.lists)) {
      assert.ok(values.every((v) => v >= f.minBet && v <= f.maxBet), `${f.id}/${game}`);
    }
    assert.ok(f.chips.every((v) => v >= f.minBet && v <= f.maxBet), `${f.id}/fichas`);
  }
  // Video póker: monedas × 5 dentro del rango del Salón.
  assert.ok(FLOORS[2].lists.video_poker.every((v) => v * 5 <= FLOORS[2].maxBet));
  const bj = limitsFor('olympus', 'blackjack');
  assert.equal(bj.maxMain, Infinity);
  assert.equal(bj.minBet, 10_000);
  assert.equal(limitsFor('salon', 'roulette').tableMax, 25_000);
  assert.deepEqual(limitsFor('bahia', 'fish').bullets, [50, 100, 250, 500, 1000]);
  assert.equal(rangeText(FLOORS[1]), 'de 50 a 1000');
  assert.equal(rangeText(FLOORS[3]), 'desde 10000, sin límite');
  assert.equal(maxStake(FLOORS[3], 123_456.7), 123_456);
  assert.equal(maxStake(FLOORS[0], 500), 50);
  assert.equal(floorForBalance(99_999).level, 2);
  assert.equal(floorById('nada').id, 'subsuelo');
});

test('Progreso hacia los 10M: un cuarto de barra por piso y avance logarítmico', () => {
  assert.equal(goalProgress(START_BALANCE), 0);
  assert.equal(goalProgress(10_000), 0.25);
  assert.equal(goalProgress(100_000), 0.5);
  assert.equal(goalProgress(1_000_000), 0.75);
  assert.equal(goalProgress(GOAL), 1);
  assert.ok(Math.abs(goalProgress(316_228) - 0.625) < 1e-4, 'mitad logarítmica del Salón');
  let last = 0;
  for (let b = 10; b <= GOAL; b *= 1.37) {
    const p = goalProgress(b);
    assert.ok(p >= last);
    last = p;
  }
});

test('Títulos dinámicos según el saldo', () => {
  assert.equal(titleFor(0).name, 'Alma en Pena');
  assert.equal(titleFor(10).name, 'Rata del Subsuelo');
  assert.equal(titleFor(10_000_000).name, 'Dueño Absoluto del Sindicato');
  assert.ok(TITLES.every((t, i) => i === 0 || t.min > TITLES[i - 1].min));
});

test('Encargos: tablero por piso sin mesas de pisos superiores y recompensa por factor', () => {
  for (const f of FLOORS) {
    const pool = contractPool(f);
    assert.ok(pool.every((c) => !c.game || f.games.includes(c.game)), f.id);
    const seen = [];
    for (let i = 0; i < ACTIVE_CONTRACTS; i++) {
      const c = drawContract(f, seen.map((x) => x.type), (n) => n - 1);
      assert.ok(!seen.some((x) => x.type === c.type), 'sin repetidos');
      const def = CONTRACT_TYPES.find((d) => d.type === c.type);
      assert.equal(c.reward, def.base * f.contractFactor);
      seen.push(c);
    }
  }
  assert.ok(!contractPool(FLOORS[0]).some((c) => c.game === 'fish'));
  // Solo cuentan los premios de ×2 o más.
  const wins = { type: 'wins', goal: 3, progress: 0 };
  assert.equal(advanceContract(wins, { game: 'dice', stake: 10, returned: 19.9, net: 9.9, tags: [] }, 0), 0);
  assert.equal(advanceContract(wins, { game: 'dice', stake: 10, returned: 20, net: 10, tags: [] }, 0), 1);
  assert.equal(advanceContract({ type: 'streak', goal: 3, progress: 1 }, { game: 'dice', stake: 1, returned: 2, net: 1, tags: [] }, 2), 2);
  assert.equal(advanceContract({ type: 'fish-big', goal: 3, progress: 1 }, { game: 'fish', stake: 500, returned: 900, net: 400, bigCatches: 2, tags: [] }, 0), 3);
  assert.equal(advanceContract({ type: 'dice-sniper', goal: 1, progress: 0 }, { game: 'dice', stake: 5, returned: 49, net: 44, chance: 10, tags: [] }, 0), 1);
  assert.equal(advanceContract({ type: 'tower-top', goal: 1, progress: 0 }, { game: 'towers', stake: 5, returned: 120, net: 115, tags: ['towers-top'] }, 0), 1);
});

test('Narrativa: todas las voces existen y sustituyen los marcadores', () => {
  for (const kind of NARRATIVE_KINDS) {
    for (const f of FLOORS) {
      const { text, speaker } = narrate(kind, f.id, { amount: '12', share: '50', n: 3, title: 'X', name: 'Y', reward: '9', text: 'Z', floor: 'P' }, () => 0);
      assert.ok(text.length > 0, `${kind}/${f.id}`);
      assert.ok(!/\{\w+\}/.test(text), `${kind}/${f.id}: ${text}`);
      assert.ok(speaker.length > 0);
    }
  }
  assert.equal(narrate('win', 'salon', { amount: '5' }, () => 0).speaker, HOSTS.salon);
  assert.equal(HOSTS.salon, 'Ferro');
  assert.ok(PROLOGUE.some((line) => line.includes('10 créditos')));
  assert.ok(PROLOGUE.some((line) => line.includes('10.000.000')));
  assert.ok(EPILOGUE.length >= 4);
});

test('Escalada nueva: prólogo → partida con 10 créditos en el Subsuelo y 3 encargos', () => {
  const store = memoryStore();
  store.write(RUN_KEYS[0], { balance: 999 });
  const wallet = fakeWallet(999);
  const climb = new Climb({ wallet, store, rand: () => 0, now: () => 5 });
  assert.equal(wallet.balance, START_BALANCE, 'la escalada nueva reinicia el monedero');
  assert.equal(store.map.has(RUN_KEYS[0]), false);
  assert.equal(climb.status, 'intro');
  assert.equal(climb.playable, false);
  climb.begin();
  assert.equal(climb.status, 'playing');
  assert.equal(climb.floor.id, 'subsuelo');
  assert.equal(climb.contracts.length, ACTIVE_CONTRACTS);
  assert.ok(climb.contracts.every((c) => !CONTRACT_TYPES.find((d) => d.type === c.type).game || FLOORS[0].games.includes(CONTRACT_TYPES.find((d) => d.type === c.type).game)));
  assert.deepEqual([climb.limits('dice').minBet, climb.limits('dice').maxBet], [1, 50]);
  assert.equal(climb.available('dice'), true);
  assert.equal(climb.available('fish'), false);
  assert.equal(climb.hall.runs, 1);
  assert.equal(climb.nextFloor.id, 'bahia');
});

test('Tarjeta de acceso a los 10.000: desbloqueo permanente, ascensor y vuelta atrás', () => {
  const ctx = climbing({ balance: 9_000 });
  const unlocked = [];
  ctx.climb.addEventListener('unlock', (e) => unlocked.push(e.detail.floor.id));
  play(ctx, { stake: 50, returned: 1050, chance: 4 });
  assert.deepEqual(unlocked, ['bahia']);
  assert.equal(ctx.climb.unlockedLevel, 2);
  assert.ok(ctx.climb.state.achievements['card-2']);
  assert.ok(ctx.climb.state.stats.rewards >= 1000, 'el logro paga 1.000');
  assert.equal(ctx.wallet.balance, 10_000 + ctx.climb.state.stats.rewards);
  assert.deepEqual(ctx.climb.travelStatus('salon'), { ok: false, reason: 'locked', need: 100_000 });
  ctx.wallet.inPlay = 25;
  assert.equal(ctx.climb.travel('bahia').reason, 'pending', 'no se viaja con fichas en la mesa');
  ctx.wallet.inPlay = 0;
  assert.equal(ctx.climb.travel('bahia').ok, true);
  assert.equal(ctx.climb.floor.level, 2);
  assert.equal(ctx.climb.available('fish'), true);
  assert.deepEqual([ctx.climb.limits('mines').minBet, ctx.climb.limits('mines').maxBet], [50, 1000]);
  // Perder el saldo no quita la tarjeta: se puede volver al Subsuelo y subir de nuevo.
  ctx.wallet.balance = 20;
  ctx.climb.checkEnd();
  assert.equal(ctx.climb.unlockedLevel, 2);
  assert.equal(ctx.climb.travel('subsuelo').ok, true);
  assert.equal(ctx.climb.travel('bahia').ok, true);
});

test('Los ingresos fuera de las rondas también abren pisos', () => {
  const ctx = climbing({ balance: 10 });
  ctx.wallet.grant(150_000);
  ctx.climb.checkEnd();
  assert.equal(ctx.climb.unlockedLevel, 3, 'una recompensa grande desbloquea dos tarjetas a la vez');
  assert.ok(ctx.climb.state.achievements['card-2'] && ctx.climb.state.achievements['card-3']);
  assert.equal(ctx.climb.record, ctx.wallet.balance);
});

test('Limosna: +10 con el saldo a cero y una vez cada 5 minutos', () => {
  const ctx = climbing({ balance: 3 });
  assert.equal(ctx.climb.rescueStatus().available, false, 'con saldo no hay limosna');
  play(ctx, { stake: 3, returned: 0 });
  let broke = 0;
  ctx.climb.addEventListener('broke', () => broke++);
  ctx.climb.checkEnd();
  assert.equal(broke, 1);
  const status = ctx.climb.rescueStatus();
  assert.equal(status.available, true);
  assert.equal(status.amount, RESCUE_AMOUNT);
  assert.equal(ctx.climb.takeRescue(), 10);
  assert.equal(ctx.wallet.balance, 10);
  assert.ok(ctx.climb.state.achievements.alms);
  play(ctx, { stake: 10, returned: 0 });
  ctx.climb.checkEnd();
  const wait = ctx.climb.rescueStatus();
  assert.equal(wait.broke, true);
  assert.equal(wait.available, false);
  assert.equal(wait.wait, RESCUE_COOLDOWN_MS);
  assert.equal(ctx.climb.takeRescue(), 0);
  // Un reloj que retrocede no alarga la espera.
  ctx.clock.t -= 60 * 60 * 1000;
  assert.ok(ctx.climb.rescueStatus().wait <= RESCUE_COOLDOWN_MS);
  ctx.clock.t += 60 * 60 * 1000 + RESCUE_COOLDOWN_MS;
  assert.equal(ctx.climb.rescueStatus().available, true);
  assert.equal(ctx.climb.takeRescue(), 10);
  assert.equal(ctx.climb.state.stats.rescues, 2);
  // Con fichas en juego no hay limosna aunque el saldo sea cero.
  ctx.wallet.balance = 0;
  ctx.wallet.inPlay = 5;
  ctx.clock.t += RESCUE_COOLDOWN_MS;
  assert.equal(ctx.climb.rescueStatus().available, false);
});

test('Resurrección: volver a 1.000 créditos tras pedir limosna', () => {
  const ctx = climbing({ balance: 0 });
  ctx.climb.checkEnd();
  ctx.climb.takeRescue();
  play(ctx, { stake: 10, returned: 990, chance: 1 });
  assert.ok(ctx.climb.state.achievements.comeback);
});

test('Encargos cumplidos pagan y se reponen con otro tipo', () => {
  const ctx = climbing({ balance: 100 });
  const before = ctx.climb.contracts;
  const target = before[0];
  const done = [];
  ctx.climb.addEventListener('contract', (e) => e.detail.done && done.push(e.detail.contract.type));
  let guard = 0;
  while (!done.includes(target.type) && guard++ < 50) {
    if (target.type === 'tower-top') play(ctx, { game: 'towers', stake: 1, returned: 25, tags: ['towers-top'], safe: 8 });
    else if (target.type === 'dice-sniper') play(ctx, { game: 'dice', stake: 1, returned: 9.8, chance: 10 });
    else if (target.type === 'mines-deep') play(ctx, { game: 'mines', stake: 1, returned: 6, safe: 6 });
    else play(ctx, { game: 'dice', stake: 1, returned: 30, chance: 3 });
  }
  assert.ok(done.includes(target.type));
  const after = ctx.climb.contracts;
  assert.equal(after.length, ACTIVE_CONTRACTS);
  assert.equal(new Set(after.map((c) => c.type)).size, ACTIVE_CONTRACTS);
  assert.ok(ctx.climb.state.stats.contractsDone >= 1);
  assert.ok(ctx.climb.state.stats.rewards >= target.reward);
});

test('Jugada crítica: la mitad del saldo con 10 apuestas mínimas, o todo', () => {
  const ctx = climbing({ balance: 100 });
  ctx.wallet.balance -= 60;
  assert.equal(ctx.climb.beginRound({ game: 'dice', stake: 60 }), true);
  const small = climbing({ balance: 8 });
  small.wallet.balance -= 5;
  assert.equal(small.climb.beginRound({ game: 'dice', stake: 5 }), false, 'con poco saldo solo el todo o nada');
  small.wallet.balance -= 3;
  assert.equal(small.climb.beginRound({ game: 'dice', stake: 3 }), true);
});

test('Logros por mesa: dados, minas, torre, Cyber-Fish, crash, video póker y blackjack', () => {
  const ctx = climbing({ balance: 100 });
  play(ctx, { game: 'dice', stake: 1, returned: 49, chance: 2 });
  play(ctx, { game: 'mines', stake: 1, returned: 12 });
  play(ctx, { game: 'towers', stake: 1, returned: 25, tags: ['towers-top'] });
  play(ctx, { game: 'fish', stake: 100, returned: 3000, tags: ['fish-shark', 'fish-capture'], captures: 1, bigCatches: 1 });
  play(ctx, { game: 'fish', stake: 100, returned: 20_000, tags: ['fish-kraken', 'fish-capture'], captures: 1, bigCatches: 1 });
  play(ctx, { game: 'crash', stake: 10, returned: 250 });
  play(ctx, { game: 'video_poker', stake: 10, returned: 250, tags: ['vp-fourKind'] });
  play(ctx, { game: 'blackjack', stake: 10, returned: 25, tags: ['natural', 'side-win'] });
  const got = ctx.climb.state.achievements;
  for (const id of ['first-win', 'sniper', 'deminer', 'tower-top', 'fish-shark', 'fish-kraken', 'moon', 'quads', 'natural', 'side-hustle']) assert.ok(got[id], id);
  assert.ok(ACHIEVEMENTS.every((a) => typeof a.reward === 'number' && a.reward >= 0));
});

test('Victoria a los 10.000.000: epílogo, trono con alias y se puede seguir jugando', () => {
  const ctx = climbing({ balance: 9_990_000 });
  ctx.climb.travel('olympus');
  play(ctx, { game: 'dice', stake: 10_000, returned: 20_000, chance: 49 });
  ctx.climb.checkEnd();
  assert.equal(ctx.climb.status, 'victory');
  assert.equal(ctx.climb.playable, true, 'tras la victoria las mesas siguen abiertas');
  assert.ok(ctx.climb.state.achievements.owner);
  assert.equal(ctx.climb.hall.victories, 1);
  assert.equal(ctx.climb.claimThrone('  <Neo>\u0007 del   Sindicato  '), 'Neo del Sindicato');
  assert.equal(ctx.climb.claimThrone('Otro'), null, 'el trono se reclama una vez');
  assert.equal(ctx.climb.hall.owners[0].name, 'Neo del Sindicato');
  assert.equal(cleanOwnerName('x'.repeat(40)).length, 24);
  play(ctx, { game: 'dice', stake: 10_000, returned: 0, chance: 49 });
  assert.equal(ctx.climb.status, 'victory');
});

test('Persistencia: la escalada se reanuda y reiniciar empieza otra', () => {
  const store = memoryStore();
  const clock = { t: Date.UTC(2026, 8, 30, 12) };
  const ctx = climbing({ balance: 12_000, store, clock });
  ctx.climb.checkEnd();
  ctx.climb.travel('bahia');
  ctx.wallet.balance = 0;
  ctx.climb.checkEnd();
  ctx.climb.takeRescue();
  const saved = ctx.climb.state;
  const again = new Climb({ wallet: ctx.wallet, store, rand: () => 0, now: () => clock.t });
  assert.equal(again.status, 'playing');
  assert.equal(again.floor.id, 'bahia');
  assert.equal(again.unlockedLevel, 2);
  assert.equal(again.record, saved.record);
  assert.equal(again.state.rescueAt, saved.rescueAt);
  assert.equal(again.rescueStatus().available, false, 'el enfriamiento sobrevive a la recarga');
  assert.ok(store.map.has(CLIMB_KEY));
  assert.ok(store.map.has(HALL_KEY));
  assert.equal(again.restart(), true);
  assert.equal(store.map.has(CLIMB_KEY), false);
  const fresh = new Climb({ wallet: ctx.wallet, store, rand: () => 0, now: () => clock.t });
  assert.equal(fresh.status, 'intro');
  assert.equal(fresh.hall.runs, 2);
  assert.equal(fresh.unlockedLevel, 1);
  assert.equal(ctx.wallet.balance, START_BALANCE);
});
