// Persistencia tolerante a fallos y reactiva, con migraciones y copia de seguridad en JSON.
// - localStorage si está disponible (el modo privado, las cuotas o las políticas pueden
//   bloquearlo); memoria en caso contrario, de modo que el juego nunca se rompe por no poder guardar.
// - subscribe(key, fn): avisa de cada escritura o borrado de una clave, tanto en esta pestaña como
//   en las demás pestañas del mismo sitio (evento `storage` del navegador).
// - migrate(): pasos numerados e idempotentes que llevan los datos guardados al esquema actual.
// - exportData() / importData(): copia de seguridad de todas las claves `crd.*` en un único JSON.

export const KEY_PREFIX = 'crd.';
export const SCHEMA_KEY = 'crd.schema.v1';
export const BACKUP_FORMAT = 'casino-royale-deluxe/backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_CHARS = 2_000_000;
export const BACKUP_MAX_KEYS = 200;
const KEY_PATTERN = /^crd\.[a-z0-9._-]{1,80}$/i;

// Cada paso recibe el almacén y deja los datos en el formato de su versión. Se ejecutan en orden
// y una sola vez: la última versión aplicada se guarda en SCHEMA_KEY.
export const MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    description: 'Slots v4: el símbolo scatter pasa del diamante (D) a la estrella (X)',
    run(store) {
      for (const key of ['crd.slots.v2', 'crd.cyber.slots.v2']) {
        const save = store.read(key, null);
        if (!save || !Array.isArray(save.grid)) continue;
        save.grid = save.grid.map((row) => (Array.isArray(row) ? row.map((id) => (id === 'D' ? 'X' : id)) : row));
        store.write(key, save);
      }
    },
  }),
]);

export const SCHEMA_VERSION = MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;

function detectBackend() {
  // Fuera del navegador (pruebas en Node) se trabaja en memoria.
  if (typeof document === 'undefined') return null;
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

function parse(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// `backend` es cualquier objeto con la interfaz de Web Storage, o null para trabajar en memoria.
export function createStorage(backend = null, { listenCrossTab = false } = {}) {
  // Última escritura de cada clave en esta sesión: sobrevive aunque el disco rechace el valor.
  const memory = new Map();
  const listeners = new Map();

  const notify = (key, value) => {
    for (const listener of listeners.get(key) ?? []) {
      try {
        listener(value, key);
      } catch (error) {
        console.error(`[storage] suscriptor de ${key}`, error);
      }
    }
  };

  const api = {
    get persistent() {
      return backend !== null;
    },

    read(key, fallback = null) {
      try {
        const raw = memory.has(key) ? memory.get(key) : backend?.getItem(key);
        return parse(raw, fallback);
      } catch {
        return fallback;
      }
    },

    write(key, value) {
      const raw = JSON.stringify(value);
      memory.set(key, raw);
      if (backend) {
        try {
          backend.setItem(key, raw);
        } catch {
          // Cuota excedida: el valor sigue disponible en memoria durante la sesión.
        }
      }
      notify(key, value);
    },

    remove(key) {
      memory.delete(key);
      if (backend) {
        try {
          backend.removeItem(key);
        } catch {
          // Sin acceso de escritura: nada que limpiar.
        }
      }
      notify(key, null);
    },

    // Claves del juego guardadas (en disco y en memoria), ordenadas.
    keys(prefix = KEY_PREFIX) {
      const found = new Set();
      if (backend) {
        try {
          for (let i = 0; i < backend.length; i++) {
            const key = backend.key(i);
            if (key?.startsWith(prefix)) found.add(key);
          }
        } catch {
          // Sin acceso de lectura: solo quedan las claves en memoria.
        }
      }
      for (const key of memory.keys()) if (key.startsWith(prefix)) found.add(key);
      return [...found].sort();
    },

    // Suscripción reactiva a una clave; devuelve la función que la cancela.
    subscribe(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => listeners.get(key)?.delete(listener);
    },

    // Lleva los datos al esquema actual y devuelve las versiones aplicadas.
    migrate(steps = MIGRATIONS) {
      const current = Number(api.read(SCHEMA_KEY, 0)) || 0;
      const applied = [];
      for (const step of steps) {
        if (step.version <= current) continue;
        try {
          step.run(api);
          applied.push(step.version);
        } catch (error) {
          console.error(`[storage] migración ${step.version}`, error);
          break;
        }
      }
      if (applied.length) api.write(SCHEMA_KEY, applied[applied.length - 1]);
      return applied;
    },

    // Copia de seguridad de todas las claves del juego.
    exportData(now = new Date()) {
      const data = {};
      for (const key of api.keys()) {
        const value = api.read(key, undefined);
        if (value !== undefined) data[key] = value;
      }
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        schema: Number(api.read(SCHEMA_KEY, 0)) || 0,
        exportedAt: now.toISOString(),
        data,
      };
    },

    // Restaura una copia (texto JSON u objeto). Valida todo antes de tocar nada: o se importa
    // entera o no se importa. Después hay que recargar la página para que los módulos la lean.
    importData(input) {
      let backup = input;
      if (typeof input === 'string') {
        if (input.length > BACKUP_MAX_CHARS) return { ok: false, error: 'La copia es demasiado grande' };
        try {
          backup = JSON.parse(input);
        } catch {
          return { ok: false, error: 'El archivo no es un JSON válido' };
        }
      }
      if (!isPlainObject(backup) || backup.format !== BACKUP_FORMAT) return { ok: false, error: 'No es una copia de Casino Royale Deluxe' };
      if (!Number.isInteger(backup.version) || backup.version < 1 || backup.version > BACKUP_VERSION) {
        return { ok: false, error: `Versión de copia no admitida (${String(backup.version).slice(0, 12)})` };
      }
      if (!isPlainObject(backup.data)) return { ok: false, error: 'La copia no contiene datos' };
      const entries = Object.entries(backup.data);
      if (entries.length > BACKUP_MAX_KEYS) return { ok: false, error: 'La copia tiene demasiadas claves' };
      const invalid = entries.find(([key]) => !KEY_PATTERN.test(key));
      if (invalid) return { ok: false, error: `Clave no válida: ${String(invalid[0]).slice(0, 40)}` };
      if (JSON.stringify(backup.data).length > BACKUP_MAX_CHARS) return { ok: false, error: 'La copia es demasiado grande' };

      for (const key of api.keys()) api.remove(key);
      for (const [key, value] of entries) api.write(key, value);
      const migrated = api.migrate();
      return { ok: true, keys: entries.length, migrated };
    },
  };

  if (listenCrossTab && backend) {
    globalThis.addEventListener?.('storage', (event) => {
      if (event.storageArea !== backend || !event.key?.startsWith(KEY_PREFIX)) return;
      if (event.newValue === null) memory.delete(event.key);
      else memory.set(event.key, event.newValue);
      notify(event.key, parse(event.newValue, null));
    });
  }

  return api;
}

export const storage = createStorage(detectBackend(), { listenCrossTab: true });
// Las migraciones corren antes de que ningún módulo lea sus datos (todos importan este módulo).
storage.migrate();
