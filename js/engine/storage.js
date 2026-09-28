// Persistencia tolerante a fallos: localStorage si está disponible (modo privado,
// cuotas o políticas pueden bloquearlo), memoria en caso contrario.

function detectBackend() {
  try {
    const store = globalThis.localStorage;
    if (!store) return null;
    const probe = '__crd_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

const backend = detectBackend();
const memory = new Map();

export const storage = {
  get persistent() {
    return backend !== null;
  },

  read(key, fallback = null) {
    try {
      const raw = backend ? backend.getItem(key) : memory.get(key);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  write(key, value) {
    const raw = JSON.stringify(value);
    memory.set(key, raw);
    if (!backend) return;
    try {
      backend.setItem(key, raw);
    } catch {
      // Cuota excedida: el valor sigue disponible en memoria durante la sesión.
    }
  },

  remove(key) {
    memory.delete(key);
    if (!backend) return;
    try {
      backend.removeItem(key);
    } catch {
      // Sin acceso de escritura: nada que limpiar.
    }
  },
};
