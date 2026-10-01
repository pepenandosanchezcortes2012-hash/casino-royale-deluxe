// Simulación de la economía de «The Syndicate Climb» con el núcleo real (js/climb), la carrera
// real (misiones y niveles) y el motor real de las slots:
//   node tools/simulate-climb.mjs [escaladas=120] [horas de juego máximas=60] [estilo]
// Estilos: prudent (apuesta mínima del piso), moderate (2 % del saldo) y bold (8 % del saldo).
// Cada jugador persigue el encargo más barato del tablero con la mesa adecuada, sube al piso más
// alto que su saldo aguanta (40/25/15 apuestas mínimas según el estilo), baja si se queda corto,
// cobra la abundancia por minuto de juego activo y pide limosna al quedarse a cero (esperando el
// enfriamiento si hace falta). Juega sesiones de 2 horas al día (las misiones y la rueda se
// renuevan cada día). Las reliquias no se simulan (resultado conservador). Semillas fijas.

import { Climb } from '../js/climb/climb.js';
import { FLOORS, GOAL, floorByLevel } from '../js/climb/floors.js';
import { Progression } from '../js/progression.js';
import { playSpin, playFreeSpinsRound } from '../js/games/slots-engine.js';
import { RISKS, bucketDistribution } from '../js/games/plinko-math.js';
import { secondsFor } from '../js/games/crash-math.js';
import { WHEEL_SLICES } from '../js/games/wheel-math.js';

const RUNS = Number(process.argv[2] ?? 120);
const MAX_HOURS = Number(process.argv[3] ?? 60);
const SHARE = { prudent: 0, moderate: 0.02, bold: 0.08 };
const STAY = { prudent: 40, moderate: 25, bold: 15 };
const STYLES = process.argv[4] ? [process.argv[4]] : Object.keys(SHARE);
const SESSION_S = 2 * 3600;
const ABUNDANCE_S = 60;

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let next = mulberry32(1);
const rand = (n) => Math.floor(next() * n);

function memoryStore() {
  const map = new Map();
  return {
    read: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    write: (key, value) => map.set(key, JSON.stringify(value)),
    remove: (key) => map.delete(key),
  };
}

function fakeWallet() {
  return {
    balance: 10,
    inPlay: 0,
    grant(amount) {
      this.balance += amount;
      return amount;
    },
    reset() {
      this.balance = 10;
    },
  };
}

// ---------- Mesas (resultados exactos o con su distribución publicada) ----------

const PLINKO_HIGH = bucketDistribution('high');
const VP = [
  [800, 0.0000248, 'vp-royal'], [50, 0.000109, 'vp-straightFlush'], [25, 0.002363, 'vp-fourKind'], [9, 0.011512, 'vp-fullHouse'],
  [6, 0.011015, 'vp-flush'], [4, 0.011229, 'vp-straight'], [3, 0.074449, 'vp-threeKind'], [2, 0.129279, 'vp-twoPair'], [1, 0.214585, 'vp-jacks'],
];

function dice(stake, chance) {
  const mult = Math.floor((98 / chance) * 10000) / 10000;
  const win = next() * 100 < chance;
  return { game: 'dice', stake, returned: win ? stake * mult : 0, chance, tags: [], seconds: 1.5 };
}

function mines(stake, target) {
  const win = next() < 0.97 / target;
  return { game: 'mines', stake, returned: win ? stake * target : 0, safe: win ? 4 : 1, tags: win ? ['mines-cashout'] : [], seconds: 2.5 };
}

function towers(stake, floors) {
  let climbed = 0;
  while (climbed < floors && next() < 2 / 3) climbed++;
  const win = climbed === floors;
  const mult = Math.floor((0.97 / (2 / 3) ** floors) * 100) / 100;
  return { game: 'towers', stake, returned: win ? stake * mult : 0, safe: climbed, tags: win && floors === 8 ? ['towers-top'] : [], seconds: 1 + 0.8 * climbed };
}

function plinko(stake) {
  let roll = next();
  let bucket = 0;
  while (bucket < 8 && roll >= PLINKO_HIGH[bucket]) roll -= PLINKO_HIGH[bucket++];
  return { game: 'plinko', stake, returned: stake * RISKS.high.multipliers[bucket], tags: ['plinko-high'], seconds: 0.5 };
}

function crash(stake, target) {
  const win = next() < 0.97 / target;
  return { game: 'crash', stake, returned: win ? stake * target : 0, tags: [], seconds: 3 + secondsFor(target) };
}

