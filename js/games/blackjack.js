// Blackjack, reglas Las Vegas Strip: zapato de 6 barajas, corte al 75 %, BJ 3:2,
// crupier se planta en todos los 17 (S17), revisa BJ con As o figura (peek), seguro 2:1,
// doblar con dos cartas (también tras dividir), dividir hasta 4 manos, ases divididos reciben una carta.

import { shuffle } from '../engine/rng.js';
import { Store, PHASE, wait } from '../engine/store.js';
import { wallet, MIN_BET, money } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { hud, formatChips } from '../ui/hud.js';
import { cardElement, setCardFaceUp, chipStack, el } from '../ui/svg.js';

export const DECKS = 6;
export const SHOE_SIZE = DECKS * 52;
export const CUT_CARD = Math.floor(SHOE_SIZE * 0.75);
export const MAX_BET = 5000;
export const MAX_HANDS = 4;
export const BLACKJACK_PAYS = 1.5;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const SAVE_KEY = 'crd.blackjack.v1';
const DEAL_STEP = 380;
const FLIP_TIME = 560;

// ---------- Reglas puras ----------

export function buildShoe(decks = DECKS) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push(rank + suit);
  }
  return cards;
}

export const newShuffledShoe = () => shuffle(buildShoe());
export const rankOf = (card) => card.slice(0, -1);

