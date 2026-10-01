// Reliquias: 10 reliquias, 4 ranuras, cofres con reliquia nueva garantizada, pociones ×2 y las
// bonificaciones (con topes por piso) de la Corona de Midas, el Escudo y el Imán de Cashback.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Relics, RELICS, CHESTS, SLOT_COUNT, RELICS_KEY, drawRelic, roundBonuses, CLOCK_BONUS, PASS_XP, MIDAS_CAP, CASHBACK_CAP, POTION_CAP, SHIELD_CAP } from '../js/relics.js';
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

function fakeWallet(balance = 0) {
  return {
    balance,
    granted: [],
    grant(amount, reason) {
      this.balance += amount;
      this.granted.push({ amount, reason });
      return amount;
    },
    spend(amount) {
      if (amount > this.balance) return false;
      this.balance -= amount;
      return true;
    },
  };
}

let seed = 1;
const rand = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};

test('Catálogo: 10 reliquias únicas, 4 ranuras y rarezas con peso en cada cofre', () => {
  assert.equal(RELICS.length, 10);
  assert.equal(new Set(RELICS.map((r) => r.id)).size, 10);
  assert.equal(SLOT_COUNT, 4);
  for (const chest of Object.values(CHESTS)) {
    const total = Object.values(chest.weights).reduce((sum, w) => sum + w, 0);
    assert.equal(total, 100, `${chest.id} suma 100`);
  }
});

test('Cofres: siempre una reliquia que aún no tienes hasta completar la colección', () => {
  const owned = [];
  for (let i = 0; i < RELICS.length; i++) {
    const relic = drawRelic(i % 2 ? 'legendary' : 'common', owned, rand);
    assert.ok(relic, 'hay reliquia');
    assert.equal(owned.includes(relic.id), false, 'nunca repite');
    owned.push(relic.id);
  }
  assert.equal(drawRelic('common', owned, rand), null, 'colección completa');
  // El cofre legendario no da reliquias comunes mientras queden de otras rarezas.
  for (let i = 0; i < 200; i++) assert.notEqual(drawRelic('legendary', [], rand).rarity, 'common');
});

test('Abrir cofres: se equipan solos en ranuras libres; completa la colección y paga créditos', () => {
  const store = memoryStore();
  const r = new Relics({ store, rand });
  for (let i = 0; i < 12; i++) r.addChest('common');
  const results = [];
  for (let i = 0; i < 12; i++) results.push(r.openChest('common'));
  assert.equal(r.owned.length, 10);
  assert.equal(r.equipped.filter(Boolean).length, 4, 'las 4 primeras se equipan solas');
  const extra = results.slice(10);
  assert.ok(extra.every((result) => result.relic === null && result.chips === CHESTS.common.fallbackChips));
  assert.equal(r.openChest('common'), null, 'sin cofres no se abre nada');
  const again = new Relics({ store, rand });
  assert.equal(again.owned.length, 10);
  assert.ok(store.map.has(RELICS_KEY));
});

test('Ranuras: equipar, mover, sustituir y quitar', () => {
  const r = new Relics({ store: memoryStore(), rand });
  for (let i = 0; i < 6; i++) {
    r.addChest('common');
    r.openChest('common');
  }
  const [a, b, c, d] = r.equipped;
  const spare = r.owned.find((id) => !r.isEquipped(id));
  assert.equal(r.equip(spare), false, 'sin ranura libre no se equipa');
  assert.equal(r.unequip(0), true);
  assert.equal(r.equip(spare), true);
  assert.equal(r.equipped[0], spare);
  assert.equal(r.equip(b, 0), true, 'mover a otra ranura sustituye la anterior');
  assert.deepEqual(r.equipped, [b, null, c, d]);
  assert.equal(r.equip('no-existe'), false);
  assert.equal(r.unequip(a), false, 'a no estaba equipada');
});

