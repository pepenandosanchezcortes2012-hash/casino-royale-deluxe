// Simulación de la economía de «El Último Crédito» con el núcleo real de campaña (js/story) y el
// motor real de las slots. Reproduce la tabla del README:
//   node tools/simulate-economy.mjs [leyendas=200] [rondas máximas=6000] [estilo]
// Estilos: cautious (apuesta mínima), moderate (3 % del saldo) y bold (10 % del saldo).
// Cada leyenda es la primera de un jugador nuevo (Club VIP en Bronce): cobra el bono diario al
// empezar, persigue el encargo mejor pagado por esfuerzo (el de menor recompensa, que es el más
// rápido), sube de zona en cuanto puede y, al quedarse sin saldo, usa el rescate VIP y después
// los favores del Sindicato. Ruleta y slots son exactas; el blackjack usa la distribución de
// resultados de la estrategia básica (6 barajas, S17). Semillas fijas: resultados reproducibles.

import { Campaign } from '../js/story/campaign.js';
import { VipClub } from '../js/engine/vip.js';
import { ZONES } from '../js/story/zones.js';
import { playSpin, playFreeSpinsRound } from '../js/games/slots-engine.js';

const RUNS = Number(process.argv[2] ?? 200);
const MAX_ROUNDS = Number(process.argv[3] ?? 6000);
const SHARE = { cautious: 0, moderate: 0.03, bold: 0.1 };
const STYLES = process.argv[4] ? [process.argv[4]] : Object.keys(SHARE);
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const VOISINS = new Set([22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25]);

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

let next = mulberry32(1);
const rand = (n) => Math.floor((next() / 4294967296) * n);

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
    balance: 1,
    inPlay: 0,
    grant(amount) {
      this.balance += amount;
      return amount;
    },
    reset() {
      this.balance = 1;
    },
  };
}

function betSize(style, zone, balance, game) {
  const max = game === 'blackjack' ? zone.blackjack.maxMain : game === 'roulette' ? zone.roulette.spotMax : Math.max(...zone.slots.bets);
  let want = Math.max(zone.minBet, Math.floor(balance * SHARE[style]));
  want = Math.min(want, max, Math.floor(balance));
  if (game === 'slots') {
    want = Math.max(want, zone.slots.bets[0]);
    const steps = zone.slots.bets.filter((bet) => bet <= Math.min(want, balance));
    return steps.length ? steps[steps.length - 1] : 0;
  }
  return want >= zone.minBet ? want : 0;
}

function gameFor(type) {
  switch (type) {
    case 'bj-wins':
    case 'natural':
    case 'double':
    case 'split':
    case 'side':
      return { game: 'blackjack' };
    case 'slot-wins':
    case 'cascade':
    case 'free-spins':
    case 'big-win':
      return { game: 'slots' };
    case 'dozen':
      return { game: 'roulette', mode: 'dozen' };
    case 'straight':
      return { game: 'roulette', mode: 'straight' };
    case 'call':
      return { game: 'roulette', mode: 'voisins' };
    default:
      return { game: 'roulette', mode: 'red' };
  }
}

