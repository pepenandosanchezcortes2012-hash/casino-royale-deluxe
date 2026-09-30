// Modo de juego activo, elegido en el menú principal y guardado entre visitas:
//   'story' → Modo Historia «El Último Crédito» (1 crédito, zonas, encargos, finales).
//   'free'  → Cripto-Casino (modo libre con fichas, progresión, reliquias y 10 juegos).
//   null    → todavía no se ha elegido: se muestra el menú principal.
// Cambiar de modo recarga la página para que cada módulo arranque con su monedero y sus datos.

import { storage } from './storage.js';

export const MODE_KEY = 'crd.mode.v1';
export const MODES = Object.freeze(['story', 'free']);

const saved = storage.read(MODE_KEY, null);
export const MODE = MODES.includes(saved) ? saved : null;
export const isFree = MODE === 'free';
export const isStory = MODE === 'story';

// Claves de guardado de cada modo: las mesas del Cripto-Casino no pisan la partida de la historia.
export const scopedKey = (key) => (isFree ? key.replace(/^crd\./, 'crd.cyber.') : key);

export function chooseMode(mode) {
  if (!MODES.includes(mode)) return false;
  storage.write(MODE_KEY, mode);
  return true;
}

export function leaveMode() {
  storage.remove(MODE_KEY);
}