test('Bonificaciones: poción sobre el neto, Corona de Midas, Escudo e Imán, con topes por piso', () => {
  const round = (game, stake, returned) => ({ game, stake, returned, mode: 'climb' });
  assert.deepEqual(roundBonuses(round('dice', 100, 0), { equipped: [] }).bonuses, []);
  const potion = roundBonuses(round('dice', 100, 150), { equipped: [], potionArmed: true });
  assert.equal(potion.total, 50, 'la poción duplica el premio neto (150 − 100)');
  assert.equal(potion.consumedPotion, true);
  assert.equal(roundBonuses(round('dice', 100, 80), { equipped: [], potionArmed: true }).consumedPotion, false, 'una ronda perdida no gasta la poción');
  const midas = roundBonuses(round('dice', 100, 300), { equipped: ['midas'] });
  assert.equal(midas.total, 40, '20 % de 200 de neto');
  const both = roundBonuses(round('dice', 100, 300), { equipped: ['midas'], potionArmed: true });
  assert.equal(both.total, 200 + 40);
  const shield = roundBonuses(round('blackjack', 100, 0), { equipped: ['shield', 'magnet'] });
  assert.deepEqual(shield.bonuses.map((b) => b.id), ['shield']);
  assert.equal(shield.total, 100);
  const magnet = roundBonuses(round('blackjack', 100, 0), { equipped: ['shield', 'magnet'], shieldUsed: true });
  assert.deepEqual(magnet.bonuses.map((b) => [b.id, b.amount]), [['magnet', 10]]);
  assert.equal(roundBonuses(round('wheel', 0, 500), { equipped: ['midas'], potionArmed: true }).total, 0, 'la rueda no cuenta');
  // Topes en apuestas mínimas del piso: con las apuestas sin límite del Olimpo no se disparan.
  const minBet = 10_000;
  const huge = round('dice', 5_000_000, 10_000_000);
  assert.equal(roundBonuses(huge, { equipped: ['midas'], minBet }).total, MIDAS_CAP * minBet);
  assert.equal(roundBonuses(huge, { equipped: [], potionArmed: true, minBet }).total, POTION_CAP * minBet);
  const lost = round('blackjack', 5_000_000, 0);
  assert.equal(roundBonuses(lost, { equipped: ['shield'], minBet }).total, SHIELD_CAP * minBet);
  assert.equal(roundBonuses(lost, { equipped: ['magnet'], minBet }).total, CASHBACK_CAP * minBet);
});

test('applyRound: solo rondas de la escalada, abona con el monedero, gasta la poción y el Escudo es diario', () => {
  let now = new Date(2026, 8, 30, 12).getTime();
  const r = new Relics({ store: memoryStore(), rand, now: () => now });
  const wallet = fakeWallet();
  r.addPotion(1);
  assert.equal(r.armPotion(), true);
  assert.equal(r.armPotion(), false, 'no hay otra poción');
  r.applyRound({ game: 'dice', stake: 10, returned: 20, mode: 'climb', minBet: 1 }, wallet);
  assert.equal(wallet.balance, 10, 'duplica los 10 de neto');
  assert.equal(r.potionArmed, false);
  assert.equal(r.applyRound({ game: 'dice', stake: 10, returned: 20, mode: 'free' }, wallet), null);
  // El Escudo actúa en la primera mano perdida de cada día, también tras recargar.
  r.addChest('common');
  for (let i = 0; i < 12 && !r.owns('shield'); i++) {
    r.addChest('common');
    r.openChest('common');
  }
  if (!r.isEquipped('shield')) r.equip('shield', 0);
  const loss = { game: 'blackjack', stake: 50, returned: 0, mode: 'climb', minBet: 10 };
  assert.equal(r.applyRound(loss, wallet).usedShield, true);
  assert.equal(r.shieldUsed, true);
  assert.equal(r.applyRound(loss, wallet).usedShield, false, 'una vez al día');
  now += 24 * 3600 * 1000;
  assert.equal(r.shieldUsed, false, 'al día siguiente vuelve a estar listo');
});

test('Efectos pasivos, cofres del bus, cofres de hitos (una vez) y precios en la escala del piso', () => {
  const store = memoryStore();
  const r = new Relics({ store, rand: () => 0 });
  assert.equal(r.xpMultiplier(), 1);
  assert.equal(r.abundanceBonus(), 0);
  const bus = new EventBus();
  const wallet = fakeWallet(20000);
  let scale = 1;
  r.attach(bus, { wallet, scale: () => scale });
  bus.emit('reward:chest', { tier: 'legendary', reason: 'Nivel 10' });
  assert.equal(r.chests.legendary, 1);
  assert.equal(r.claimReward('floor-2'), true);
  assert.equal(r.claimReward('floor-2'), false);
  assert.equal(r.chests.common, 1);
  assert.equal(r.priceOf('common'), CHESTS.common.price);
  assert.equal(r.buyChest('common', wallet), true);
  assert.equal(wallet.balance, 20000 - CHESTS.common.price);
  scale = 0.1;
  assert.equal(r.priceOf('common'), CHESTS.common.price / 10, 'en el Subsuelo el cofre cuesta la décima parte');
  scale = 100;
  assert.equal(r.buyChest('legendary', wallet), false, 'en el Olimpo cuesta 100 veces más');
  scale = 1;
  for (let i = 0; i < 12; i++) {
    r.addChest('legendary');
    r.openChest('legendary');
  }
  for (const id of ['pass', 'clock']) {
    if (!r.isEquipped(id)) {
      r.unequip(0);
      r.equip(id, 0);
    }
    if (id === 'pass') assert.equal(r.xpMultiplier(), PASS_XP);
  }
  assert.equal(r.abundanceBonus(), CLOCK_BONUS);
  // Con la colección completa el cofre paga créditos en la escala del piso.
  scale = 10;
  r.addChest('common');
  assert.equal(r.openChest('common').chips, CHESTS.common.fallbackChips * 10);
  assert.ok(store.map.has(RELICS_KEY));
});
