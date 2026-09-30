// Reliquias: 10 reliquias, 4 ranuras, cofres con reliquia nueva garantizada, pociones ×2 y las
// bonificaciones de la Corona de Midas, el Escudo y el Imán de Cashback.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { Relics, RELICS, CHESTS, SLOT_COUNT, RELICS_KEY, drawRelic, roundBonuses, CLOCK_BONUS, PASS_XP } from '../js/relics.js';
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

test('Abrir cofres: se equipan solos en ranuras libres; completa la colección y paga fichas', () => {
  const store = memoryStore();
  const r = new Relics({ store, rand, enabled: true });
  for (let i = 0; i < 12; i++) r.addChest('common');
  const results = [];
  for (let i = 0; i < 12; i++) results.push(r.openChest('common'));
  assert.equal(r.owned.length, 10);
  assert.equal(r.equipped.filter(Boolean).length, 4, 'las 4 primeras se equipan solas');
  const extra = results.slice(10);
  assert.ok(extra.every((result) => result.relic === null && result.chips === CHESTS.common.fallbackChips));
  assert.equal(r.openChest('common'), null, 'sin cofres no se abre nada');
  const again = new Relics({ store, rand, enabled: true });
  assert.equal(again.owned.length, 10);
  assert.ok(store.map.has(RELICS_KEY));
});

test('Ranuras: equipar, mover, sustituir y quitar', () => {
  const r = new Relics({ store: memoryStore(), rand, enabled: true });
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

test('Bonificaciones: poción ×2, Corona de Midas, Escudo (una vez) e Imán de Cashback', () => {
  const round = (game, stake, returned) => ({ game, stake, returned, mode: 'free' });
  assert.deepEqual(roundBonuses(round('dice', 100, 0), { equipped: [] }).bonuses, []);
  const potion = roundBonuses(round('dice', 100, 150), { equipped: [], potionArmed: true });
  assert.equal(potion.total, 150);
  assert.equal(potion.consumedPotion, true);
  const midas = roundBonuses(round('dice', 100, 300), { equipped: ['midas'] });
  assert.equal(midas.total, 40, '20 % de 200 de neto');
  const both = roundBonuses(round('dice', 100, 300), { equipped: ['midas'], potionArmed: true });
  assert.equal(both.total, 300 + 100, 'la Corona cuenta el neto con la poción');
  const shield = roundBonuses(round('blackjack', 100, 0), { equipped: ['shield', 'magnet'] });
  assert.deepEqual(shield.bonuses.map((b) => b.id), ['shield']);
  assert.equal(shield.total, 100);
  const magnet = roundBonuses(round('blackjack', 100, 0), { equipped: ['shield', 'magnet'], shieldUsed: true });
  assert.deepEqual(magnet.bonuses.map((b) => [b.id, b.amount]), [['magnet', 10]]);
  assert.equal(roundBonuses(round('wheel', 0, 500), { equipped: ['midas'], potionArmed: true }).total, 0, 'la rueda no cuenta');
});

test('applyRound: solo en el Cripto-Casino, abona con el monedero y gasta la poción', () => {
  const r = new Relics({ store: memoryStore(), rand, enabled: true });
  const wallet = fakeWallet();
  r.addPotion(1);
  assert.equal(r.armPotion(), true);
  assert.equal(r.armPotion(), false, 'no hay otra poción');
  r.applyRound({ game: 'dice', stake: 10, returned: 20, mode: 'free' }, wallet);
  assert.equal(wallet.balance, 20);
  assert.equal(r.potionArmed, false);
  const story = new Relics({ store: memoryStore(), rand, enabled: false });
  assert.equal(story.applyRound({ game: 'dice', stake: 10, returned: 20, mode: 'free' }, wallet), null);
  assert.equal(r.applyRound({ game: 'dice', stake: 10, returned: 20, mode: 'story' }, wallet), null);
});

test('Efectos pasivos, cofres del bus y cofres de logros de la historia (una vez por logro)', () => {
  const store = memoryStore();
  const r = new Relics({ store, rand: () => 0, enabled: true });
  assert.equal(r.xpMultiplier(), 1);
  assert.equal(r.abundanceBonus(), 0);
  const bus = new EventBus();
  const wallet = fakeWallet(20000);
  r.attach(bus, { wallet });
  bus.emit('reward:chest', { tier: 'legendary', reason: 'Nivel 10' });
  assert.equal(r.chests.legendary, 1);
  assert.equal(r.claimStoryReward('natural'), true);
  assert.equal(r.claimStoryReward('natural'), false);
  assert.equal(r.chests.common, 1);
  assert.equal(r.buyChest('common', wallet), true);
  assert.equal(wallet.balance, 20000 - CHESTS.common.price);
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
  const inactive = new Relics({ store, enabled: false });
  assert.equal(inactive.active('clock'), false, 'en la historia las reliquias no actúan');
});