export function cardValue(card) {
  const rank = rankOf(card);
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const value = cardValue(card);
    if (value === 11) aces++;
    total += value;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
export const dealerShouldHit = (cards) => handValue(cards).total < 17;

export function canSplitHand(hand, handCount) {
  return (
    hand.cards.length === 2 &&
    !hand.splitAces &&
    !hand.doubled &&
    handCount < MAX_HANDS &&
    cardValue(hand.cards[0]) === cardValue(hand.cards[1])
  );
}

export const canDoubleHand = (hand) => hand.cards.length === 2 && !hand.splitAces && !hand.doubled;

// Devuelve el resultado y el importe total devuelto al jugador (apuesta incluida).
export function settleHand(hand, dealerCards) {
  const player = handValue(hand.cards).total;
  const dealer = handValue(dealerCards).total;
  const natural = !hand.fromSplit && isBlackjack(hand.cards);
  const dealerNatural = isBlackjack(dealerCards);
  if (natural && dealerNatural) return { result: 'push', payout: hand.bet };
  if (natural) return { result: 'blackjack', payout: money(hand.bet * (1 + BLACKJACK_PAYS)) };
  if (dealerNatural) return { result: 'lose', payout: 0 };
  if (player > 21) return { result: 'bust', payout: 0 };
  if (dealer > 21 || player > dealer) return { result: 'win', payout: hand.bet * 2 };
  if (player === dealer) return { result: 'push', payout: hand.bet };
  return { result: 'lose', payout: 0 };
}

function newHand(bet, extra = {}) {
  return { cards: [], bet, doubled: false, done: false, fromSplit: false, splitAces: false, result: null, payout: 0, ...extra };
}

function freshRound() {
  return { hands: [], active: 0, dealer: [], dealerFinal: null, holeRevealed: false, insurance: 0, insurancePaid: null };
}

function initialState() {
  return {
    phase: PHASE.IDLE,
    busy: false,
    stage: 'bet',
    shoe: newShuffledShoe(),
    pos: 0,
    bet: 0,
    lastBet: 0,
    message: 'Coloca tu apuesta y pulsa Repartir',
    ...freshRound(),
  };
}

const RESULT_TEXT = { blackjack: 'BLACKJACK', win: 'GANA', lose: 'PIERDE', push: 'EMPATE', bust: 'SE PASA' };

function isValidSave(s) {
  return (
    s && typeof s === 'object' &&
    Object.values(PHASE).includes(s.phase) &&
    Array.isArray(s.shoe) && s.shoe.length === SHOE_SIZE && s.shoe.every((c) => typeof c === 'string') &&
    Number.isInteger(s.pos) && s.pos >= 0 && s.pos <= SHOE_SIZE &&
    Array.isArray(s.hands) && s.hands.every((h) => h && Array.isArray(h.cards) && typeof h.bet === 'number') &&
    Array.isArray(s.dealer)
  );
}

// ---------- Mesa ----------

export class BlackjackGame {
  #store;
  #dom;
  #view = { dealer: [], hands: [] };
  #clock = 0;
  #instant = true;

  constructor(root) {
    this.root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      shoe: $('bj-shoe'),
      shoeFill: $('bj-shoe-fill'),
      shoeCount: $('bj-shoe-count'),
      dealerCards: $('bj-dealer-cards'),
      dealerTotal: $('bj-dealer-total'),
      hands: $('bj-hands'),
      message: $('bj-message'),
      betCircle: $('bj-bet-circle'),
      betStack: $('bj-bet-stack'),
      betAmount: $('bj-bet-amount'),
      clear: $('bj-clear'),
      rebet: $('bj-rebet'),
      deal: $('bj-deal'),
      hit: $('bj-hit'),
      stand: $('bj-stand'),
      double: $('bj-double'),
      split: $('bj-split'),
      insureYes: $('bj-insure-yes'),
      insureNo: $('bj-insure-no'),
      rack: $('bj-rack'),
    };

    this.#store = new Store('blackjack', this.#restore());
    this.#store.subscribe((state) => {
      storage.write(SAVE_KEY, state);
      this.#render(state);
    });
    wallet.addEventListener('change', () => this.#renderControls(this.state));

    this.#bind();
    this.#render(this.state);
    this.#instant = false;
    this.#resume();
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
    if (state.phase === PHASE.IDLE || state.phase === PHASE.PAYOUT || state.phase === PHASE.BETTING) {
      if (escrow > 0) wallet.refund('blackjack');
      if (state.phase === PHASE.BETTING) Object.assign(state, { phase: PHASE.IDLE, bet: 0 });
      if (state.phase === PHASE.IDLE) Object.assign(state, freshRound(), { stage: 'bet', message: 'Coloca tu apuesta y pulsa Repartir' });
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

  // ---------- Entrada ----------

  #bind() {
    const d = this.#dom;
    hud.mountRack(d.rack, { onPlace: (value) => this.addChip(value) });
    d.betCircle.addEventListener('click', () => this.addChip(hud.selectedChip));
    d.clear.addEventListener('click', () => this.clearBet());
    d.rebet.addEventListener('click', () => this.rebet());
    d.deal.addEventListener('click', () => this.deal());
    d.hit.addEventListener('click', () => this.hit());
    d.stand.addEventListener('click', () => this.stand());
    d.double.addEventListener('click', () => this.double());
    d.split.addEventListener('click', () => this.split());
    d.insureYes.addEventListener('click', () => this.insurance(true));
    d.insureNo.addEventListener('click', () => this.insurance(false));
  }

  #canBet() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.BETTING || s.phase === PHASE.PAYOUT);
  }

  #canAct() {
    const s = this.state;
    return !s.busy && s.phase === PHASE.DEALING && s.stage === 'player';
  }

  addChip(value) {
    if (!this.#canBet()) return;
    const s = this.state;
    const current = s.phase === PHASE.BETTING ? s.bet : 0;
    if (current + value > MAX_BET) {
      hud.toast(`Apuesta máxima de la mesa: ${formatChips(MAX_BET)}`, 'warn');
      return;
    }
    if (!wallet.hold('blackjack', value)) {
      hud.toast('Saldo insuficiente para esa ficha', 'warn');
      return;
    }
    audio.chip();
    const reset = s.phase === PHASE.BETTING ? {} : { ...freshRound(), stage: 'bet' };
    this.#set('ADD_CHIP', { ...reset, phase: PHASE.BETTING, bet: current + value, message: 'Pulsa Repartir cuando estés listo' });
  }

  clearBet() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    wallet.refund('blackjack', s.bet);
    audio.chip();
    this.#set('CLEAR_BET', { phase: PHASE.IDLE, bet: 0, message: 'Coloca tu apuesta y pulsa Repartir' });
  }

  rebet() {
    const s = this.state;
    if (!this.#canBet() || s.phase === PHASE.BETTING || s.lastBet <= 0) return;
    if (!wallet.hold('blackjack', s.lastBet)) {
      hud.toast('Saldo insuficiente para repetir la apuesta', 'warn');
      return;
    }
    audio.chip();
    this.#set('REBET', { ...freshRound(), stage: 'bet', phase: PHASE.BETTING, bet: s.lastBet, message: 'Pulsa Repartir cuando estés listo' });
  }

  // ---------- Reparto ----------

  #draw(target) {
    const s = this.state;
    let { shoe, pos } = s;
    if (pos >= shoe.length) {
      shoe = newShuffledShoe();
      pos = 0;
    }
    const card = shoe[pos];
    const patch = { shoe, pos: pos + 1 };
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
    this.#clock = start + DEAL_STEP;
    return start - now;
  }

  #settleTime() {
    return Math.max(0, this.#clock - performance.now()) + FLIP_TIME;
  }

  async deal() {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.BETTING) return;
    if (s.bet < MIN_BET) {
      hud.minBetNotice();
      return;
    }
    const reshuffle = s.pos >= CUT_CARD;
    this.#set('DEAL', {
      ...freshRound(),
      phase: PHASE.DEALING,
      stage: 'dealing',
      busy: true,
      shoe: reshuffle ? newShuffledShoe() : s.shoe,
      pos: reshuffle ? 0 : s.pos,
      lastBet: s.bet,
      bet: 0,
      hands: [newHand(s.bet)],
      message: reshuffle ? 'Carta de corte alcanzada: barajando un zapato nuevo…' : 'Repartiendo…',
    });
    if (reshuffle) {
      audio.shuffle();
      this.#dom.shoe.classList.add('is-shuffling');
      setTimeout(() => this.#dom.shoe.classList.remove('is-shuffling'), 1300);
      this.#clock = performance.now() + 1300;
    }
    for (const target of [0, 'dealer', 0, 'dealer']) this.#draw(target);
    await this.#afterInitialDeal();
  }

  async #afterInitialDeal() {
    this.#set('INITIAL_DEAL', { busy: true });
    await wait(this.#settleTime());
    const s = this.state;
    if (rankOf(s.dealer[0]) === 'A') {
      const natural = isBlackjack(s.hands[0].cards);
      this.#set('OFFER_INSURANCE', {
        stage: 'insurance',
        busy: false,
        message: natural
          ? '¡Blackjack! El crupier muestra un As: el seguro equivale a cobrar 1 a 1 ahora'
          : 'El crupier muestra un As. ¿Tomas seguro? Cuesta media apuesta y paga 2 a 1',
      });
      return;
    }
    await this.#peek();
  }

  insurance(take) {
    const s = this.state;
    if (s.busy || s.phase !== PHASE.DEALING || s.stage !== 'insurance') return;
    let stake = 0;
    if (take) {
      stake = money(s.hands[0].bet / 2);
      if (!wallet.hold('blackjack', stake)) {
        hud.toast('Saldo insuficiente para el seguro', 'warn');
        return;
      }
      audio.chip();
    }
    this.#set('INSURANCE', { insurance: stake, stage: 'peek', busy: true });
    this.#peek();
  }

  // Dealer Peek: con As o carta de 10 visible el crupier revisa la oculta antes de que juegues.
  async #peek() {
    this.#set('PEEK', { stage: 'peek', busy: true });
    const needsPeek = cardValue(this.state.dealer[0]) >= 10;
    if (needsPeek) {
      this.#set('PEEK_MSG', { message: 'El crupier revisa su carta oculta…' });
      const hole = this.#view.dealer[1]?.el;
      hole?.classList.add('is-peeking');
      await wait(1100);
      hole?.classList.remove('is-peeking');
    }
    const s = this.state;
    const dealerNatural = isBlackjack(s.dealer);
    if (s.insurance > 0 && s.insurancePaid === null) {
      const paid = dealerNatural ? s.insurance * 3 : 0;
      wallet.settle('blackjack', s.insurance, paid);
      this.#set('INSURANCE_SETTLED', { insurancePaid: paid });
    }
    if (dealerNatural || isBlackjack(s.hands[0].cards)) {
      await this.#resolve();
      return;
    }
    this.#set('PLAYER_TURN', {
      stage: 'player',
      busy: false,
      active: 0,
      message: needsPeek ? 'El crupier no tiene Blackjack. Tu turno' : 'Tu turno: ¿pides o te plantas?',
    });
  }

  // ---------- Decisiones del jugador ----------

  #markDone(index) {
    const hands = structuredClone(this.state.hands);
    hands[index].done = true;
    this.#set('HAND_DONE', { hands });
  }

  async hit() {
    if (!this.#canAct()) return;
    const index = this.state.active;
    this.#set('HIT', { busy: true });
    this.#draw(index);
    await wait(this.#settleTime());
    const { total } = handValue(this.state.hands[index].cards);
    if (total >= 21) {
      if (total > 21) this.#set('BUST', { message: `Te pasas con ${total}` });
      this.#markDone(index);
      await this.#advance();
    } else {
      this.#set('HIT_DONE', { busy: false, message: `Tienes ${this.#totalText(this.state.hands[index].cards)}` });
    }
  }

  async stand() {
    if (!this.#canAct()) return;
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
    audio.chip();
    const hands = structuredClone(s.hands);
    hands[index].bet = hand.bet * 2;
    hands[index].doubled = true;
    this.#set('DOUBLE', { hands, busy: true, message: 'Doblas: recibes una sola carta' });
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
    if (!canSplitHand(hand, s.hands.length)) return;
    if (!wallet.hold('blackjack', hand.bet)) {
      hud.toast('Saldo insuficiente para dividir', 'warn');
      return;
    }
    audio.chip();
    const [first, second] = hand.cards;
    const splitAces = rankOf(first) === 'A';
    const hands = structuredClone(s.hands);
    hands.splice(
      index,
      1,
      newHand(hand.bet, { cards: [first], fromSplit: true, splitAces }),
      newHand(hand.bet, { cards: [second], fromSplit: true, splitAces }),
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

  // Tras recargar o dividir: completa la mano activa si solo tiene una carta y decide si sigue.
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
    const many = this.state.hands.length > 1;
    this.#set('PLAYER_TURN', {
      stage: 'player',
      busy: false,
      message: many ? `Mano ${this.state.active + 1} de ${this.state.hands.length}: ${this.#totalText(current.cards)}` : `Tienes ${this.#totalText(current.cards)}`,
    });
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
    let { shoe, pos } = s;
    const needsDealer =
      !isBlackjack(dealer) &&
      s.hands.some((hand) => handValue(hand.cards).total <= 21 && !(!hand.fromSplit && isBlackjack(hand.cards)));
    if (needsDealer) {
      while (dealerShouldHit(dealer)) {
        if (pos >= shoe.length) {
          shoe = newShuffledShoe();
          pos = 0;
        }
        dealer.push(shoe[pos++]);
      }
    }
    const hands = s.hands.map((hand) => ({ ...hand, ...settleHand(hand, dealer), done: true }));
    const stake = hands.reduce((sum, hand) => sum + hand.bet, 0);
    const payout = hands.reduce((sum, hand) => sum + hand.payout, 0);
    wallet.settle('blackjack', stake, payout);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING, stage: 'dealer', busy: true, hands, shoe, pos, dealerFinal: dealer, message: 'Juega el crupier…' });
    this.#set('REVEAL_HOLE', { holeRevealed: true });
    audio.cardSlide();
    await wait(FLIP_TIME + 250);
    for (let i = s.dealer.length; i < dealer.length; i++) {
      this.#set('DEALER_DRAW', { dealer: dealer.slice(0, i + 1) });
      await wait(this.#settleTime());
    }
    await this.#payout();
  }

  async #payout() {
    const s = this.state;
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, stage: 'done', busy: true, dealer: s.dealerFinal ?? s.dealer, holeRevealed: true });
    wallet.reveal('blackjack');

    const hands = this.state.hands;
    const stake = hands.reduce((sum, hand) => sum + hand.bet, 0) + s.insurance;
    const returned = hands.reduce((sum, hand) => sum + hand.payout, 0) + (s.insurancePaid ?? 0);
    const net = money(returned - stake);
    const dealerTotal = handValue(this.state.dealer).total;
    const dealerText = isBlackjack(this.state.dealer) ? 'Blackjack del crupier' : dealerTotal > 21 ? `El crupier se pasa (${dealerTotal})` : `Crupier: ${dealerTotal}`;
    const netText = net > 0 ? `Ganas +${formatChips(net)}` : net < 0 ? `Pierdes ${formatChips(-net)}` : 'Recuperas tu apuesta';

    const circle = this.#dom.betCircle.getBoundingClientRect();
    const origin = { x: circle.left + circle.width / 2, y: circle.top };
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
    await wait(450);
    this.#set('READY', { busy: false });
  }

  // ---------- Render ----------

  #totalText(cards) {
    const { total, soft } = handValue(cards);
    return soft && total < 21 && cards.length > 1 ? `${total - 10}/${total}` : String(total);
  }

  #render(s) {
    this.#dom.message.textContent = s.message;
    this.#renderShoe(s);
    this.#renderBet(s);
    this.#renderDealer(s);
    this.#renderHands(s);
    this.#renderControls(s);
  }

  #renderShoe(s) {
    const remaining = s.shoe.length - s.pos;
    this.#dom.shoeFill.style.transform = `scaleX(${remaining / SHOE_SIZE})`;
    this.#dom.shoeCount.textContent = `${remaining} cartas`;
  }

  #renderBet(s) {
    const betting = s.phase === PHASE.IDLE || s.phase === PHASE.BETTING;
    const amount = betting ? s.bet : s.hands.reduce((sum, hand) => sum + hand.bet, 0);
    if (this.#dom.betAmount.dataset.amount !== String(amount)) {
      this.#dom.betAmount.dataset.amount = String(amount);
      this.#dom.betAmount.textContent = formatChips(amount);
      this.#dom.betStack.replaceChildren(amount > 0 ? chipStack(amount) : '');
    }
    this.#dom.betCircle.classList.toggle('is-empty', amount === 0);
    this.#dom.betCircle.disabled = !this.#canBet();
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
      container.append(card);
      rendered.push({ code: codes[i], el: card });
      const faceUp = i !== hiddenIndex;
      if (instant) {
        setCardFaceUp(card, faceUp);
      } else {
        this.#animateDeal(card, faceUp);
      }
    }
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
      this.#dom.dealerTotal.textContent = String(cardValue(s.dealer[0]) === 11 ? '1/11' : cardValue(s.dealer[0]));
    }
  }

  #renderHands(s) {
    const view = this.#view.hands;
    while (view.length > s.hands.length) view.pop().el.remove();
    s.hands.forEach((hand, i) => {
      let v = view[i];
      if (!v) {
        const node = el('div', 'bj-hand');
        const cards = el('div', 'hand-cards');
        const meta = el('div', 'hand-meta');
        const total = el('output', 'hand-total');
        const bet = el('span', 'hand-bet');
        const result = el('span', 'hand-result');
        meta.append(total, bet);
        node.append(result, cards, meta);
        this.#dom.hands.append(node);
        v = { el: node, cards, total, bet, result, rendered: [] };
        view.push(v);
      }
      this.#sync(v.cards, v.rendered, hand.cards);
      v.total.textContent = hand.cards.length ? this.#totalText(hand.cards) : '';
      v.bet.textContent = `${formatChips(hand.bet)}${hand.doubled ? ' ×2' : ''}`;
      const showResult = s.phase === PHASE.PAYOUT && hand.result;
      v.result.textContent = showResult ? RESULT_TEXT[hand.result] : '';
      v.el.dataset.result = showResult ? hand.result : '';
      v.el.classList.toggle('is-active', s.phase === PHASE.DEALING && s.stage === 'player' && i === s.active && s.hands.length > 1);
    });
  }

  #renderControls(s) {
    const d = this.#dom;
    const canBet = this.#canBet();
    d.deal.disabled = !(canBet && s.phase === PHASE.BETTING && s.bet >= MIN_BET);
    d.clear.disabled = !(canBet && s.phase === PHASE.BETTING);
    d.rebet.disabled = !(canBet && s.phase !== PHASE.BETTING && s.lastBet > 0 && wallet.canAfford(s.lastBet));

    const acting = this.#canAct();
    const hand = s.hands[s.active];
    d.hit.disabled = !acting;
    d.stand.disabled = !acting;
    d.double.disabled = !(acting && hand && canDoubleHand(hand) && wallet.canAfford(hand.bet));
    d.split.disabled = !(acting && hand && canSplitHand(hand, s.hands.length) && wallet.canAfford(hand.bet));

    const insuring = s.phase === PHASE.DEALING && s.stage === 'insurance';
    d.insureYes.disabled = !(insuring && !s.busy && wallet.canAfford(money((s.hands[0]?.bet ?? 0) / 2)));
    d.insureNo.disabled = !(insuring && !s.busy);

    this.root.dataset.mode = insuring ? 'insurance' : s.phase === PHASE.DEALING || s.phase === PHASE.RESOLVING ? 'play' : 'bet';
  }

  onShow() {}

  onHide() {}
}