// Ráfaga de Cyber-Fish: `shots` balas contra una criatura de multiplicador m.
function fish(bullet, m, shots = 12) {
  let returned = 0;
  let captures = 0;
  let bigCatches = 0;
  const tags = [];
  for (let i = 0; i < shots; i++) {
    if (next() < 0.96 / m) {
      returned += bullet * m;
      captures++;
      if (m >= 8) bigCatches++;
      if (m === 60) tags.push('fish-shark');
      if (m >= 150) tags.push('fish-kraken');
    }
  }
  return { game: 'fish', stake: bullet * shots, returned, captures, bigCatches, tags: [...new Set(tags)], seconds: Math.max(2.5, shots * 0.25) };
}

function roulette(stake, mode) {
  const n = rand(37);
  const tags = [];
  let returned = 0;
  if (mode === 'straight' && n === 17) {
    returned = stake * 36;
    tags.push('straight');
  } else if (mode === 'dozen' && n >= 1 && n <= 12) {
    returned = stake * 3;
    tags.push('dozen');
  } else if (mode === 'voisins' && [22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25].includes(n)) {
    const unit = stake / 9;
    returned = unit * ([0, 2, 3].includes(n) ? 24 : [25, 26, 28, 29].includes(n) ? 18 : 36);
    tags.push('call-win');
  }
  return { game: 'roulette', stake, returned, tags, seconds: 7 };
}

function videoPoker(stake) {
  let roll = next();
  for (const [pays, p, tag] of VP) {
    if (roll < p) return { game: 'video_poker', stake, returned: stake * pays, tags: [tag], seconds: 4 };
    roll -= p;
  }
  return { game: 'video_poker', stake, returned: 0, tags: [], seconds: 4 };
}

function blackjack(stake, side) {
  const r = next();
  const tags = [];
  let total = stake + side;
  let returned = 0;
  if (r < 0.0475) {
    returned = stake * 2.5;
    tags.push('natural');
  } else if (r < 0.1025) {
    returned = stake * 4;
    total += stake;
    tags.push('double-win');
  } else if (r < 0.1145) {
    returned = stake * 4;
    total += stake;
    tags.push('split-win');
  } else if (r < 0.414) returned = stake * 2;
  else if (r < 0.499) returned = stake;
  if (side && rand(311) < 23) {
    returned += side * 8;
    tags.push('side-win');
  }
  return { game: 'blackjack', stake: total, returned, tags, seconds: 8 };
}

let slotState = { sticky: [] };
function slots(stake) {
  const spin = playSpin({ bet: stake, rand, sticky: slotState.sticky });
  slotState.sticky = spin.sticky;
  let returned = spin.total;
  const tags = [];
  if (spin.steps.length >= 2) tags.push('cascade2');
  if (spin.steps.length >= 3) tags.push('cascade3');
  let seconds = 2;
  if (spin.freeSpins) {
    tags.push('freespins');
    const bonus = playFreeSpinsRound({ bet: stake, spins: spin.freeSpins, rand, sticky: slotState.sticky });
    returned += bonus.total;
    slotState.sticky = bonus.sticky;
    seconds += 16;
  }
  return { game: 'slots', stake, returned, tags, seconds };
}

// ---------- Estrategia ----------

const pickBullet = (floor, stake) => {
  const list = floor.lists.fish;
  const fit = list.filter((v) => v <= stake);
  return fit.length ? fit[fit.length - 1] : list[0];
};
const pickFrom = (list, stake) => {
  const fit = list.filter((v) => v <= stake);
  return fit.length ? fit[fit.length - 1] : list[0];
};

