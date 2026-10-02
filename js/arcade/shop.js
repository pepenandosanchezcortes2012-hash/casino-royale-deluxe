// Tienda cosmética: skins del avión de Crash y paletas retro para todo el juego. Se paga con
// créditos del juego (nunca dinero real) y lo comprado es permanente: sobrevive a cada nueva
// escalada. Comprar resta créditos del saldo, así que también te aleja de la meta.

import { storage as defaultStore } from '../storage.js';

export const SHOP_KEY = 'crd.arcade.shop.v1';

const item = (id, kind, name, description, price) => Object.freeze({ id, kind, name, description, price });

export const SHOP_ITEMS = Object.freeze([
  item('fighter', 'plane', 'Caza 16 bits', 'El caza de serie del Sindicato.', 0),
  item('prop', 'plane', 'Avioneta clásica', 'Hélice, tela roja y mucho valor.', 5_000),
  item('ship', 'plane', 'Nave espacial arcade', 'Directa de una recreativa de los 80.', 50_000),
  item('cyberbird', 'plane', 'Pájaro cibernético', 'Alas de neón que baten al subir.', 250_000),
  item('classic', 'palette', 'Modo Clásico', 'Los colores originales de cada piso.', 0),
  item('neon', 'palette', 'Cyberpunk Neón', 'Colores saturados y posterizados.', 2_500),
  item('amber', 'palette', 'Monitor Ámbar CRT', 'Seis tonos de ámbar sobre negro.', 10_000),
  item('gameboy', 'palette', 'Game Boy', 'Cuatro verdes, como en 1989.', 25_000),
]);

export const shopItem = (id) => SHOP_ITEMS.find((entry) => entry.id === id) ?? null;
const DEFAULTS = Object.freeze({ plane: 'fighter', palette: 'classic' });
const FREE = SHOP_ITEMS.filter((entry) => entry.price === 0).map((entry) => entry.id);

export function normalizeShop(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const owned = Array.isArray(source.owned) ? source.owned.filter((id) => shopItem(id)) : [];
  const set = [...new Set([...FREE, ...owned])];
  const equipped = { ...DEFAULTS };
  for (const kind of Object.keys(DEFAULTS)) {
    const id = source.equipped?.[kind];
    if (shopItem(id)?.kind === kind && set.includes(id)) equipped[kind] = id;
  }
  return { owned: set, equipped };
}

export class Shop extends EventTarget {
  #store;
  #s;

  constructor({ store = defaultStore } = {}) {
    super();
    this.#store = store;
    this.#s = normalizeShop(store.read(SHOP_KEY, null));
  }

  owns(id) {
    return this.#s.owned.includes(id);
  }

  equipped(kind) {
    return this.#s.equipped[kind];
  }

  #save(type, detail) {
    this.#store.write(SHOP_KEY, this.#s);
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new Event('change'));
  }

  // Compra con créditos (atómica: o se paga todo o nada) y equipa lo comprado.
  buy(id, wallet) {
    const entry = shopItem(id);
    if (!entry || this.owns(id)) return false;
    if (entry.price > 0 && !wallet.spend(entry.price, 'shop')) return false;
    this.#s.owned.push(id);
    this.#s.equipped[entry.kind] = id;
    this.#save('buy', { item: entry });
    return true;
  }

  equip(id) {
    const entry = shopItem(id);
    if (!entry || !this.owns(id) || this.#s.equipped[entry.kind] === id) return false;
    this.#s.equipped[entry.kind] = id;
    this.#save('equip', { item: entry });
    return true;
  }
}

export const shop = new Shop();