function playRound(style, campaign, wallet) {
  const zone = campaign.zone;
  const target = campaign.contracts.sort((a, b) => a.reward - b.reward)[0];
  const { game, mode } = gameFor(target?.type);
  const bet = betSize(style, zone, wallet.balance, game);
  if (bet <= 0) return;
  let stake = bet;
  let returned = 0;
  const tags = [];

  if (game === 'roulette') {
    const n = rand(37);
    if (mode === 'red' && RED.has(n)) {
      returned = bet * 2;
      tags.push('outside');
    } else if (mode === 'dozen' && n >= 1 && n <= 12) {
      returned = bet * 3;
      tags.push('dozen');
    } else if (mode === 'straight' && n === 17) {
      returned = bet * 36;
      tags.push('straight');
    } else if (mode === 'voisins') {
      // Voisins du Zéro: 9 unidades sobre 17 números.
      const unit = Math.max(zone.minBet, Math.floor(bet / 9));
      stake = unit * 9;
      if (stake > wallet.balance) return;
      if (VOISINS.has(n)) {
        returned = unit * ([0, 2, 3].includes(n) ? 24 : [25, 26, 28, 29].includes(n) ? 18 : 36);
        tags.push('call-win');
      }
    }
  } else if (game === 'blackjack') {
    const r = next() / 4294967296;
    let side = 0;
    if (target?.type === 'side' && zone.blackjack.sideBets) {
      side = zone.minBet;
      stake += side;
    }
    if (stake > wallet.balance) return;
    if (r < 0.0475) {
      returned += bet * 2.5;
      tags.push('natural');
    } else if (r < 0.1025) {
      returned += bet * 4;
      tags.push('double-win');
      stake += bet;
      if (stake > wallet.balance) {
        stake -= bet;
        returned = bet * 2;
      }
    } else if (r < 0.1145) {
      returned += bet * 4;
      tags.push('split-win');
      stake += bet;
      if (stake > wallet.balance) {
        stake -= bet;
        returned = bet * 2;
      }
    } else if (r < 0.414) {
      returned += bet * 2;
    } else if (r < 0.499) {
      returned += bet;
    }
    if (side && rand(311) < 23) {
      returned += side * 8;
      tags.push('side-win');
    }
  } else {
    const spin = playSpin({ bet, rand });
    returned = spin.total;
    if (spin.steps.length >= 2) tags.push('cascade2');
    if (spin.steps.length >= 3) tags.push('cascade3');
    if (spin.steps.some((step) => step.lines.some((line) => line.count === 4))) tags.push('super');
    if (spin.freeSpins) {
      tags.push('freespins');
      returned += playFreeSpinsRound({ bet, spins: spin.freeSpins, rand }).total;
    }
  }
  wallet.balance += returned - stake;
  campaign.report({ game, stake, returned, tags });
}

function climb(campaign) {
  for (let i = ZONES.length - 1; i > 0; i--) {
    const id = ZONES[i].id;
    if (ZONES.indexOf(campaign.zone) < i && campaign.travelStatus(id).ok) {
      campaign.travel(id);
      return;
    }
  }
}

function simulate(style) {
  let victories = 0;
  let gameOvers = 0;
  let penthouse = 0;
  let favors = 0;
  let rescues = 0;
  const roundsToWin = [];
  for (let run = 0; run < RUNS; run++) {
    next = mulberry32(1000 + run);
    const wallet = fakeWallet();
    const store = memoryStore();
    const vip = new VipClub({ store, now: () => 0 });
    const campaign = new Campaign({ wallet, vip, store, rand, now: () => 0 });
    campaign.begin();
    campaign.claimDaily();
    let rounds = 0;
    let reached = false;
    while (rounds < MAX_ROUNDS && campaign.status === 'playing') {
      climb(campaign);
      if (campaign.zone.id === 'penthouse') reached = true;
      playRound(style, campaign, wallet);
      campaign.checkEnd();
      if (campaign.lifelines().rescue.available) campaign.takeRescue();
      else if (campaign.favorStatus().available) campaign.takeFavor();
      rounds++;
    }
    if (campaign.status === 'victory') {
      victories++;
      roundsToWin.push(rounds);
    } else if (campaign.status === 'gameover') {
      gameOvers++;
    }
    if (reached) penthouse++;
    favors += campaign.state.stats.favorsUsed;
    rescues += campaign.state.stats.vipRescues;
  }
  roundsToWin.sort((a, b) => a - b);
  const pct = (count) => `${((count / RUNS) * 100).toFixed(1)} %`;
  return {
    estilo: style,
    victoria: pct(victories),
    'game over': pct(gameOvers),
    'sin terminar': pct(RUNS - victories - gameOvers),
    'rondas (mediana)': roundsToWin[Math.floor(roundsToWin.length / 2)] ?? '—',
    'rondas (p90)': roundsToWin[Math.floor(roundsToWin.length * 0.9)] ?? '—',
    penthouse: pct(penthouse),
    'rescates VIP medios': (rescues / RUNS).toFixed(2),
    'favores medios': (favors / RUNS).toFixed(2),
  };
}

console.log(`${RUNS} leyendas por estilo, máximo ${MAX_ROUNDS} rondas cada una`);
console.table(STYLES.map(simulate));
// Los avisos diferidos de la campaña (setTimeout) no afectan al resultado.
process.exit(0);
