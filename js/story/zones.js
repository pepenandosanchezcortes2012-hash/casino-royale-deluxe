// Las tres zonas del casino clandestino. Cada zona fija sus fichas, límites de mesa y qué
// funciones están disponibles; el ascenso depende del saldo y la permanencia tiene histéresis
// (se entra con `entry` créditos y te expulsan si bajas de `stay`).

export const FREEDOM_GOAL = 100000;
export const FAVORS_PER_LEGEND = 3;
export const CRITICAL_SHARE = 0.5;
// Con saldos pequeños solo es crítica una apuesta de todo o nada; si no, lo sería cada apuesta mínima.
export const CRITICAL_MIN_BETS = 10;

export const ZONES = Object.freeze([
  Object.freeze({
    id: 'alley',
    level: 1,
    name: 'El Callejón',
    tagline: 'Sótano · apuestas de 1 a 10 créditos',
    description: 'Un sótano húmedo bajo una bombilla que parpadea. Mesas cojas, fichas gastadas y un límite de 10 créditos por apuesta.',
    entry: 0,
    stay: 0,
    minBet: 1,
    chips: Object.freeze([1, 5, 10]),
    blackjack: Object.freeze({ seats: 1, sideBets: false, maxMain: 10, maxSide: 0 }),
    roulette: Object.freeze({ racetrack: false, spotMax: 10, tableMax: 50 }),
    slots: Object.freeze({ bets: Object.freeze([1, 2, 5, 10]), bonusBuy: false }),
    contractFactor: 2,
    favor: 5,
    dealer: 'Moss',
    dealerRole: 'crupier del sótano',
    mood: 'alley',
    tension: 0.12,
  }),
  Object.freeze({
    id: 'neon',
    level: 2,
    name: 'El Salón de Neón',
    tagline: 'Apuestas de 5 a 500 · multimano y racetrack',
    description: 'Terciopelo violeta, humo de sintetabaco y neones que zumban. Aquí se juega a tres manos, con apuestas laterales y en el racetrack francés.',
    entry: 250,
    stay: 100,
    minBet: 5,
    chips: Object.freeze([5, 10, 25, 100, 500]),
    blackjack: Object.freeze({ seats: 3, sideBets: true, maxMain: 500, maxSide: 100 }),
    roulette: Object.freeze({ racetrack: true, spotMax: 500, tableMax: 5000 }),
    slots: Object.freeze({ bets: Object.freeze([10, 20, 50, 100, 200, 500]), bonusBuy: true }),
    contractFactor: 30,
    favor: 50,
    dealer: 'Vera',
    dealerRole: 'crupier del Salón',
    mood: 'neon',
    tension: 0.25,
  }),
  Object.freeze({
    id: 'penthouse',
    level: 3,
    name: 'El Penthouse',
    tagline: 'High-rollers · apuestas de 100 a 25.000',
    description: 'Oro, cristal blindado y silencio. Solo quien supera los 5.000 créditos se sienta frente a SIBILA, la IA que gestiona las mesas del Sindicato.',
    entry: 5000,
    stay: 2500,
    minBet: 100,
    chips: Object.freeze([100, 500, 1000, 5000, 10000]),
    blackjack: Object.freeze({ seats: 3, sideBets: true, maxMain: 25000, maxSide: 5000 }),
    roulette: Object.freeze({ racetrack: true, spotMax: 25000, tableMax: 100000 }),
    slots: Object.freeze({ bets: Object.freeze([500, 1000, 2000, 5000, 10000]), bonusBuy: true }),
    contractFactor: 600,
    favor: 500,
    dealer: 'SIBILA',
    dealerRole: 'IA del Sindicato',
    mood: 'penthouse',
    tension: 0.5,
  }),
]);

export const zoneById = (id) => ZONES.find((zone) => zone.id === id) ?? ZONES[0];

// Zona más alta a la que da acceso un saldo, según el umbral de entrada o de permanencia.
export function highestZoneFor(balance, threshold = 'entry') {
  let index = 0;
  ZONES.forEach((zone, i) => {
    if (balance >= zone[threshold]) index = i;
  });
  return index;
}
