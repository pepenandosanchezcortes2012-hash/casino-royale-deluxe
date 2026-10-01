// Espacio de nombres de la partida. «The Syndicate Climb» es el único modo de juego y guarda sus
// datos con el prefijo crd.climb. (las versiones anteriores usaban crd. y crd.cyber.; sus datos
// se quedan donde estaban y no interfieren con la escalada).

export const MODE = 'climb';

export const scopedKey = (key) => (key.startsWith('crd.climb.') ? key : key.replace(/^crd\./, 'crd.climb.'));
