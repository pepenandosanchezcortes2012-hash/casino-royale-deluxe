// Matemáticas de los juegos del Cripto-Casino: RTP exacto, límites de las reglas y
// frecuencias medidas con el flujo verificable real.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { FairStream } from '../js/provably_fair.js';
import { playDice, diceMultiplier, diceRtp, MIN_CHANCE, MAX_CHANCE } from '../js/games/dice-math.js';
import { minesMultiplier, minesSurvival, placeMines, combinations } from '../js/games/mines-math.js';
import { towersMultiplier, towerLayout, safeChance, DIFFICULTIES, TOWER_LEVELS } from '../js/games/towers-math.js';
import { crashPoint, multiplierAt, secondsFor, cashoutWins } from '../js/games/crash-math.js';
import { RISKS, plinkoPath, plinkoRtp, bucketDistribution } from '../js/games/plinko-math.js';
import { evaluateHand, payPerCoin, newDeck, dealHand, drawCards, PAY_BY_ID } from '../js/games/video_poker-math.js';
import { WHEEL_SLICES, WHEEL_TOTAL_WEIGHT, spinWheel, wheelCooldown, WHEEL_COOLDOWN_MS } from '../js/games/wheel-math.js';

const stream = (nonce = 0) => new FairStream({ serverSeed: 'c'.repeat(64), clientSeed: 'pruebas', nonce });
const fixed = (...floats) => ({ float: () => floats.shift() });

test('Dados: RTP del 98 % en todo el rango y umbrales exactos', () => {
  for (let chance = MIN_CHANCE; chance <= MAX_CHANCE; chance++) {
    const rtp = diceRtp(chance);
    assert.ok(rtp <= 0.98 + 1e-12 && rtp > 0.9799, `P=${chance}: ${rtp}`);
    assert.ok(diceMultiplier(chance) > 1, 'nunca paga menos de lo apostado');
  }
  // «Menor que 50»: gana 0,00–49,99; «Mayor o igual que 50»: gana 50,00–99,99.
  assert.equal(playDice(fixed(0.4999), { chance: 50, direction: 'under' }).win, true);
  assert.equal(playDice(fixed(0.5), { chance: 50, direction: 'under' }).win, false);
  assert.equal(playDice(fixed(0.4999), { chance: 50, direction: 'over' }).win, false);
  assert.equal(playDice(fixed(0.5), { chance: 50, direction: 'over' }).win, true);
  assert.equal(playDice(fixed(0.99999), { chance: 1, direction: 'over' }).roll, 99.99);
  const s = stream();
  let wins = 0;
  for (let i = 0; i < 100_000; i++) if (playDice(s, { chance: 25, direction: 'over' }).win) wins++;
  assert.ok(Math.abs(wins / 100_000 - 0.25) < 0.006);
});

test('Minas: multiplicador = 0,97 / supervivencia, RTP del 97 % en cualquier retiro', () => {
  assert.equal(combinations(25, 3), 2300);
  assert.equal(minesMultiplier(3, 1), 1.1);
  assert.equal(minesMultiplier(24, 1), 24.25);
  for (let m = 1; m <= 24; m++) {
    for (let k = 1; k <= 25 - m; k++) {
      const rtp = minesMultiplier(m, k) * minesSurvival(m, k);
      assert.ok(rtp <= 0.97 + 1e-9 && rtp > 0.9, `m=${m} k=${k}: ${rtp}`);
    }
  }
  const mines = placeMines(stream(), 5);
  assert.equal(new Set(mines).size, 5);
  assert.ok(mines.every((cell) => cell >= 0 && cell < 25));
  // Frecuencia empírica de sobrevivir a 3 gemas con 5 minas.
  const s = stream(1);
  let survived = 0;
  for (let i = 0; i < 20_000; i++) {
    const layout = new Set(placeMines(s, 5));
    if (![0, 1, 2].some((cell) => layout.has(cell))) survived++;
  }
  assert.ok(Math.abs(survived / 20_000 - minesSurvival(5, 3)) < 0.012);
});

test('Torres: 8 pisos, trampas correctas y RTP del 97 % en cualquier piso', () => {
  for (const d of Object.values(DIFFICULTIES)) {
    const layout = towerLayout(stream(), d.id);
    assert.equal(layout.length, TOWER_LEVELS);
    assert.ok(layout.every((traps) => traps.length === d.traps && traps.every((t) => t >= 0 && t < d.tiles)));
    for (let level = 1; level <= TOWER_LEVELS; level++) {
      const rtp = towersMultiplier(d.id, level) * safeChance(d.id) ** level;
      assert.ok(rtp <= 0.97 + 1e-9 && rtp > 0.95, `${d.id} ${level}: ${rtp}`);
    }
  }
  assert.equal(towersMultiplier('medium', 1), 1.94);
  assert.equal(towersMultiplier('hard', 8), 6364.17);
});

