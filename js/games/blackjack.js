// Blackjack multimano (Las Vegas Strip): hasta 3 asientos con apuesta principal, Perfect Pairs
// y 21+3 independientes; zapato de 6 barajas con corte al 75 %, BJ 3:2, S17, peek, seguro 2:1
// por asiento, doblar y dividir por mano. Modo didáctico: coach de estrategia básica y
// entrenador de conteo Hi-Lo (Running Count y True Count).

import { Store, PHASE, wait } from '../engine/store.js';
import { wallet, money } from '../engine/wallet.js';
import { session } from '../session.js';
import { scopedKey } from '../mode.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { hud, formatChips } from '../ui/hud.js';
import { cardElement, setCardFaceUp, chipStack, el } from '../ui/svg.js';
import { bindRemoveGesture } from '../ui/input.js';
import { settings } from '../settings.js';
import { relics, DADO_CHANCE } from '../relics.js';
import {
  SHOE_SIZE, CUT_CARD, buildShoe, rankOf, cardValue, handValue, isBlackjack, isNatural,
  dealerShouldHit, canSplitHand, canDoubleHand, settleHand, perfectPairsResult, twentyOnePlusThreeResult,
  basicStrategy, hiLoValue, trueCount, INSURANCE_TRUE_COUNT, SIDE_BET_HOUSE_EDGE,
} from './blackjack-rules.js';

export * from './blackjack-rules.js';

export const SEATS = 3;

const SAVE_KEY = scopedKey('crd.blackjack.v2');
const LEGACY_KEY = 'crd.blackjack.v1';
const PREFS_KEY = scopedKey('crd.blackjack.prefs.v1');
const DEAL_STEP = 360;
const TURBO_DEAL_STEP = 150;
const FLIP_TIME = 560;
// Ritmo del reparto: en turbo, una carta cada 150 ms y volteos a mitad de tiempo.
const dealStep = () => (settings.turbo ? TURBO_DEAL_STEP : DEAL_STEP);
const flipTime = () => FLIP_TIME * settings.speed;

// Zapato nuevo de 6 barajas. En el Cripto-Casino se baraja con el flujo provably fair (un nonce
// por zapato, anotado en el historial para verificarlo); en el Modo Historia, con crypto directo.
function freshShoe() {
  const stream = session.stream('blackjack');
  const shoe = stream.shuffle(buildShoe());
  session.record(stream, { stake: 0, payout: 0, summary: 'Zapato nuevo · 6 barajas barajadas', params: { kind: 'shoe' } });
  return { shoe, shoeMeta: stream.meta ?? null };
}
const SPOTS = ['pp', 'main', 't213'];
const SPOT_NAMES = { main: 'Apuesta principal', pp: 'Perfect Pairs', t213: '21+3' };
const ACTION_NAMES = { hit: 'Pedir', stand: 'Plantarse', double: 'Doblar', split: 'Dividir' };
const RESULT_TEXT = { blackjack: 'BLACKJACK', win: 'GANA', lose: 'PIERDE', push: 'EMPATE', bust: 'SE PASA' };

const emptySeats = () => Array.from({ length: SEATS }, () => ({ main: 0, pp: 0, t213: 0 }));
const seatStake = (seat) => seat.main + seat.pp + seat.t213;
const seatsTotal = (seats) => money(seats.reduce((sum, seat) => sum + seatStake(seat), 0));

function newHand(seat, bet, extra = {}) {
  return { seat, cards: [], bet, doubled: false, done: false, fromSplit: false, splitAces: false, result: null, payout: 0, ...extra };
}

function freshRound() {
  return {
    hands: [],
    active: -1,
    dealer: [],
    dealerFinal: null,
    holeRevealed: false,
    insurance: [0, 0, 0],
    insuranceSeat: -1,
    insurancePaid: null,
    sides: null,
  };
}

function initialState() {
  return {
    phase: PHASE.IDLE,
    busy: false,
    stage: 'bet',
    ...freshShoe(),
    pos: 0,
    roundFrom: 0,
    seats: emptySeats(),
    lastSeats: emptySeats(),
    message: 'Toca el círculo de apuesta para jugar',
    ...freshRound(),
  };
}

const isSeatList = (list) => Array.isArray(list) && list.length === SEATS &&
  list.every((seat) => seat && SPOTS.every((spot) => typeof seat[spot] === 'number' && seat[spot] >= 0));

function isValidSave(s) {
  return (
    s && typeof s === 'object' &&
    Object.values(PHASE).includes(s.phase) &&
    Array.isArray(s.shoe) && s.shoe.length === SHOE_SIZE && s.shoe.every((c) => typeof c === 'string') &&
    Number.isInteger(s.pos) && s.pos >= 0 && s.pos <= SHOE_SIZE &&
    isSeatList(s.seats) && isSeatList(s.lastSeats) &&
    Array.isArray(s.hands) && s.hands.every((h) => h && Number.isInteger(h.seat) && h.seat >= 0 && h.seat < SEATS && Array.isArray(h.cards) && typeof h.bet === 'number') &&
    Array.isArray(s.dealer) && Array.isArray(s.insurance) && s.insurance.length === SEATS
  );
}

function loadPrefs() {
  const saved = storage.read(PREFS_KEY, null) ?? {};
  return {
    coach: saved.coach === true,
    count: saved.count === true,
    right: Number.isInteger(saved.right) && saved.right >= 0 ? saved.right : 0,
    total: Number.isInteger(saved.total) && saved.total >= 0 ? saved.total : 0,
  };
}

const signed = (value) => (value > 0 ? `+${value}` : String(value));

export class BlackjackGame {
  #store;
  #dom;
  #view = { dealer: [], seats: [] };
  #clock = 0;
  #instant = true;
  #prefs = loadPrefs();
  #feedback = '';
  #countTimer = 0;

