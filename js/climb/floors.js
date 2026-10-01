// Los 4 pisos del Sindicato. Cada piso fija el rango de apuestas, las mesas que abre (las de los
// pisos inferiores siguen disponibles), las fichas, su escala económica y su ambiente. La tarjeta
// de acceso a un piso se consigue al reunir `unlockAt` créditos y no se pierde nunca: después se
// puede viajar libremente entre los pisos desbloqueados con el selector del HUD.

export const START_BALANCE = 10;
export const GOAL = 10_000_000;
// Limosna del Sindicato: +10 créditos con el saldo a cero, como mucho una vez cada 5 minutos.
export const RESCUE_AMOUNT = 10;
export const RESCUE_COOLDOWN_MS = 5 * 60 * 1000;
// Jugada crítica: arriesgar la mitad del saldo (con al menos 10 apuestas mínimas) o todo.
export const CRITICAL_SHARE = 0.5;
export const CRITICAL_MIN_BETS = 10;

// Orden de las mesas en las pestañas: piso a piso.
export const GAME_ORDER = Object.freeze(['mines', 'dice', 'towers', 'fish', 'plinko', 'slots', 'crash', 'roulette', 'video_poker', 'blackjack', 'wheel']);

const list = (values) => Object.freeze([...values]);

function floor(def) {
  return Object.freeze({
    ...def,
    unlocks: list(def.unlocks),
    games: list(def.games),
    chips: list(def.chips),
    lists: Object.freeze(Object.fromEntries(Object.entries(def.lists).map(([game, values]) => [game, list(values)]))),
  });
}

const BASE_FLOORS = [
  {
    id: 'subsuelo',
    level: 1,
    name: 'El Subsuelo Clandestino',
    short: 'Subsuelo',
    tagline: 'Neón parpadeante, tuberías y mesas ilegales · apuestas de 1 a 50',
    description: 'Bajo los callejones del bajo mundo, entre tuberías que gotean y neones que parpadean, el Sindicato monta sus mesas ilegales: Minas, Dados y Torres, con apuestas de 1 a 50 créditos.',
    unlockAt: 0,
    minBet: 1,
    maxBet: 50,
    scale: 0.1,
    contractFactor: 8,
    unlocks: ['mines', 'dice', 'towers'],
    chips: [1, 5, 10, 25, 50],
    lists: {},
    host: 'Moss',
    hostRole: 'crupier del subsuelo',
    card: 'Tu monedero cripto',
    theme: 'matrix',
    mood: 'alley',
    tension: 0.15,
  },
  {
    id: 'bahia',
    level: 2,
    name: 'La Bahía Arcade & Casino Neón',
    short: 'Bahía Arcade',
    tagline: 'Sala arcade futurista · apuestas de 50 a 1.000',
    description: 'Una sala arcade futurista de luces cian y magenta. Se abren Cyber-Fish Hunter, Plinko y las Slots Matrix; las mesas del Subsuelo siguen aquí, con apuestas de 50 a 1.000.',
    unlockAt: 10_000,
    minBet: 50,
    maxBet: 1000,
    scale: 1,
    contractFactor: 80,
    unlocks: ['fish', 'plinko', 'slots'],
    chips: [50, 100, 250, 500, 1000],
    lists: {
      fish: [50, 100, 250, 500, 1000],
      plinko: [50, 100, 250, 500, 1000],
      slots: [50, 100, 200, 500, 1000],
    },
    host: 'Vera',
    hostRole: 'jefa de sala de la Bahía',
    card: 'Tarjeta de acceso Neón',
    theme: 'neon',
    mood: 'neon',
    tension: 0.25,
  },
  {
    id: 'salon',
    level: 3,
    name: 'El Salón VIP del Padrino',
    short: 'Salón VIP',
    tagline: 'Alfombras carmesí y mármol oscuro · mesas de 1.000 a 25.000',
    description: 'Alfombras carmesí, mármol oscuro y camareros androides. El Padrino abre Crash, la Ruleta Europea y el Video Póker con límites de mesa de 1.000 a 25.000.',
    unlockAt: 100_000,
    minBet: 1000,
    maxBet: 25_000,
    scale: 10,
    contractFactor: 800,
    unlocks: ['crash', 'roulette', 'video_poker'],
    chips: [1000, 2500, 5000, 10_000, 25_000],
    lists: {
      fish: [1000, 2500, 5000, 10_000, 25_000],
      plinko: [1000, 2500, 5000, 10_000, 25_000],
      slots: [1000, 2000, 5000, 10_000, 20_000],
      video_poker: [1000, 2500, 5000],
    },
    host: 'Ferro',
    hostRole: 'mayordomo androide del Padrino',
    card: 'Invitación lacrada del Padrino',
    theme: 'blood',
    mood: 'gameover',
    tension: 0.35,
  },
  {
    id: 'olympus',
    level: 4,
    name: 'El Penthouse Cripto-Olympus',
    short: 'Cripto-Olympus',
    tagline: 'Rascacielos y mesas de oro · sin límite de apuesta',
    description: 'Un rascacielos sobre la metrópolis, con mesas de oro y apuestas sin techo. Blackjack High-Roller, la Rueda de la Fortuna Legendaria y todas las mesas liberadas.',
    unlockAt: 1_000_000,
    minBet: 10_000,
    maxBet: Infinity,
    scale: 100,
    contractFactor: 8000,
    unlocks: ['blackjack', 'wheel'],
    chips: [10_000, 25_000, 100_000, 500_000, 1_000_000],
    lists: {
      fish: [10_000, 25_000, 50_000, 100_000, 250_000],
      plinko: [10_000, 25_000, 50_000, 100_000, 250_000, 500_000],
      slots: [10_000, 20_000, 50_000, 100_000, 200_000, 500_000],
      video_poker: [10_000, 25_000, 50_000, 100_000],
    },
    host: 'SIBILA',
    hostRole: 'IA soberana del Sindicato',
    card: 'Llave biométrica del Olimpo',
    theme: 'gold',
    mood: 'penthouse',
    tension: 0.5,
  },
];