// Acción para un encargo con una apuesta `stake` (ya dentro de los límites del piso).
function actionFor(type, floor, stake) {
  switch (type) {
    case 'wins':
    case 'streak':
      return () => dice(stake, 49);
    case 'wins3':
      return () => dice(stake, 32);
    case 'big5':
      return () => dice(stake, 19);
    case 'big10':
    case 'dice-sniper':
      return () => dice(stake, 9);
    case 'big25':
      return () => dice(stake, 3);
    case 'mines-deep':
      return () => mines(stake, 5);
    case 'tower-top':
      return () => towers(stake, 8);
    case 'fish-big':
      return () => fish(pickBullet(floor, stake / 12), 8);
    case 'fish-shark':
      return () => fish(pickBullet(floor, stake / 12), 60);
    case 'fish-kraken':
      return () => {
        const r = fish(pickBullet(floor, stake / 12), 300);
        r.seconds *= 1.9;
        return r;
      };
    case 'plinko-edge':
      return () => plinko(pickFrom(floor.lists.plinko, stake));
    case 'cascade':
    case 'free-spins':
      return () => slots(pickFrom(floor.lists.slots, stake));
    case 'crash-3':
      return () => crash(stake, 3);
    case 'straight':
      return () => roulette(stake, 'straight');
    case 'dozen':
      return () => roulette(stake, 'dozen');
    case 'call':
      return () => roulette(Math.max(stake, floor.minBet * 9), 'voisins');
    case 'vp-trips':
      return () => videoPoker(pickFrom(floor.lists.video_poker, stake / 5) * 5);
    case 'side':
      return () => blackjack(stake, floor.minBet);
    default:
      return () => blackjack(stake, 0);
  }
}

// Rondas que cuesta cada encargo por la vía elegida (para atacar primero el más barato).
const COST = {
  wins: 6, wins3: 6, big5: 5, big10: 10, 'dice-sniper': 10, big25: 33, streak: 15, 'mines-deep': 5, 'tower-top': 26,
  'fish-big': 3, 'fish-shark': 6, 'fish-kraken': 50, 'plinko-edge': 26, cascade: 12, 'free-spins': 268,
  'crash-3': 6, straight: 37, dozen: 6, call: 3, 'vp-trips': 9, natural: 21, double: 18, split: 83, side: 14,
};