  constructor(root) {
    this.root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      table: $('bj-table'),
      shoe: $('bj-shoe'),
      shoeFill: $('bj-shoe-fill'),
      shoeCount: $('bj-shoe-count'),
      count: $('bj-count'),
      countRunning: $('bj-count-running'),
      countTrue: $('bj-count-true'),
      countDecks: $('bj-count-decks'),
      dealerCards: $('bj-dealer-cards'),
      dealerTotal: $('bj-dealer-total'),
      seats: $('bj-seats'),
      message: $('bj-message'),
      coach: $('bj-coach'),
      coachTip: $('bj-coach-tip'),
      coachFeedback: $('bj-coach-feedback'),
      coachScore: $('bj-coach-score'),
      coachToggle: $('bj-coach-toggle'),
      countToggle: $('bj-count-toggle'),
      clear: $('bj-clear'),
      rebet: $('bj-rebet'),
      deal: $('bj-deal'),
      hit: $('bj-hit'),
      stand: $('bj-stand'),
      double: $('bj-double'),
      split: $('bj-split'),
      insureLabel: $('bj-insurance-label'),
      insureYes: $('bj-insure-yes'),
      insureNo: $('bj-insure-no'),
      rack: $('bj-rack'),
      edges: $('bj-side-edges'),
    };
    storage.remove(LEGACY_KEY);
    const pct = (value) => `${(value * 100).toFixed(2).replace('.', ',')} %`;
    this.#dom.edges.textContent = `Ventaja de la casa (6 barajas): Perfect Pairs ${pct(SIDE_BET_HOUSE_EDGE.perfectPairs)} · 21+3 ${pct(SIDE_BET_HOUSE_EDGE.twentyOnePlusThree)}`;