test('Crash: 3,96 % de choques en 1,00x y RTP del 97 % para cualquier retiro', () => {
  assert.equal(crashPoint(0), 1);
  assert.equal(crashPoint(0.5), 1.94);
  assert.equal(crashPoint(0.0396), 1, 'justo por debajo del umbral: choque en 1,00x');
  assert.equal(crashPoint(0.0397), 1.01);
  assert.equal(cashoutWins(1.01, 1), false, 'con choque en 1,00x no se cobra nada');
  assert.ok(Math.abs(multiplierAt(secondsFor(2.5)) - 2.5) < 1e-9);
  assert.equal(multiplierAt(0), 1);
  const s = stream(2);
  const n = 400_000;
  let instant = 0;
  const targets = [1.01, 1.5, 2, 5, 20];
  const returns = targets.map(() => 0);
  for (let i = 0; i < n; i++) {
    const point = crashPoint(s.float());
    if (point === 1) instant++;
    targets.forEach((t, j) => {
      if (cashoutWins(t, point)) returns[j] += t;
    });
  }
  assert.ok(Math.abs(instant / n - (1 - 0.97 / 1.01)) < 0.002, `instantáneos ${(instant / n) * 100}%`);
  targets.forEach((t, j) => assert.ok(Math.abs(returns[j] / n - 0.97) < 0.02, `retiro ${t}x: RTP ${returns[j] / n}`));
});

test('Plinko: los multiplicadores pedidos dan exactamente el RTP anunciado', () => {
  for (const risk of Object.values(RISKS)) {
    assert.equal(risk.multipliers.length, 9);
    assert.ok(Math.abs(plinkoRtp(risk.id) - risk.rtp) < 1e-6, `${risk.id}: ${plinkoRtp(risk.id)}`);
    assert.ok(Math.abs(plinkoRtp(risk.id, { sapphire: true }) - (risk.rtp + 0.08)) < 1e-6, `${risk.id} con Zafiro`);
    const dist = bucketDistribution(risk.id);
    assert.ok(Math.abs(dist.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(dist[i] - dist[8 - i]) < 1e-12, 'simétrica');
    // El camino simulado reproduce la distribución exacta.
    const s = stream(3);
    const counts = new Array(9).fill(0);
    const n = 60_000;
    for (let i = 0; i < n; i++) {
      const path = plinkoPath(s, risk.id);
      assert.equal(path.moves.length, 8);
      counts[path.bucket]++;
    }
    counts.forEach((c, i) => assert.ok(Math.abs(c / n - dist[i]) < 0.008, `${risk.id} canasta ${i}`));
  }
});

test('Video Póker: clasificación exacta de las 2 598 960 manos posibles', () => {
  const deck = newDeck();
  assert.equal(deck.length, 52);
  const expected = { royal: 4, straightFlush: 36, fourKind: 624, fullHouse: 3744, flush: 5108, straight: 10200, threeKind: 54912, twoPair: 123552, jacks: 337920 };
  const counts = Object.fromEntries(Object.keys(expected).map((k) => [k, 0]));
  const hand = new Array(5);
  for (let a = 0; a < 48; a++) {
    hand[0] = deck[a];
    for (let b = a + 1; b < 49; b++) {
      hand[1] = deck[b];
      for (let c = b + 1; c < 50; c++) {
        hand[2] = deck[c];
        for (let d = c + 1; d < 51; d++) {
          hand[3] = deck[d];
          for (let e = d + 1; e < 52; e++) {
            hand[4] = deck[e];
            const row = evaluateHand(hand);
            if (row) counts[row.id]++;
          }
        }
      }
    }
  }
  assert.deepEqual(counts, expected);
  assert.equal(payPerCoin(PAY_BY_ID.royal, 5), 800);
  assert.equal(payPerCoin(PAY_BY_ID.royal, 4), 250);
  assert.equal(evaluateHand(['AS', '2D', '3C', '4H', '5S']).id, 'straight', 'escalera con As bajo');
  assert.equal(evaluateHand(['10H', 'JH', 'QH', 'KH', 'AH']).id, 'royal');
  assert.equal(evaluateHand(['10H', '10D', 'QH', 'KH', 'AH']), null, 'pareja de dieces no paga');
  const deal = dealHand(stream(4));
  assert.equal(new Set(deal.deck).size, 52);
  const drawn = drawCards(deal.deck, deal.hand, [true, false, true, false, false]);
  assert.deepEqual([drawn[0], drawn[2]], [deal.hand[0], deal.hand[2]]);
  assert.deepEqual([drawn[1], drawn[3], drawn[4]], deal.deck.slice(5, 8));
});

test('Rueda diaria: 10 gajos, bote del 1 % y enfriamiento de 24 h', () => {
  assert.equal(WHEEL_SLICES.length, 10);
  assert.equal(WHEEL_TOTAL_WEIGHT, 100);
  assert.equal(WHEEL_SLICES.find((slice) => slice.jackpot).amount, 10000);
  assert.deepEqual([...new Set(WHEEL_SLICES.filter((s) => s.type === 'chips').map((s) => s.amount))].sort((a, b) => a - b), [200, 400, 800, 1500, 3000, 10000]);
  const s = stream(5);
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 50_000; i++) counts[spinWheel(s).index]++;
  WHEEL_SLICES.forEach((slice, i) => assert.ok(Math.abs(counts[i] / 50_000 - slice.weight / 100) < 0.01, slice.id));
  assert.equal(wheelCooldown(null), 0);
  assert.equal(wheelCooldown(1000, 1000 + WHEEL_COOLDOWN_MS - 5), 5);
  assert.equal(wheelCooldown(1000, 1000 + WHEEL_COOLDOWN_MS), 0);
});
