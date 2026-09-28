// State Store unidireccional: acción → commit validado → estado inmutable → render.
// Cada mesa tiene su propia máquina de estados atómica.

export const PHASE = Object.freeze({
  IDLE: 'IDLE',
  BETTING: 'BETTING',
  DEALING: 'DEALING',
  RESOLVING: 'RESOLVING',
  PAYOUT: 'PAYOUT',
});

const TRANSITIONS = Object.freeze({
  IDLE: Object.freeze(['BETTING']),
  BETTING: Object.freeze(['IDLE', 'DEALING']),
  DEALING: Object.freeze(['RESOLVING', 'PAYOUT']),
  RESOLVING: Object.freeze(['PAYOUT']),
  PAYOUT: Object.freeze(['IDLE', 'BETTING']),
});

export function canTransition(from, to) {
  return from === to || (TRANSITIONS[from] ?? []).includes(to);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export class Store {
  #name;
  #state;
  #listeners = new Set();
  #history = [];

  constructor(name, initialState) {
    if (!Object.values(PHASE).includes(initialState.phase)) {
      throw new Error(`[${name}] fase inicial inválida: ${initialState.phase}`);
    }
    this.#name = name;
    this.#state = deepFreeze(structuredClone(initialState));
  }

  get state() {
    return this.#state;
  }

  get phase() {
    return this.#state.phase;
  }

  // Últimas acciones aplicadas (para depuración y auditoría).
  get log() {
    return [...this.#history];
  }

  commit(action, patch = {}) {
    const prev = this.#state;
    if (patch.phase !== undefined && !canTransition(prev.phase, patch.phase)) {
      throw new Error(`[${this.#name}] transición ilegal ${prev.phase} → ${patch.phase} (${action})`);
    }
    const next = deepFreeze(structuredClone({ ...prev, ...patch }));
    this.#state = next;
    this.#history.push({ action, phase: next.phase, at: Date.now() });
    if (this.#history.length > 50) this.#history.shift();
    for (const listener of this.#listeners) listener(next, prev, action);
    return next;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