    this.#buildSeats();
    this.#store = new Store('blackjack', this.#restore());
    this.#store.subscribe((state) => {
      storage.write(SAVE_KEY, state);
      this.#render(state);
    });
    // Se guarda también el estado inicial: un zapato recién barajado no se vuelve a barajar
    // (ni gasta otro nonce verificable) solo por recargar la página.
    storage.write(SAVE_KEY, this.state);
    wallet.addEventListener('change', () => this.#renderControls(this.state));

    this.#bind();
    session.register('blackjack', {
      hasPendingPlay: () => this.state.phase === PHASE.DEALING || this.state.phase === PHASE.RESOLVING,
      onZone: () => this.#render(this.state),
    });
    this.#render(this.state);
    this.#instant = false;
    this.#resume();
  }

  // Límites de la zona actual: asientos, apuestas laterales, mínimo y máximos.
  #limits() {
    return session.limits('blackjack');
  }

  get state() {
    return this.#store.state;
  }

  #set(action, patch) {
    return this.#store.commit(action, patch);
  }

  // ---------- Persistencia y reanudación ----------

  #restore() {
    const saved = storage.read(SAVE_KEY, null);
    const escrow = wallet.escrowOf('blackjack');
    if (!isValidSave(saved)) {
      if (escrow > 0) wallet.refund('blackjack');
      return initialState();
    }
    const state = { ...saved, busy: false };
    if (state.phase === PHASE.IDLE || state.phase === PHASE.BETTING || state.phase === PHASE.PAYOUT) {
      if (escrow > 0) wallet.refund('blackjack');
      Object.assign(state, freshRound(), {
        phase: PHASE.IDLE,
        stage: 'bet',
        seats: emptySeats(),
        message: 'Toca el círculo de apuesta para jugar',
      });
    }
    return state;
  }

  #resume() {
    const s = this.state;
    if (s.phase === PHASE.DEALING) {
      if (s.stage === 'dealing') this.#afterInitialDeal();
      else if (s.stage === 'peek') this.#peek();
      else if (s.stage === 'player') this.#continuePlayer();
    } else if (s.phase === PHASE.RESOLVING) {
      this.#set('RESUME_RESOLVE', { dealer: s.dealerFinal ?? s.dealer, holeRevealed: true });
      this.#payout();
    }
  }

  // ---------- Construcción de asientos ----------

  #buildSeats() {
    for (let seat = 0; seat < SEATS; seat++) {
      const node = el('section', 'bj-seat');
      node.dataset.seat = String(seat);
      node.setAttribute('aria-label', `Asiento ${seat + 1}`);
      const hands = el('div', 'seat-hands');
      const sides = el('div', 'seat-sides');
      sides.setAttribute('aria-live', 'polite');
      const bets = el('div', 'seat-bets');
      const spots = {};
      for (const spot of SPOTS) {
        const button = el('button', `bet-spot is-${spot}`);
        button.type = 'button';
        button.dataset.seat = String(seat);
        button.dataset.spot = spot;
        const ring = el('span', 'bet-spot-ring');
        ring.setAttribute('aria-hidden', 'true');
        const label = el('span', 'bet-spot-label', spot === 'main' ? String(seat + 1) : spot === 'pp' ? 'PP' : '21+3');
        label.setAttribute('aria-hidden', 'true');
        const stack = el('span', 'bet-spot-stack');
        stack.setAttribute('aria-hidden', 'true');
        const amount = el('output', 'bet-spot-amount');
        button.append(ring, label, stack, amount);
        bets.append(button);
        spots[spot] = { button, stack, amount, shown: -1 };
      }
      node.append(hands, sides, bets, el('span', 'seat-lock', 'Reservado · Salón de Neón'));
      this.#dom.seats.append(node);
      this.#view.seats.push({ node, hands, sides, spots, handViews: [], sidesKey: '' });
    }
  }

  // ---------- Entrada ----------

  #bind() {
    const d = this.#dom;
    hud.mountRack(d.rack);
    d.seats.addEventListener('click', (event) => {
      const spot = event.target.closest('[data-spot]');
      if (spot) this.addChip(Number(spot.dataset.seat), spot.dataset.spot, hud.selectedChip);
    });
    bindRemoveGesture(d.seats, '[data-spot]', (spot) => this.removeChip(Number(spot.dataset.seat), spot.dataset.spot));
    d.clear.addEventListener('click', () => this.clearBets());
    d.rebet.addEventListener('click', () => this.rebet());
    d.deal.addEventListener('click', () => this.deal());
    d.hit.addEventListener('click', () => this.hit());
    d.stand.addEventListener('click', () => this.stand());
    d.double.addEventListener('click', () => this.double());
    d.split.addEventListener('click', () => this.split());
    d.insureYes.addEventListener('click', () => this.insurance(true));
    d.insureNo.addEventListener('click', () => this.insurance(false));
    d.coachToggle.addEventListener('click', () => this.#togglePref('coach'));
    d.countToggle.addEventListener('click', () => this.#togglePref('count'));
  }

  #togglePref(key) {
    this.#prefs[key] = !this.#prefs[key];
    storage.write(PREFS_KEY, this.#prefs);
    audio.click();
    this.#feedback = '';
    this.#render(this.state);
  }

  #canBet() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.BETTING || s.phase === PHASE.PAYOUT);
  }

  #canAct() {
    const s = this.state;
    return !s.busy && s.phase === PHASE.DEALING && s.stage === 'player';
  }

  #bettingSeats() {
    const s = this.state;
    return s.phase === PHASE.BETTING ? structuredClone(s.seats) : emptySeats();
  }

  #startBetting(action, seats, message) {
    const s = this.state;
    const reset = s.phase === PHASE.BETTING ? {} : { ...freshRound(), stage: 'bet' };
    this.#set(action, { ...reset, phase: PHASE.BETTING, seats, message });
  }

  addChip(seat, spot, value) {
    if (!this.#canBet() || !session.playable) return;
    const limits = this.#limits();
    if (seat >= limits.seats) {
      hud.toast('Asiento reservado: la mesa multimano se abre en el Salón de Neón', 'warn');
      return;
    }
    if (spot !== 'main' && !limits.sideBets) {
      hud.toast('Perfect Pairs y 21+3 se abren en el Salón de Neón', 'warn');
      return;
    }
    const seats = this.#bettingSeats();
    const target = seats[seat];
    if (spot !== 'main' && target.main <= 0) {
      hud.toast(`Coloca primero la apuesta principal del asiento ${seat + 1}`, 'warn');
      return;
    }
    const limit = spot === 'main' ? limits.maxMain : limits.maxSide;
    if (target[spot] + value > limit) {
      hud.toast(`Máximo en ${SPOT_NAMES[spot]}: ${formatChips(limit)}`, 'warn');
      return;
    }
    if (!wallet.hold('blackjack', value)) {
      hud.toast('Saldo insuficiente para esa ficha', 'warn');
      return;
    }
    audio.chip();
    target[spot] += value;
    this.#startBetting('ADD_CHIP', seats, `Asiento ${seat + 1} · ${SPOT_NAMES[spot]}: ${formatChips(target[spot])}`);
  }

  removeChip(seat, spot) {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    const seats = structuredClone(s.seats);
    const target = seats[seat];
    if (target[spot] <= 0) return;
    const amount = Math.min(hud.selectedChip, target[spot]);
    target[spot] = money(target[spot] - amount);
    let refund = amount;
    // Sin apuesta principal no puede haber apuestas laterales en el asiento.
    if (spot === 'main' && target.main <= 0) {
      refund += target.pp + target.t213;
      target.pp = 0;
      target.t213 = 0;
    }
    wallet.refund('blackjack', refund);
    audio.chip();
    const empty = seatsTotal(seats) === 0;
    this.#set('REMOVE_CHIP', {
      seats,
      phase: empty ? PHASE.IDLE : PHASE.BETTING,
      message: empty ? 'Toca el círculo de apuesta para jugar' : 'Ficha retirada',
    });
  }

  clearBets() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    wallet.refund('blackjack', seatsTotal(s.seats));
    audio.chip();
    this.#set('CLEAR_BETS', { phase: PHASE.IDLE, seats: emptySeats(), message: 'Apuestas retiradas' });
  }

  rebet() {
    const s = this.state;
    if (!this.#canBet() || s.phase === PHASE.BETTING || !session.playable) return;
    const total = seatsTotal(s.lastSeats);
    if (total <= 0) return;
    if (!this.#fitsLimits(s.lastSeats)) {
      hud.toast('Tu apuesta anterior no cabe en los límites de esta mesa', 'warn');
      return;
    }
    if (!wallet.hold('blackjack', total)) {
      hud.toast('Saldo insuficiente para repetir las apuestas', 'warn');
      return;
    }
    audio.chip();
    this.#startBetting('REBET', structuredClone(s.lastSeats), 'Apuestas anteriores repetidas: pulsa Repartir');
  }

  #fitsLimits(seats) {
    const limits = this.#limits();
    return seats.every((seat, i) => {
      if (seatStake(seat) === 0) return true;
      if (i >= limits.seats || seat.main < limits.minBet || seat.main > limits.maxMain) return false;
      if (!limits.sideBets) return seat.pp === 0 && seat.t213 === 0;
      return seat.pp <= limits.maxSide && seat.t213 <= limits.maxSide;
    });
  }

  // ---------- Reparto ----------

  #draw(target) {
    const s = this.state;
    let { shoe, pos, shoeMeta } = s;
    if (pos >= shoe.length) {
      ({ shoe, shoeMeta } = freshShoe());
      pos = 0;
    }
    const card = shoe[pos];
    const patch = { shoe, shoeMeta, pos: pos + 1 };
    if (target === 'dealer') {
      patch.dealer = [...s.dealer, card];
    } else {
      const hands = structuredClone(s.hands);
      hands[target].cards.push(card);
      patch.hands = hands;
    }
    this.#set('DRAW', patch);
    return card;
  }

  #dealDelay() {
    const now = performance.now();
    const start = Math.max(now, this.#clock);
    this.#clock = start + dealStep();
    return start - now;
  }

  #settleTime() {
    return Math.max(0, this.#clock - performance.now()) + flipTime();
  }

  async deal() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING || !session.playable) return;
    const { minBet } = this.#limits();
    const seatsInPlay = s.seats.map((seat, i) => (seat.main >= minBet ? i : -1)).filter((i) => i >= 0);
    if (!seatsInPlay.length) {
      hud.minBetNotice(minBet);
      return;
    }
    const reshuffle = s.pos >= CUT_CARD;
    const shoe = reshuffle ? freshShoe() : { shoe: s.shoe, shoeMeta: s.shoeMeta ?? null };
    this.#set('DEAL', {
      ...freshRound(),
      phase: PHASE.DEALING,
      stage: 'dealing',
      busy: true,
      ...shoe,
      pos: reshuffle ? 0 : s.pos,
      roundFrom: reshuffle ? 0 : s.pos,
      lastSeats: structuredClone(s.seats),
      hands: seatsInPlay.map((seat) => newHand(seat, s.seats[seat].main)),
      message: reshuffle ? 'Carta de corte alcanzada: barajando un zapato nuevo…' : 'Repartiendo…',
    });
    if (reshuffle) {
      audio.shuffle();
      this.#dom.shoe.classList.add('is-shuffling');
      setTimeout(() => this.#dom.shoe.classList.remove('is-shuffling'), 1300);
      this.#clock = performance.now() + 1300 * settings.speed;
    }
    session.beginRound({ game: 'blackjack', stake: seatsTotal(s.seats) });
    const order = this.state.hands.map((_, i) => i);
    for (const target of [...order, 'dealer', ...order, 'dealer']) this.#draw(target);
    await this.#afterInitialDeal();
  }

  async #afterInitialDeal() {
    this.#set('INITIAL_DEAL', { busy: true });
    await wait(this.#settleTime());
    this.#settleSides();
    const s = this.state;
    if (rankOf(s.dealer[0]) === 'A') {
      this.#offerInsurance(-1);
      return;
    }
    await this.#peek();
  }

  // Perfect Pairs y 21+3 se resuelven con las dos primeras cartas y la carta visible del crupier.
  #settleSides() {
    const s = this.state;
    if (s.sides) return;
    const up = s.dealer[0];
    let stake = 0;
    let payout = 0;
    const sides = s.seats.map((seat, i) => {
      const hand = s.hands.find((h) => h.seat === i);
      if (!hand) return null;
      const [first, second] = hand.cards;
      const bet = (amount, result) => {
        if (amount <= 0) return null;
        const paid = result ? amount * (result.pays + 1) : 0;
        stake += amount;
        payout += paid;
        return { amount, kind: result?.kind ?? null, name: result?.name ?? null, pays: result?.pays ?? 0, paid };
      };
      return { pp: bet(seat.pp, perfectPairsResult(first, second)), t213: bet(seat.t213, twentyOnePlusThreeResult(first, second, up)) };
    });
    if (stake > 0) {
      wallet.settle('blackjack', stake, payout);
      wallet.reveal('blackjack');
    }
    this.#set('SIDES', { sides });
    if (payout > 0) {
      const winners = sides.flatMap((side, i) => [side?.pp, side?.t213]
        .filter((bet) => bet && bet.paid > 0)
        .map((bet) => `Asiento ${i + 1}: ${bet.name} ${bet.pays}:1`));
      audio.chip();
      audio.win(payout >= stake * 20 ? 3 : 2);
      hud.toast(`Apuestas laterales: ${winners.join(' · ')} (+${formatChips(payout)})`, 'success', 4200);
      const rect = this.#dom.seats.getBoundingClientRect();
      hud.celebrate(payout >= stake * 20 ? 2 : 1, { x: rect.left + rect.width / 2, y: rect.top });
    }
  }

  #offerInsurance(afterSeat) {
    const s = this.state;
    const seats = [...new Set(s.hands.map((hand) => hand.seat))];
    const next = seats.find((seat) => seat > afterSeat);
    if (next === undefined) {
      this.#peek();
      return;
    }
    const hand = s.hands.find((h) => h.seat === next);
    const cost = money(hand.bet / 2);
    this.#set('OFFER_INSURANCE', {
      stage: 'insurance',
      insuranceSeat: next,
      busy: false,
      message: isNatural(hand)
        ? `Asiento ${next + 1}: ¡Blackjack! El seguro (${formatChips(cost)}) equivale a cobrar 1 a 1 ahora`
        : `Asiento ${next + 1}: el crupier muestra un As. ¿Seguro por ${formatChips(cost)}? Paga 2 a 1`,
    });
  }

  insurance(take) {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.DEALING || s.stage !== 'insurance') return;
    const seat = s.insuranceSeat;
    const hand = s.hands.find((h) => h.seat === seat);
    if (!hand) return;
    const advice = this.#insuranceAdvice(s);
    const insurance = [...s.insurance];
    if (take) {
      const cost = money(hand.bet / 2);
      if (!wallet.hold('blackjack', cost)) {
        hud.toast('Saldo insuficiente para el seguro', 'warn');
        return;
      }
      insurance[seat] = cost;
      audio.chip();
    }
    this.#score(take ? 'take' : 'decline', advice);
    this.#set('INSURANCE', { insurance, busy: true });
    this.#offerInsurance(seat);
  }

  // Dealer Peek: con As o carta de 10 visible el crupier revisa la oculta antes de que se juegue.
  async #peek() {
    this.#set('PEEK', { stage: 'peek', busy: true, insuranceSeat: -1 });
    const needsPeek = cardValue(this.state.dealer[0]) >= 10;
    if (needsPeek) {
      this.#set('PEEK_MSG', { message: 'El crupier revisa su carta oculta…' });
      const hole = this.#view.dealer[1]?.el;
      hole?.classList.add('is-peeking');
      await wait(1100 * settings.speed);
      hole?.classList.remove('is-peeking');
    }
    const s = this.state;
    const dealerNatural = isBlackjack(s.dealer);
    const insured = s.insurance.reduce((sum, value) => sum + value, 0);
    if (insured > 0 && s.insurancePaid === null) {
      const paid = s.insurance.map((value) => (dealerNatural ? value * 3 : 0));
      wallet.settle('blackjack', insured, paid.reduce((sum, value) => sum + value, 0));
      this.#set('INSURANCE_SETTLED', { insurancePaid: paid });
    }
    if (dealerNatural) {
      await this.#resolve();
      return;
    }
    const hands = this.state.hands.map((hand) => (isNatural(hand) ? { ...hand, done: true } : hand));
    this.#set('NATURALS', { hands });
    if (hands.every((hand) => hand.done)) {
      await this.#resolve();
      return;
    }
    const first = hands.findIndex((hand) => !hand.done);
    const intro = needsPeek ? 'El crupier no tiene Blackjack. ' : '';
    this.#set('PLAYER_TURN', { stage: 'player', active: first, busy: true, message: `${intro}Turno del asiento ${hands[first].seat + 1}` });
    await this.#continuePlayer();
  }

  // ---------- Decisiones del jugador ----------

  #markDone(index) {
    const hands = structuredClone(this.state.hands);
    hands[index].done = true;
    this.#set('HAND_DONE', { hands });
  }

  #beforeAction(action) {
    this.#score(action, this.#advice(this.state));
  }

  async hit() {
    if (!this.#canAct()) return;
    this.#beforeAction('hit');
    const index = this.state.active;
    this.#set('HIT', { busy: true });
    this.#draw(index);
    await wait(this.#settleTime());
    const { total } = handValue(this.state.hands[index].cards);
    if (total >= 21) {
      if (total > 21) this.#set('BUST', { message: `Asiento ${this.state.hands[index].seat + 1}: te pasas con ${total}` });
      this.#markDone(index);
      await this.#advance();
    } else {
      this.#set('HIT_DONE', { busy: false, message: this.#turnMessage() });
    }
  }

  async stand() {
    if (!this.#canAct()) return;
    this.#beforeAction('stand');
    this.#set('STAND', { busy: true });
    this.#markDone(this.state.active);
    await this.#advance();
  }

  async double() {
    if (!this.#canAct()) return;
    const s = this.state;
    const index = s.active;
    const hand = s.hands[index];
    if (!canDoubleHand(hand)) return;
    if (!wallet.hold('blackjack', hand.bet)) {
      hud.toast('Saldo insuficiente para doblar', 'warn');
      return;
    }
    this.#beforeAction('double');
    audio.chip();
    const hands = structuredClone(s.hands);
    hands[index].bet = hand.bet * 2;
    hands[index].doubled = true;
    this.#set('DOUBLE', { hands, busy: true, message: `Asiento ${hand.seat + 1} dobla: una sola carta` });
    this.#draw(index);
    await wait(this.#settleTime());
    this.#markDone(index);
    await this.#advance();
  }

  async split() {
    if (!this.#canAct()) return;
    const s = this.state;
    const index = s.active;
    const hand = s.hands[index];
    const seatHands = s.hands.filter((h) => h.seat === hand.seat).length;
    if (!canSplitHand(hand, seatHands)) return;
    if (!wallet.hold('blackjack', hand.bet)) {
      hud.toast('Saldo insuficiente para dividir', 'warn');
      return;
    }
    this.#beforeAction('split');
    audio.chip();
    const [first, second] = hand.cards;
    const splitAces = rankOf(first) === 'A';
    const hands = structuredClone(s.hands);
    hands.splice(
      index,
      1,
      newHand(hand.seat, hand.bet, { cards: [first], fromSplit: true, splitAces }),
      newHand(hand.seat, hand.bet, { cards: [second], fromSplit: true, splitAces }),
    );
    this.#instant = true;
    this.#set('SPLIT', { hands, busy: true, message: splitAces ? 'Ases divididos: una carta para cada uno' : 'Pareja dividida' });
    this.#instant = false;
    this.#draw(index);
    if (splitAces) {
      this.#draw(index + 1);
      await wait(this.#settleTime());
      this.#markDone(index);
      this.#markDone(index + 1);
      await this.#advance();
      return;
    }
    await wait(this.#settleTime());
    await this.#continuePlayer();
  }

  // Completa la mano activa si viene de una división y decide si el jugador debe actuar.
  async #continuePlayer() {
    const s = this.state;
    const hand = s.hands[s.active];
    if (!hand || hand.done) {
      await this.#advance();
      return;
    }
    if (hand.cards.length < 2) {
      this.#set('SPLIT_CARD', { busy: true });
      this.#draw(s.active);
      await wait(this.#settleTime());
    }
    const current = this.state.hands[this.state.active];
    if (handValue(current.cards).total >= 21 || current.splitAces) {
      this.#markDone(this.state.active);
      await this.#advance();
      return;
    }
    this.#set('PLAYER_TURN', { stage: 'player', busy: false, message: this.#turnMessage() });
  }

  #turnMessage() {
    const s = this.state;
    const hand = s.hands[s.active];
    if (!hand) return '';
    const seatHands = s.hands.filter((h) => h.seat === hand.seat);
    const part = seatHands.length > 1 ? ` · mano ${seatHands.indexOf(hand) + 1}/${seatHands.length}` : '';
    return `Asiento ${hand.seat + 1}${part}: tienes ${this.#totalText(hand.cards)}`;
  }

  async #advance() {
    const next = this.state.hands.findIndex((hand) => !hand.done);
    if (next === -1) {
      await this.#resolve();
      return;
    }
    this.#set('NEXT_HAND', { active: next, busy: true });
    await this.#continuePlayer();
  }

  // ---------- Resolución ----------

  // El resultado se liquida en el monedero ANTES de animar al crupier: recargar no altera nada.
  async #resolve() {
    const s = this.state;
    const dealer = [...s.dealer];
    let { shoe, pos, shoeMeta } = s;
    const live = s.hands.some((hand) => handValue(hand.cards).total <= 21 && !isNatural(hand));
    if (!isBlackjack(dealer) && live) {
      while (dealerShouldHit(dealer)) {
        if (pos >= shoe.length) {
          ({ shoe, shoeMeta } = freshShoe());
          pos = 0;
        }
        shoe = this.#montecarlo(dealer, shoe, pos);
        dealer.push(shoe[pos++]);
      }
    }
    const hands = s.hands.map((hand) => ({ ...hand, ...settleHand(hand, dealer), done: true }));
    const stake = hands.reduce((sum, hand) => sum + hand.bet, 0);
    const payout = hands.reduce((sum, hand) => sum + hand.payout, 0);
    wallet.settle('blackjack', stake, payout);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING, stage: 'dealer', busy: true, active: -1, hands, shoe, shoeMeta, pos, dealerFinal: dealer, message: 'Juega el crupier…' });
    this.#set('REVEAL_HOLE', { holeRevealed: true });
    audio.cardSlide();
    await wait(flipTime() + 250 * settings.speed);
    for (let i = s.dealer.length; i < dealer.length; i++) {
      this.#set('DEALER_DRAW', { dealer: dealer.slice(0, i + 1) });
      await wait(this.#settleTime());
    }
    await this.#payout();
  }

  // Dado de Montecarlo (reliquia del Cripto-Casino): si el crupier va a pedir con 15 o 16 duros,
  // un número verificable decide (25 %) si la siguiente carta es la primera de valor 10 que quede
  // en el zapato. La tirada y el intercambio quedan anotados en el historial.
  #montecarlo(dealer, shoe, pos) {
    if (!relics.active('dice')) return shoe;
    const { total, soft } = handValue(dealer);
    if (soft || (total !== 15 && total !== 16)) return shoe;
    const stream = session.stream('blackjack');
    const acts = stream.float() < DADO_CHANCE;
    const target = acts ? shoe.findIndex((card, i) => i >= pos && cardValue(card) === 10) : -1;
    let next = shoe;
    if (target > pos) {
      next = [...shoe];
      [next[pos], next[target]] = [next[target], next[pos]];
    }
    session.record(stream, { stake: 0, payout: 0, summary: acts ? 'Dado de Montecarlo: el crupier recibe un 10' : 'Dado de Montecarlo: no actúa', params: { kind: 'dado', swap: target >= pos ? [pos, target] : null } });
    if (acts && target >= pos) hud.toast('🎲 Dado de Montecarlo: el crupier recibe un 10', 'success', 2600);
    return next;
  }

  async #payout() {
    const s = this.state;
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, stage: 'done', busy: true, active: -1, dealer: s.dealerFinal ?? s.dealer, holeRevealed: true });
    wallet.reveal('blackjack');

    const { hands, dealer } = this.state;
    const insured = s.insurance.reduce((sum, value) => sum + value, 0);
    const insurancePaid = (s.insurancePaid ?? []).reduce((sum, value) => sum + value, 0);
    const sideBets = (s.sides ?? []).flatMap((side) => [side?.pp, side?.t213]).filter(Boolean);
    const sideStake = sideBets.reduce((sum, bet) => sum + bet.amount, 0);
    const sidePaid = sideBets.reduce((sum, bet) => sum + bet.paid, 0);
    const stake = hands.reduce((sum, hand) => sum + hand.bet, 0) + insured + sideStake;
    const returned = hands.reduce((sum, hand) => sum + hand.payout, 0) + insurancePaid + sidePaid;
    const net = money(returned - stake);
    const dealerTotal = handValue(dealer).total;
    const dealerBust = dealerTotal > 21;
    const dealerText = isBlackjack(dealer) ? 'Blackjack del crupier' : dealerBust ? `El crupier se pasa (${dealerTotal})` : `Crupier: ${dealerTotal}`;
    const netText = net > 0 ? `Ganas +${formatChips(net)}` : net < 0 ? `Pierdes ${formatChips(-net)}` : 'Recuperas lo apostado';

    const rect = this.#dom.seats.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 };
    if (hands.some((hand) => hand.result === 'blackjack')) {
      audio.win(2);
      hud.celebrate(2, origin);
    } else if (net > 0) {
      audio.chip();
      audio.win(1);
      hud.celebrate(1, origin);
    } else if (net < 0) {
      audio.lose();
    }

    this.#set('PAYOUT_MSG', { message: `${dealerText}. ${netText}` });
    const tags = [];
    if (hands.some((hand) => hand.result === 'blackjack')) tags.push('natural');
    if (hands.some((hand) => hand.doubled && hand.result === 'win')) tags.push('double-win');
    if (hands.some((hand) => hand.fromSplit && hand.result === 'win')) tags.push('split-win');
    if (sidePaid > 0) tags.push('side-win');
    if (insurancePaid > 0) tags.push('insurance-win');
    if (dealerBust) tags.push('dealer-bust');
    session.record({ meta: s.shoeMeta }, { stake, payout: returned, summary: `${dealerText} · ${netText}`, params: { kind: 'round', from: s.roundFrom ?? 0, to: s.pos } });
    session.report({ game: 'blackjack', stake, returned, tags, coach: { right: this.#prefs.right, total: this.#prefs.total } });
    await wait(450 * settings.speed);
    this.#set('READY', { busy: false });
  }

  // ---------- Coach y conteo ----------

  #countInfo(s) {
    let running = 0;
    for (let i = 0; i < s.pos; i++) running += hiLoValue(s.shoe[i]);
    const hidden = [];
    if (s.dealer.length > 1 && !s.holeRevealed) hidden.push(s.dealer[1]);
    if (s.dealerFinal) hidden.push(...s.dealerFinal.slice(s.dealer.length));
    for (const card of hidden) running -= hiLoValue(card);
    const remaining = s.shoe.length - s.pos + hidden.length;
    return { running, true: trueCount(running, remaining), decks: remaining / 52 };
  }

  #advice(s) {
    if (!(s.phase === PHASE.DEALING && s.stage === 'player')) return null;
    const hand = s.hands[s.active];
    if (!hand || hand.done || hand.cards.length < 2) return null;
    const seatHands = s.hands.filter((h) => h.seat === hand.seat).length;
    const affordable = wallet.canAfford(hand.bet);
    return basicStrategy(hand.cards, s.dealer[0], {
      canDouble: canDoubleHand(hand) && affordable,
      canSplit: canSplitHand(hand, seatHands) && affordable,
    });
  }

  #insuranceAdvice(s) {
    const tc = this.#countInfo(s).true;
    const take = this.#prefs.count && tc >= INSURANCE_TRUE_COUNT;
    return { action: take ? 'take' : 'decline', tc };
  }

  #score(action, advice) {
    if (!this.#prefs.coach || !advice) return;
    const right = advice.action === action;
    this.#prefs.total += 1;
    if (right) this.#prefs.right += 1;
    storage.write(PREFS_KEY, this.#prefs);
    const names = { ...ACTION_NAMES, take: 'tomar seguro', decline: 'rechazar el seguro' };
    this.#feedback = right ? '✔ Jugada correcta' : `✘ La estrategia básica indicaba ${names[advice.action].toLowerCase()}`;
  }

  #renderCoach(s) {
    const d = this.#dom;
    const on = this.#prefs.coach;
    d.coachToggle.setAttribute('aria-pressed', String(on));
    d.coach.hidden = !on;
    for (const button of [d.hit, d.stand, d.double, d.split, d.insureYes, d.insureNo]) button.classList.remove('is-coach-pick');
    if (!on) return;

    const { right, total } = this.#prefs;
    d.coachScore.textContent = total ? `Precisión ${Math.round((right / total) * 100)}% (${right}/${total})` : 'Precisión: —';
    d.coachFeedback.textContent = this.#feedback;

    if (s.phase === PHASE.DEALING && s.stage === 'insurance' && !s.busy) {
      const advice = this.#insuranceAdvice(s);
      (advice.action === 'take' ? d.insureYes : d.insureNo).classList.add('is-coach-pick');
      d.coachTip.textContent = advice.action === 'take'
        ? `Tomar seguro: con True Count ${advice.tc.toFixed(1)} (≥ +3) el seguro tiene valor esperado positivo.`
        : 'No tomes seguro: sin conteo favorable su ventaja de la casa ronda el 7,4 %.';
      return;
    }
    const advice = this.#advice(s);
    if (!advice || s.busy) {
      d.coachTip.textContent = s.phase === PHASE.DEALING ? 'Esperando tu turno…' : 'Estrategia básica 6 barajas · S17 · doblar tras dividir.';
      return;
    }
    const button = { hit: d.hit, stand: d.stand, double: d.double, split: d.split }[advice.action];
    button.classList.add('is-coach-pick');
    const hand = s.hands[s.active];
    const up = cardValue(s.dealer[0]) === 11 ? 'As' : String(cardValue(s.dealer[0]));
    const kinds = { hard: 'dura', soft: 'blanda', pair: 'pareja' };
    const handText = advice.kind === 'pair' ? `pareja de ${rankOf(hand.cards[0])}` : `${advice.total} ${kinds[advice.kind]}`;
    d.coachTip.textContent = `${ACTION_NAMES[advice.action]}: ${handText} contra ${up} del crupier.`;
  }

  #renderCount(s) {
    const d = this.#dom;
    const on = this.#prefs.count;
    d.countToggle.setAttribute('aria-pressed', String(on));
    d.count.hidden = !on;
    d.table.classList.toggle('is-counting', on);
    if (!on) return;
    const info = this.#countInfo(s);
    const paint = () => {
      d.countRunning.textContent = signed(info.running);
      d.countTrue.textContent = signed(Math.round(info.true * 10) / 10);
      d.countDecks.textContent = info.decks.toFixed(1);
      d.count.dataset.trend = info.true >= 2 ? 'hot' : info.true <= -2 ? 'cold' : 'neutral';
    };
    // El marcador se actualiza cuando la carta termina de aparecer en la mesa.
    clearTimeout(this.#countTimer);
    const delay = this.#instant ? 0 : Math.max(0, this.#clock - performance.now()) + 450;
    if (delay === 0) paint();
    else this.#countTimer = setTimeout(paint, delay);
  }

  // ---------- Render ----------

  #totalText(cards) {
    const { total, soft } = handValue(cards);
    return soft && total < 21 && cards.length > 1 ? `${total - 10}/${total}` : String(total);
  }

  #render(s) {
    this.#dom.message.textContent = s.message;
    this.#renderShoe(s);
    this.#renderSeats(s);
    this.#renderDealer(s);
    this.#renderHands(s);
    this.#renderControls(s);
    this.#renderCount(s);
  }

  #renderShoe(s) {
    const remaining = s.shoe.length - s.pos;
    this.#dom.shoeFill.style.transform = `scaleX(${remaining / SHOE_SIZE})`;
    this.#dom.shoeCount.textContent = `${remaining} cartas`;
  }

  #renderSeats(s) {
    const betting = this.#canBet();
    const round = s.phase !== PHASE.IDLE;
    const limits = this.#limits();
    this.#dom.seats.dataset.seats = String(limits.seats);
    s.seats.forEach((seat, i) => {
      const view = this.#view.seats[i];
      const playing = s.hands.some((hand) => hand.seat === i);
      const locked = i >= limits.seats && !playing;
      view.node.classList.toggle('is-playing', playing);
      view.node.classList.toggle('is-locked', locked);
      view.node.classList.toggle('is-idle', round && !playing && seat.main <= 0 && s.phase !== PHASE.BETTING);
      for (const spot of SPOTS) {
        const item = view.spots[spot];
        const amount = round ? seat[spot] : 0;
        const spotLocked = locked || (spot !== 'main' && !limits.sideBets && amount === 0);
        if (item.shown !== amount) {
          item.shown = amount;
          item.amount.textContent = amount > 0 ? formatChips(amount) : '';
          item.stack.replaceChildren(...(amount > 0 ? [chipStack(amount, spot === 'main' ? 6 : 3)] : []));
        }
        item.button.classList.toggle('has-bet', amount > 0);
        item.button.classList.toggle('is-locked', spotLocked);
        item.button.disabled = !betting || spotLocked;
        const current = amount > 0 ? `, apuesta ${formatChips(amount)}` : '';
        const lockNote = spotLocked ? ', se desbloquea en el Salón de Neón' : '';
        item.button.setAttribute('aria-label', `Asiento ${i + 1}, ${SPOT_NAMES[spot]}${current}${lockNote}`);
      }
      this.#renderSides(view, s.sides?.[i] ?? null);
    });
  }

  #renderSides(view, side) {
    const key = JSON.stringify(side);
    if (key === view.sidesKey) return;
    view.sidesKey = key;
    const badges = [];
    for (const [label, bet] of [['PP', side?.pp], ['21+3', side?.t213]]) {
      if (!bet) continue;
      const won = bet.paid > 0;
      const badge = el('span', `side-badge ${won ? 'is-won' : 'is-lost'}`, won ? `${label} · ${bet.name} ${bet.pays}:1` : `${label} ✗`);
      badges.push(badge);
    }
    view.sides.replaceChildren(...badges);
  }

  #sync(container, rendered, codes, hiddenIndex = -1) {
    const matches = rendered.length <= codes.length && rendered.every((item, i) => item.code === codes[i]);
    const rebuild = !matches;
    if (rebuild) {
      container.replaceChildren();
      rendered.length = 0;
    }
    const instant = this.#instant || rebuild || this.root.hidden;
    for (let i = rendered.length; i < codes.length; i++) {
      const card = cardElement(codes[i]);
      card.dataset.hilo = signed(hiLoValue(codes[i]));
      container.append(card);
      rendered.push({ code: codes[i], el: card });
      const faceUp = i !== hiddenIndex;
      if (instant) {
        setCardFaceUp(card, faceUp);
      } else {
        this.#animateDeal(card, faceUp);
      }
    }
    container.dataset.n = String(codes.length);
  }

  #animateDeal(card, faceUp) {
    const delay = this.#dealDelay();
    const shoe = this.#dom.shoe.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--from-x', `${shoe.left + shoe.width / 2 - (rect.left + rect.width / 2)}px`);
    card.style.setProperty('--from-y', `${shoe.top + shoe.height / 2 - (rect.top + rect.height / 2)}px`);
    card.style.setProperty('--deal-delay', `${delay}ms`);
    card.classList.add('is-dealing');
    setTimeout(() => audio.cardSlide(), delay);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      card.classList.remove('is-dealing');
      if (faceUp) setCardFaceUp(card, true);
    };
    card.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, delay + 650);
  }

  #renderDealer(s) {
    this.#sync(this.#dom.dealerCards, this.#view.dealer, s.dealer, s.holeRevealed ? -1 : 1);
    const hole = this.#view.dealer[1];
    if (hole && s.holeRevealed && !hole.el.classList.contains('is-dealing')) setCardFaceUp(hole.el, true);
    if (s.dealer.length === 0) {
      this.#dom.dealerTotal.textContent = '';
    } else if (s.holeRevealed) {
      this.#dom.dealerTotal.textContent = this.#totalText(s.dealer);
    } else {
      this.#dom.dealerTotal.textContent = cardValue(s.dealer[0]) === 11 ? '1/11' : String(cardValue(s.dealer[0]));
    }
  }

  #renderHands(s) {
    const activeHand = s.hands[s.active] ?? null;
    for (let seat = 0; seat < SEATS; seat++) {
      const view = this.#view.seats[seat];
      const hands = s.hands.filter((hand) => hand.seat === seat);
      while (view.handViews.length > hands.length) view.handViews.pop().node.remove();
      hands.forEach((hand, j) => {
        let v = view.handViews[j];
        if (!v) {
          const node = el('div', 'bj-hand');
          const cards = el('div', 'hand-cards');
          const meta = el('div', 'hand-meta');
          const total = el('output', 'hand-total');
          const bet = el('span', 'hand-bet');
          const result = el('span', 'hand-result');
          meta.append(total, bet);
          node.append(result, cards, meta);
          view.hands.append(node);
          v = { node, cards, total, bet, result, rendered: [] };
          view.handViews.push(v);
        }
        this.#sync(v.cards, v.rendered, hand.cards);
        v.total.textContent = hand.cards.length ? this.#totalText(hand.cards) : '';
        v.bet.textContent = `${formatChips(hand.bet)}${hand.doubled ? ' ×2' : ''}`;
        const showResult = s.phase === PHASE.PAYOUT && hand.result;
        v.result.textContent = showResult ? RESULT_TEXT[hand.result] : '';
        v.node.dataset.result = showResult ? hand.result : '';
        v.node.classList.toggle('is-active', s.phase === PHASE.DEALING && s.stage === 'player' && hand === activeHand);
      });
      view.hands.dataset.count = String(hands.length);
    }
    this.#dom.seats.dataset.playing = String(new Set(s.hands.map((hand) => hand.seat)).size);
  }

  #renderControls(s) {
    const d = this.#dom;
    const canBet = this.#canBet();
    const anyMain = s.seats.some((seat) => seat.main >= this.#limits().minBet);
    d.deal.disabled = !(canBet && s.phase === PHASE.BETTING && anyMain);
    d.clear.disabled = !(canBet && s.phase === PHASE.BETTING);
    const lastTotal = seatsTotal(s.lastSeats);
    d.rebet.disabled = !(canBet && s.phase !== PHASE.BETTING && lastTotal > 0 && wallet.canAfford(lastTotal));

    const acting = this.#canAct();
    const hand = s.hands[s.active];
    const seatHands = hand ? s.hands.filter((h) => h.seat === hand.seat).length : 0;
    d.hit.disabled = !acting;
    d.stand.disabled = !acting;
    d.double.disabled = !(acting && hand && canDoubleHand(hand) && wallet.canAfford(hand.bet));
    d.split.disabled = !(acting && hand && canSplitHand(hand, seatHands) && wallet.canAfford(hand.bet));

    const insuring = s.phase === PHASE.DEALING && s.stage === 'insurance';
    const insuredHand = insuring ? s.hands.find((h) => h.seat === s.insuranceSeat) : null;
    const cost = insuredHand ? money(insuredHand.bet / 2) : 0;
    d.insureLabel.textContent = insuredHand ? `Asiento ${s.insuranceSeat + 1} · seguro ${formatChips(cost)}` : '';
    d.insureYes.disabled = !(insuring && !s.busy && wallet.canAfford(cost));
    d.insureNo.disabled = !(insuring && !s.busy);

    this.root.dataset.mode = insuring ? 'insurance' : s.phase === PHASE.DEALING || s.phase === PHASE.RESOLVING ? 'play' : 'bet';
    this.#renderCoach(s);
  }

  onShow() {}

  onHide() {}
}
