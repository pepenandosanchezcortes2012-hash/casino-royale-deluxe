// Terminal hacker, almacenamiento (reactivo, migraciones y copias JSON) y verificador de jugadas.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { runCommand, parseCommand, complete, RTP_TABLE, COMMANDS } from '../js/terminal.js';
import { createStorage, BACKUP_FORMAT, SCHEMA_KEY, MIGRATIONS } from '../js/storage.js';
import { verifyBet, inspect, GAME_NAMES } from '../js/verify.js';
import { ProvablyFair, FairStream, hmacHex, sha256Hex } from '../js/provably_fair.js';
import { Relics } from '../js/relics.js';
import { Progression } from '../js/progression.js';
import { Settings } from '../js/settings.js';
import { playDice } from '../js/games/dice-math.js';
import { crashPoint } from '../js/games/crash-math.js';
import { placeMines } from '../js/games/mines-math.js';
import { plinkoPath } from '../js/games/plinko-math.js';
import { spinWheel } from '../js/games/wheel-math.js';

function fakeBackend() {
  const data = new Map();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function context() {
  const store = createStorage(null);
  const fair = new ProvablyFair({ store });
  return {
    fair,
    relics: new Relics({ store, enabled: true }),
    progression: new Progression({ store }),
    settings: new Settings({ store, enabled: true }),
    wallet: { balance: 12345, inPlay: 0 },
    verify: () => ({ ok: false, hidden: true, error: 'semilla oculta' }),
  };
}

const text = (result) => result.lines.map((line) => line.text).join('\n');

test('Terminal: análisis, alias en castellano y autocompletado', () => {
  assert.deepEqual(parseCommand('  THEME   neon '), { name: 'theme', args: ['neon'] });
  assert.equal(parseCommand('semillas').name, 'seeds');
  assert.equal(parseCommand('').name, '');
  assert.deepEqual(complete('re'), ['relics']);
  assert.ok(complete('t').includes('turbo') && complete('t').includes('theme'));
  for (const name of ['help', 'seeds', 'rtp', 'relics', 'matrix', 'turbo']) assert.ok(COMMANDS.includes(name), name);
});

test('Terminal: help, seeds, rtp, relics y órdenes desconocidas', () => {
  const ctx = context();
  assert.match(text(runCommand('help', ctx)), /matrix on\|off/);
  const seeds = text(runCommand('seeds', ctx));
  assert.match(seeds, new RegExp(ctx.fair.commitment.serverSeedHash));
  assert.match(seeds, /nonce\s+0/);
  const rtp = text(runCommand('rtp', ctx));
  for (const name of Object.values(GAME_NAMES)) assert.match(rtp, new RegExp(name));
  assert.equal(RTP_TABLE.length, 10);
  assert.match(text(runCommand('relics', ctx)), /Colección: 0\/10/);
  assert.match(text(runCommand('balance', ctx)), /12\.345/);
  assert.match(text(runCommand('xyz', ctx)), /orden no encontrada/);
  assert.equal(runCommand('sudo rm -rf /', ctx).lines[0].tone, 'error');
});

test('Terminal: matrix, turbo, crt y theme cambian los ajustes; clear, exit, export e import son acciones', () => {
  const ctx = context();
  runCommand('matrix off', ctx);
  assert.equal(ctx.settings.matrix, false);
  runCommand('turbo on', ctx);
  assert.equal(ctx.settings.turbo, true);
  assert.equal(ctx.settings.speed, 0.5);
  runCommand('crt off', ctx);
  assert.equal(ctx.settings.scanlines, false);
  runCommand('theme blood', ctx);
  assert.equal(ctx.settings.theme, 'blood');
  assert.equal(runCommand('theme morado', ctx).lines[0].tone, 'warn');
  assert.equal(runCommand('turbo quizás', ctx).lines[0].tone, 'warn');
  assert.equal(runCommand('clear', ctx).action, 'clear');
  assert.equal(runCommand('exit', ctx).action, 'close');
  assert.equal(runCommand('export', ctx).action, 'export');
  assert.equal(runCommand('import', ctx).action, 'import');
});

test('Terminal: rotate revela la semilla y clientseed la cambia; verify avisa si sigue oculta', () => {
  const ctx = context();
  const hash = ctx.fair.commitment.serverSeedHash;
  const out = text(runCommand('rotate', ctx));
  const seed = out.match(/server_seed\s+([0-9a-f]{64})/)[1];
  assert.equal(sha256Hex(seed), hash);
  assert.notEqual(ctx.fair.commitment.serverSeedHash, hash);
  assert.equal(runCommand('clientseed con espacios', ctx).lines[0].tone, 'error');
  runCommand('clientseed nuevo-cliente', ctx);
  assert.equal(ctx.fair.commitment.clientSeed, 'nuevo-cliente');
  assert.match(text(runCommand('verify 3', ctx)), /semilla oculta/);
  assert.equal(runCommand('verify abc', ctx).lines[0].tone, 'warn');
});

test('Almacenamiento: lectura/escritura, suscripciones y claves del juego', () => {
  const backend = fakeBackend();
  const store = createStorage(backend);
  const seen = [];
  const off = store.subscribe('crd.x.v1', (value) => seen.push(value));
  store.write('crd.x.v1', { a: 1 });
  store.write('otra.clave', 5);
  assert.deepEqual(store.read('crd.x.v1'), { a: 1 });
  assert.deepEqual(store.keys(), ['crd.x.v1']);
  store.remove('crd.x.v1');
  off();
  store.write('crd.x.v1', 2);
  assert.deepEqual(seen, [{ a: 1 }, null]);
  // Sin disco (modo privado) todo sigue funcionando en memoria.
  const memory = createStorage(null);
  memory.write('crd.y', [1, 2]);
  assert.deepEqual(memory.read('crd.y'), [1, 2]);
  assert.equal(memory.persistent, false);
});

test('Almacenamiento: migraciones una sola vez y copia de seguridad JSON validada', () => {
  const store = createStorage(fakeBackend());
  store.write('crd.slots.v2', { bet: 5, grid: [['D', 'C', 'S', 'B'], ['H', 'T', 'R', 'D'], ['C', 'C', 'C', 'C'], ['R', 'R', 'R', 'R']] });
  assert.deepEqual(store.migrate(), MIGRATIONS.map((m) => m.version));
  assert.equal(store.read('crd.slots.v2').grid[0][0], 'X');
  assert.equal(store.read(SCHEMA_KEY), MIGRATIONS.at(-1).version);
  assert.deepEqual(store.migrate(), [], 'no se repite');

  store.write('crd.wallet.v2', { balance: 77 });
  const backup = store.exportData(new Date('2026-09-30T10:00:00Z'));
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.exportedAt, '2026-09-30T10:00:00.000Z');
  assert.deepEqual(backup.data['crd.wallet.v2'], { balance: 77 });

  const target = createStorage(fakeBackend());
  target.write('crd.basura', 1);
  const result = target.importData(JSON.stringify(backup));
  assert.equal(result.ok, true);
  assert.deepEqual(target.read('crd.wallet.v2'), { balance: 77 });
  assert.equal(target.read('crd.basura'), null, 'la copia sustituye a todo');

  for (const bad of ['{no es json', JSON.stringify({ format: 'otro', version: 1, data: {} }), JSON.stringify({ ...backup, version: 99 }), JSON.stringify({ ...backup, data: { 'malicioso<script>': 1 } })]) {
    const before = target.read('crd.wallet.v2');
    assert.equal(target.importData(bad).ok, false);
    assert.deepEqual(target.read('crd.wallet.v2'), before, 'una copia rechazada no toca nada');
  }
});