// Cada piso conoce también todas sus mesas (las suyas y las de los pisos inferiores).
export const FLOORS = Object.freeze(BASE_FLOORS.map((def, index) => floor({
  ...def,
  games: BASE_FLOORS.slice(0, index + 1).flatMap((item) => item.unlocks),
  next: BASE_FLOORS[index + 1]?.unlockAt ?? GOAL,
})));

export const floorById = (id) => FLOORS.find((item) => item.id === id) ?? FLOORS[0];
export const floorByLevel = (level) => FLOORS[Math.min(FLOORS.length, Math.max(1, Math.trunc(level) || 1)) - 1];
export const isFloorId = (id) => FLOORS.some((item) => item.id === id);

// Piso en el que se abre cada mesa.
export const gameFloor = (game) => FLOORS.find((item) => item.unlocks.includes(game)) ?? null;

// Piso más alto cuya tarjeta se consigue con ese saldo.
export function floorForBalance(balance) {
  let found = FLOORS[0];
  for (const item of FLOORS) if (balance >= item.unlockAt) found = item;
  return found;
}

const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback);

// Límites de una mesa en un piso. Las mesas de importes libres reciben min/max; las de importes
// fijos, su lista; blackjack y ruleta, sus límites de mesa.
export function limitsFor(floorOrId, game) {
  const f = typeof floorOrId === 'string' ? floorById(floorOrId) : floorOrId;
  const base = { minBet: f.minBet, maxBet: f.maxBet, chips: f.chips, zone: f.id, floor: f.level, scale: f.scale };
  switch (game) {
    case 'blackjack':
      return { ...base, seats: 3, sideBets: true, maxMain: f.maxBet, maxSide: f.maxBet };
    case 'roulette':
      return { ...base, racetrack: true, spotMax: f.maxBet, tableMax: f.maxBet };
    case 'slots':
      return { ...base, bets: f.lists.slots ?? FLOORS[1].lists.slots, bonusBuy: true };
    case 'plinko':
      return { ...base, bets: f.lists.plinko ?? FLOORS[1].lists.plinko };
    case 'fish':
      return { ...base, bullets: f.lists.fish ?? FLOORS[1].lists.fish };
    case 'video_poker':
      return { ...base, coins: f.lists.video_poker ?? FLOORS[2].lists.video_poker };
    default:
      return { ...base };
  }
}

// Texto de un rango de apuestas («de 50 a 1.000» o «desde 10.000, sin límite»).
export function rangeText(f, format = (value) => String(value)) {
  return Number.isFinite(f.maxBet) ? `de ${format(f.minBet)} a ${format(f.maxBet)}` : `desde ${format(f.minBet)}, sin límite`;
}

// Mayor apuesta permitida con un saldo: el límite del piso o, sin límite, el propio saldo.
export const maxStake = (f, balance) => Math.min(finiteOr(f.maxBet, Infinity), Math.max(0, Math.floor(balance)));

// Progreso visual hacia la meta: cada piso ocupa un cuarto de la barra y dentro de él el avance
// es logarítmico (de 10 a 10.000 en el Subsuelo y ×10 en cada piso siguiente).
export function goalProgress(balance) {
  if (!(balance > START_BALANCE)) return 0;
  const segment = 1 / FLOORS.length;
  let total = 0;
  for (const item of FLOORS) {
    const from = item.level === 1 ? START_BALANCE : item.unlockAt;
    const to = item.next;
    if (balance >= to) {
      total += segment;
      continue;
    }
    total += segment * Math.max(0, Math.log(balance / from) / Math.log(to / from));
    break;
  }
  return Math.min(1, total);
}