function simulate(style) {
  const out = { wins: 0, hours: [], rounds: [], rescues: 0, waits: 0, reached: [0, 0, 0, 0], floorHours: [[], [], [], []], busted: 0, income: { contracts: 0, career: 0, abundance: 0, wheel: 0, tables: 0 } };
  for (let run = 0; run < RUNS; run++) {
    next = mulberry32(5000 + run);
    slotState = { sticky: [] };
    const store = memoryStore();
    const wallet = fakeWallet();
    const clock = { t: Date.UTC(2026, 9, 1, 8) };
    const now = () => clock.t;
    const climb = new Climb({ wallet, store, rand, now });
    const progression = new Progression({
      store,
      now,
      scale: () => climb.unlockedFloor.scale,
      minStake: () => climb.unlockedFloor.minBet,
      games: () => climb.unlockedFloor.games,
    });
    climb.begin();
    let played = 0;
    let session = 0;
    let rounds = 0;
    let abundance = 0;
    let active = false;
    let wheelDay = -1;
    let reachedAt = [0, null, null, null];
    let wentBroke = false;
    const advance = (seconds) => {
      played += seconds;
      session += seconds;
      clock.t += seconds * 1000;
      abundance += seconds;
      if (abundance >= ABUNDANCE_S) {
        abundance -= ABUNDANCE_S;
        if (active) {
          const amount = (50 + progression.rank.abundance) * climb.unlockedFloor.scale;
          wallet.grant(amount);
          out.income.abundance += amount;
        }
        active = false;
      }
      if (session >= SESSION_S) {
        session = 0;
        const d = new Date(clock.t);
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(8, 0, 0, 0);
        clock.t = d.getTime();
      }
    };
    while (played < MAX_HOURS * 3600 && climb.status === 'playing') {
      // Ascensor: el piso más alto que el saldo aguanta; si no llega ni al actual, baja.
      for (let level = climb.unlockedLevel; level >= 1; level--) {
        const f = floorByLevel(level);
        if (wallet.balance >= STAY[style] * f.minBet || level === 1) {
          if (climb.floor.id !== f.id) climb.travel(f.id);
          break;
        }
      }
      const floor = climb.floor;
      if (reachedAt[floor.level - 1] === null) reachedAt[floor.level - 1] = played;
      // Rueda legendaria: una tirada al día en el Olimpo.
      const day = Math.floor(clock.t / 86_400_000);
      if (floor.level === 4 && wheelDay !== day) {
        wheelDay = day;
        const weights = WHEEL_SLICES.map((s) => s.weight);
        let roll = rand(weights.reduce((a, b) => a + b, 0));
        let slice = WHEEL_SLICES[0];
        for (let i = 0; i < weights.length; i++) {
          if (roll < weights[i]) {
            slice = WHEEL_SLICES[i];
            break;
          }
          roll -= weights[i];
        }
        if (slice.type === 'chips') {
          wallet.grant(slice.amount);
          out.income.wheel += slice.amount;
        }
        progression.addRound({ game: 'wheel', stake: 0, returned: slice.type === 'chips' ? slice.amount : 0, tags: ['wheel'] });
      }
      if (wallet.balance < floor.minBet) {
        if (floor.level > 1) {
          climb.travel('subsuelo');
          continue;
        }
        climb.checkEnd();
        const status = climb.rescueStatus();
        if (status.broke) {
          wentBroke = true;
          if (!status.available) {
            out.waits += status.wait / 60000;
            clock.t += status.wait;
          }
          climb.takeRescue();
          out.rescues++;
          continue;
        }
      }
      const contracts = climb.contracts.sort((a, b) => (COST[a.type] ?? 20) * (a.goal - a.progress) / a.goal - (COST[b.type] ?? 20) * (b.goal - b.progress) / b.goal);
      const target = contracts[0];
      let stake = Math.max(floor.minBet, Math.floor(wallet.balance * SHARE[style]));
      stake = Math.min(stake, Number.isFinite(floor.maxBet) ? floor.maxBet : Infinity, Math.floor(wallet.balance));
      if (stake < floor.minBet) stake = floor.minBet;
      const round = actionFor(target?.type, floor, stake)();
      if (round.stake > wallet.balance + 1e-9) {
        // No alcanza para la acción completa: juega dados con lo que pueda.
        const fallback = dice(Math.min(floor.maxBet, Math.max(floor.minBet, Math.floor(wallet.balance))), 49);
        if (fallback.stake > wallet.balance) {
          climb.travel('subsuelo');
          continue;
        }
        Object.assign(round, fallback);
      }
      wallet.balance += round.returned - round.stake;
      out.income.tables += round.returned - round.stake;
      climb.report(round);
      const info = { ...round, mode: 'climb', minBet: floor.minBet };
      progression.addRound(info);
      const chips = progression.collectChips();
      if (chips > 0) {
        wallet.grant(chips);
        out.income.career += chips;
      }
      if (round.stake >= climb.unlockedFloor.minBet) active = true;
      climb.checkEnd();
      rounds++;
      advance(round.seconds);
    }
    out.income.contracts += climb.state.stats.rewards;
    if (climb.status === 'victory') {
      out.wins++;
      out.hours.push(played / 3600);
      out.rounds.push(rounds);
    }
    if (wentBroke) out.busted++;
    reachedAt.forEach((at, i) => {
      if (at !== null) {
        out.reached[i]++;
        const nextAt = reachedAt[i + 1] ?? (climb.status === 'victory' ? played : null);
        if (nextAt !== null && nextAt !== undefined) out.floorHours[i].push((nextAt - at) / 3600);
      }
    });
  }
  const median = (list) => (list.length ? list.sort((a, b) => a - b)[Math.floor(list.length / 2)] : null);
  const p90 = (list) => (list.length ? list.sort((a, b) => a - b)[Math.floor(list.length * 0.9)] : null);
  const pct = (n) => `${((n / RUNS) * 100).toFixed(0)} %`;
  const h = (value) => (value === null ? '—' : `${value.toFixed(1)} h`);
  return {
    estilo: style,
    victoria: pct(out.wins),
    'horas (mediana)': h(median(out.hours)),
    'horas (p90)': h(p90(out.hours)),
    'rondas (mediana)': median(out.rounds) ?? '—',
    'Piso 2': pct(out.reached[1]),
    'Piso 3': pct(out.reached[2]),
    'Piso 4': pct(out.reached[3]),
    'h Piso 1→2': h(median(out.floorHours[0])),
    'h Piso 2→3': h(median(out.floorHours[1])),
    'h Piso 3→4': h(median(out.floorHours[2])),
    'h Piso 4→meta': h(median(out.floorHours[3])),
    'limosnas medias': (out.rescues / RUNS).toFixed(1),
    'en bancarrota': pct(out.busted),
    ingresos: Object.entries(out.income).map(([k, v]) => `${k} ${(v / RUNS / 1e6).toFixed(2)}M`).join(' · '),
  };
}

console.log(`${RUNS} escaladas por estilo, máximo ${MAX_HOURS} horas de juego cada una (sesiones de 2 h al día)`);
for (const row of STYLES.map(simulate)) {
  console.log(`
${row.estilo}`);
  for (const [key, value] of Object.entries(row)) if (key !== 'estilo') console.log(`  ${key.padEnd(18)} ${value}`);
}
process.exit(0);
