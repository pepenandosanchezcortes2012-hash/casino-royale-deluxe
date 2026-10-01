// Carrera: XP por ronda en la escala del piso, curva de niveles 1–50, 6 rangos VIP, recompensas
// escaladas y las 10 misiones diarias que dependen del piso desbloqueado.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Progression, PROGRESS_KEY, MAX_LEVEL, LEVEL_XP, VIP_RANKS, MISSIONS, MISSION_BONUS, DAILY_MISSIONS,
  xpToNext, levelFor, rankFor, roundXp, levelReward, localDay, dailyMissions, missionById,
} from '../js/progression.js';
import { FLOORS } from '../js/climb/floors.js';
import { EventBus } from '../js/event_bus.js';

function memoryStore() {
  const map = new Map();
  return {
    map,
    read: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    write: (key, value) => map.set(key, JSON.stringify(value)),
    remove: (key) => map.delete(key),
  };
}

const DAY = new Date(2026, 8, 30, 12, 0, 0).getTime();
const round = (game, stake, returned, extra = {}) => ({ game, stake, returned, tags: [], mode: 'climb', ...extra });

test('XP por ronda = (apuesta × 0,25 + premio × 0,5) ÷ escala del piso (× 2 con el Pase)', () => {
  assert.equal(roundXp({ stake: 100, returned: 0 }), 25);
  assert.equal(roundXp({ stake: 100, returned: 200 }), 125);
  assert.equal(roundXp({ stake: 100, returned: 200 }, 2), 250);
  assert.equal(roundXp({ stake: -5, returned: -1 }), 0, 'nunca resta XP');
  // La misma apuesta relativa da la misma XP en todos los pisos.
  assert.equal(roundXp({ stake: 10, returned: 0 }, 1, 0.1), 25);
  assert.equal(roundXp({ stake: 10_000, returned: 0 }, 1, 100), 25);
});

test('Curva de 50 niveles creciente y 6 rangos VIP por nivel', () => {
  assert.equal(LEVEL_XP[1], 0);
  assert.equal(LEVEL_XP[2], xpToNext(1));
  for (let level = 2; level < MAX_LEVEL; level++) assert.ok(xpToNext(level) > xpToNext(level - 1));
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(LEVEL_XP[10] - 1), 9);
  assert.equal(levelFor(LEVEL_XP[10]), 10);
  assert.equal(levelFor(Number.MAX_SAFE_INTEGER), MAX_LEVEL);
  assert.deepEqual(VIP_RANKS.map((rank) => rank.name), ['Bronce', 'Plata', 'Oro', 'Platino', 'Diamante', 'El Padrino']);
  assert.equal(rankFor(9).id, 'bronze');
  assert.equal(rankFor(10).id, 'silver');
  assert.equal(rankFor(49).id, 'diamond');
  assert.equal(rankFor(50).id, 'godfather');
  // Un jugador constante (rondas de 100 fichas) necesita cientos de rondas para Plata.
  const perRound = roundXp({ stake: 100, returned: 97 });
  assert.ok(LEVEL_XP[10] / perRound > 150 && LEVEL_XP[10] / perRound < 250);
});

test('Recompensas de nivel: fichas, cofre común cada 5 niveles y legendario en cada rango', () => {
  assert.deepEqual(levelReward(2), { chips: 200, chest: null });
  assert.deepEqual(levelReward(5), { chips: 500, chest: 'common' });
  assert.deepEqual(levelReward(10), { chips: 1000, chest: 'legendary' });
  assert.deepEqual(levelReward(50), { chips: 5000, chest: 'legendary' });
  const store = memoryStore();
  const p = new Progression({ store, now: () => DAY });
  const events = [];
  p.addEventListener('levelup', (event) => events.push(event.detail.level));
  p.addEventListener('rankup', (event) => events.push(event.detail.rank.id));
  p.addXp(LEVEL_XP[10]);
  assert.equal(p.level, 10);
  assert.deepEqual(events, [2, 3, 4, 5, 6, 7, 8, 9, 10, 'silver']);
  const expected = [2, 3, 4, 5, 6, 7, 8, 9, 10].reduce((sum, level) => sum + level * 100, 0);
  assert.equal(p.pendingChips, expected);
  assert.equal(p.collectChips(), expected);
  assert.equal(p.collectChips(), 0, 'se cobran una sola vez');
  // Persistencia.
  const again = new Progression({ store, now: () => DAY });
  assert.equal(again.level, 10);
  assert.ok(store.map.has(PROGRESS_KEY));
});

test('Misiones del día según el piso desbloqueado: 4 generales y 6 de sus mesas', () => {
  const f1 = dailyMissions(FLOORS[0].games);
  assert.equal(f1.length, DAILY_MISSIONS);
  assert.deepEqual(f1.slice(0, 4), ['rounds', 'wager', 'wins', 'big']);
  assert.ok(f1.every((id) => !missionById(id).games || missionById(id).games.some((g) => FLOORS[0].games.includes(g))), 'solo mesas del Subsuelo');
  const f2 = dailyMissions(FLOORS[1].games);
  assert.deepEqual(f2.slice(4, 7), ['fish', 'plinko', 'avalanche'], 'primero las mesas del piso recién abierto');
  const f4 = dailyMissions(FLOORS[3].games);
  assert.deepEqual(f4.slice(4, 6), ['blackjack', 'wheel']);
  assert.equal(new Set(f4).size, DAILY_MISSIONS);
  assert.ok(MISSIONS.length > DAILY_MISSIONS);
});