test('Verificador: HMAC y resultados idénticos a las funciones de cada juego', () => {
  const serverSeed = 'd'.repeat(64);
  const clientSeed = 'verificador';
  const serverSeedHash = sha256Hex(serverSeed);
  const nonce = 17;
  const first = inspect({ serverSeed, clientSeed, nonce });
  assert.equal(first.hmac, hmacHex(serverSeed, `${clientSeed}:${nonce}`));
  assert.equal(first.float, parseInt(first.hmac.slice(0, 8), 16) / 2 ** 32);
  const fresh = () => new FairStream({ serverSeed, clientSeed, nonce });

  const dice = verifyBet({ game: 'dice', serverSeed, serverSeedHash, clientSeed, nonce, params: { chance: 30, direction: 'over' } });
  assert.equal(dice.seedOk, true);
  const roll = playDice(fresh(), { chance: 30, direction: 'over' }).roll;
  assert.match(dice.outcome, new RegExp(roll.toFixed(2).replace('.', ',')));

  const crash = verifyBet({ game: 'crash', serverSeed, clientSeed, nonce });
  const point = crashPoint(fresh().float());
  assert.match(crash.outcome, point <= 1 ? /despegar/ : new RegExp(point.toFixed(2).replace('.', ',')));

  const mines = verifyBet({ game: 'mines', serverSeed, clientSeed, nonce, params: { mines: 5 } });
  assert.equal(mines.rows[1][1].split(' · ').length, 5);
  assert.equal(placeMines(fresh(), 5).length, 5);

  const plinko = verifyBet({ game: 'plinko', serverSeed, clientSeed, nonce, params: { risk: 'high' } });
  assert.match(plinko.outcome, new RegExp(`Cubeta ${plinkoPath(fresh(), 'high').bucket + 1}`));

  const wheel = verifyBet({ game: 'wheel', serverSeed, clientSeed, nonce });
  assert.match(wheel.outcome, new RegExp(`Gajo ${spinWheel(fresh()).index + 1}`));

  const roulette = verifyBet({ game: 'roulette', serverSeed, clientSeed, nonce });
  assert.match(roulette.outcome, new RegExp(`Sale el ${fresh().int(37)} `));

  for (const game of ['towers', 'video_poker', 'slots', 'blackjack']) {
    const result = verifyBet({ game, serverSeed, clientSeed, nonce, params: game === 'video_poker' ? { holds: [true, false, true, false, false], coins: 5 } : {} });
    assert.equal(result.ok, true, game);
    assert.ok(result.rows.length > 0 && result.outcome.length > 0, game);
  }

  assert.equal(verifyBet({ game: 'dice', serverSeed, serverSeedHash: 'f'.repeat(64), clientSeed, nonce }).seedOk, false);
  assert.equal(verifyBet({ game: 'dice', serverSeed: 'corta', clientSeed, nonce }).ok, false);
  assert.equal(verifyBet({ game: 'baccarat', serverSeed, clientSeed, nonce }).ok, false);
  assert.equal(verifyBet({ game: 'dice', serverSeed, clientSeed, nonce: -1 }).ok, false);
});
