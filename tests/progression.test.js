// Progresión global: XP por ronda, curva de niveles 1–50, 6 rangos VIP, recompensas y las 10
// misiones diarias acumulativas.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Progression, PROGRESS_KEY, MAX_LEVEL, LEVEL_XP, VIP_RANKS, MISSIONS, MISSION_BONUS,
  xpToNext, levelFor, rankFor, roundXp, levelReward, localDay,
} from '../js/progression.js';
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
const round = (game, stake, returned, extra = {}) => ({ game, stake, returned, tags: [], mode: 'free', ...extra });

test('XP por ronda = apuesta × 0,25 + premio × 0,5 (× 2 con el Pase del Padrino)', () => {
  assert.equal(roundXp({ stake: 100, returned: 0 }), 25);
  assert.equal(roundXp({ stake: 100, returned: 200 }), 125);
  assert.equal(roundXp({ stake: 100, returned: 200 }, 2), 250);
  assert.equal(roundXp({ stake: -5, returned: -1 }), 0, 'nunca resta XP');
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

test('Misiones: 10 diarias, acumulativas, pagan fichas + XP y se renuevan a medianoche', () => {
  assert.equal(MISSIONS.length, 10);
  const store = memoryStore();
  let now = DAY;
  const p = new Progression({ store, now: () => now });
  const done = [];
  p.addEventListener('mission', (event) => done.push(event.detail.mission.id));
  for (let i = 0; i < 5; i++) p.addRound(round('blackjack', 100, 200));
  assert.ok(done.includes('blackjack'), 'ganar 5 manos de blackjack');
  const bj = p.missions().find((m) => m.id === 'blackjack');
  assert.equal(bj.progress, 5);
  assert.equal(bj.done, true);
  // Las rondas del Modo Historia dan XP pero no cuentan para las misiones del Cripto-Casino.
  const before = p.missions().find((m) => m.id === 'rounds').progress;
  p.addRound({ ...round('roulette', 10, 0), mode: 'story' });
  assert.equal(p.missions().find((m) => m.id === 'rounds').progress, before);
  // Casillas seguras de Minas y Torres, premio ×10 y retiro de Crash a ×2.
  p.addRound(round('mines', 50, 100, { safe: 7 }));
  p.addRound(round('towers', 50, 100, { safe: 5 }));
  assert.ok(done.includes('safe'));
  p.addRound(round('crash', 10, 20));
  p.addRound(round('dice', 10, 150));
  assert.ok(done.includes('big'));
  // Al día siguiente todo vuelve a empezar.
  now += 24 * 3600 * 1000;
  assert.equal(p.missions().every((m) => m.progress === 0 && !m.done), true);
  assert.equal(p.missionsDone, 0);
  assert.notEqual(localDay(now), localDay(DAY));
});

test('Completar las 10 misiones da el bonus (cofre común y fichas) una sola vez', () => {
  const p = new Progression({ store: memoryStore(), now: () => DAY });
  const rewards = [];
  p.addEventListener('reward', (event) => rewards.push(event.detail));
  const tags = ['cascade2'];
  for (let i = 0; i < 40; i++) {
    p.addRound(round('blackjack', 125, 250));
    p.addRound(round('roulette', 10, 20));
    p.addRound(round('slots', 10, 20, { tags }));
    p.addRound(round('plinko', 10, 20));
    p.addRound(round('crash', 10, 25));
    p.addRound(round('mines', 10, 20, { safe: 1 }));
  }
  p.addRound(round('dice', 10, 200));
  assert.equal(p.missionsDone, 10);
  const bonus = rewards.filter((r) => r.chest === MISSION_BONUS.chest && r.chips === MISSION_BONUS.chips);
  assert.equal(bonus.length, 1);
  p.addRound(round('dice', 10, 200));
  assert.equal(rewards.filter((r) => r.chips === MISSION_BONUS.chips && r.chest === MISSION_BONUS.chest).length, 1);
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