test('Misiones: apuesta mínima del piso, importes en su escala, recompensas escaladas y renovación', () => {
  const store = memoryStore();
  let now = DAY;
  const floor = { scale: 0.1, minBet: 1, games: FLOORS[0].games };
  const p = new Progression({ store, now: () => now, scale: () => floor.scale, minStake: () => floor.minBet, games: () => floor.games });
  const done = [];
  p.addEventListener('mission', (event) => done.push(event.detail.mission));
  const list = p.missions();
  assert.deepEqual(list.map((m) => m.id), dailyMissions(FLOORS[0].games));
  assert.equal(list.find((m) => m.id === 'dice').chips, 30, '300 créditos × escala 0,1');
  assert.match(list.find((m) => m.id === 'wager').text, /Apuesta 500 créditos/);
  for (let i = 0; i < 10; i++) p.addRound(round('dice', 5, 9.8, { chance: 50 }));
  const dice = done.find((m) => m.id === 'dice');
  assert.ok(dice, 'ganar 10 tiradas de dados');
  assert.equal(dice.chips, 30);
  // El importe apostado se mide en la escala del piso: 10 × 5 créditos = 500 unidades.
  assert.equal(p.missions().find((m) => m.id === 'wager').progress, 500);
  // Con la tarjeta del Piso 2 la escala sube y las rondas por debajo de 50 ya no cuentan.
  Object.assign(floor, { scale: 1, minBet: 50, games: FLOORS[1].games });
  const before = p.missions().find((m) => m.id === 'rounds').progress;
  p.addRound(round('dice', 10, 0, { chance: 50 }));
  assert.equal(p.missions().find((m) => m.id === 'rounds').progress, before, 'apuesta por debajo de la mínima del piso');
  p.addRound(round('mines', 50, 100, { safe: 7 }));
  p.addRound(round('towers', 50, 100, { safe: 5 }));
  const safe = done.find((m) => m.id === 'safe');
  assert.ok(safe);
  assert.equal(safe.chips, 300, 'recompensa en la escala del piso desbloqueado');
  assert.equal(p.missions().map((m) => m.id).join(), dailyMissions(FLOORS[0].games).join(), 'el tablero del día no cambia');
  // Al día siguiente: misiones nuevas con las mesas de la Bahía.
  now += 24 * 3600 * 1000;
  assert.deepEqual(p.missions().map((m) => m.id), dailyMissions(FLOORS[1].games));
  assert.equal(p.missions().every((m) => m.progress === 0 && !m.done), true);
  assert.equal(p.missionsDone, 0);
  assert.notEqual(localDay(now), localDay(DAY));
  // La rueda (sin apuesta) cuenta para su misión.
  Object.assign(floor, { scale: 100, minBet: 10_000, games: FLOORS[3].games });
  now += 24 * 3600 * 1000;
  p.addRound(round('wheel', 0, 20_000, { tags: ['wheel'] }));
  assert.equal(p.missions().find((m) => m.id === 'wheel').done, true);
});

test('Completar las 10 misiones da el bonus (cofre común y créditos de tu piso) una sola vez', () => {
  const p = new Progression({ store: memoryStore(), now: () => DAY, scale: () => 1, minStake: () => 50, games: () => FLOORS[0].games });
  const rewards = [];
  p.addEventListener('reward', (event) => rewards.push(event.detail));
  for (let i = 0; i < 50; i++) p.addRound(round('dice', 100, 400, { chance: 24 }));
  p.addRound(round('dice', 100, 1000, { chance: 9 }));
  for (let i = 0; i < 3; i++) {
    p.addRound(round('mines', 100, 300, { safe: 4 }));
    p.addRound(round('towers', 100, 250, { safe: 5 }));
  }
  assert.equal(p.missionsDone, 10);
  assert.equal(p.missionsTotal, 10);
  const isBonus = (r) => r.chest === MISSION_BONUS.chest && r.chips === MISSION_BONUS.chips;
  assert.equal(rewards.filter(isBonus).length, 1);
  p.addRound(round('dice', 100, 400, { chance: 24 }));
  assert.equal(rewards.filter(isBonus).length, 1);
  assert.deepEqual(p.missionBonus, { chest: 'common', chips: 1000 });
});

test('Bus: cada round:end suma XP con el multiplicador y los cofres salen por reward:chest', () => {
  const bus = new EventBus();
  const p = new Progression({ store: memoryStore(), now: () => DAY });
  const chests = [];
  bus.on('reward:chest', (detail) => chests.push(detail.tier));
  const off = p.attach(bus, { xpMultiplier: () => 2 });
  bus.emit('round:end', round('slots', 100, 0));
  assert.equal(p.xp, 50);
  p.addXp(LEVEL_XP[5]);
  assert.ok(chests.includes('common'));
  off();
  bus.emit('round:end', round('slots', 100, 0));
  assert.equal(p.xp, 50 + LEVEL_XP[5], 'desconectado ya no suma');
});
