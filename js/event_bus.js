// Bus de eventos pub/sub: desacopla las mesas de la progresión, las misiones, las reliquias,
// la campaña y los efectos. Los emisores no saben quién escucha.
//
// Eventos principales:
//   round:start  { game, stake, mode }
//   round:end    { game, stake, returned, net, tags, multiplier, mode }
//   wallet:grant { amount, reason }
//   level:up     { level, rank }
//   relic:effect { relic, amount, text }

export class EventBus {
  #handlers = new Map();

  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const off = this.on(type, (detail) => {
      off();
      handler(detail);
    });
    return off;
  }

  off(type, handler) {
    this.#handlers.get(type)?.delete(handler);
  }

  // Un oyente que falla no impide que el resto reciba el evento.
  emit(type, detail = {}) {
    const handlers = this.#handlers.get(type);
    if (!handlers) return 0;
    let delivered = 0;
    for (const handler of [...handlers]) {
      try {
        handler(detail);
        delivered += 1;
      } catch (error) {
        console.error(`[bus] ${type}:`, error);
      }
    }
    return delivered;
  }

  clear() {
    this.#handlers.clear();
  }
}

export const bus = new EventBus();
