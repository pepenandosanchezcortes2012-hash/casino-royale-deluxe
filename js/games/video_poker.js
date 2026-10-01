// Video Póker Jacks or Better 9/6. La baraja entera se baraja al repartir con el flujo provably
// fair (video_poker-math.js): las 5 primeras cartas forman la mano y las siguientes reponen los
// descartes en orden. Pagos «por 1» (devuelven la apuesta incluida): la Escalera Real paga 250 por
// moneda y 800 con la apuesta máxima de 5 monedas. La mano a medias sobrevive a una recarga.

import { wallet } from '../engine/wallet.js';
import { session } from '../session.js';
import { FLOORS } from '../climb/floors.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { hud, formatChips } from '../ui/hud.js';
import { el, cardElement, setCardFaceUp } from '../ui/svg.js';
import { sleep } from '../ui/arcade.js';
import { PAYTABLE, MAX_COINS, evaluateHand, payPerCoin, dealHand, drawCards, newDeck } from './video_poker-math.js';

const ROUND_KEY = scopedKey('crd.videopoker.round.v1');
const PREFS_KEY = scopedKey('crd.videopoker.prefs.v1');
const DEAL_STEP_MS = 110;
const FLIP_MS = 560;
const round2 = (value) => Math.round(value * 100) / 100;
const DECK = new Set(newDeck());
// Valores de moneda de todos los pisos (una mano a medias se reanuda con el suyo).
const ALL_COINS = new Set(FLOORS.flatMap((floor) => floor.lists.video_poker ?? []));

function validRound(raw) {
  if (!raw || typeof raw !== 'object' || !(Number(raw.stake) > 0)) return false;
  if (!ALL_COINS.has(raw.coinValue) || !Number.isInteger(raw.coins) || raw.coins < 1 || raw.coins > MAX_COINS) return false;
  if (!Array.isArray(raw.deck) || raw.deck.length !== 52 || new Set(raw.deck).size !== 52 || !raw.deck.every((card) => DECK.has(card))) return false;
  if (!Array.isArray(raw.holds) || raw.holds.length !== 5) return false;
  return Boolean(raw.meta && Number.isInteger(raw.meta.nonce));
}

export class VideoPokerGame {
  #root;
  #dom;
  #coinValue = 10;
  #coins = MAX_COINS;
  #round = null;
  #hand = [];
  #holds = [false, false, false, false, false];
  #slots = [];
  #busy = false;
  #lastRow = null;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      paytable: $('vp-paytable'),
      hand: $('vp-hand'),
      message: $('vp-message'),
      coinValues: $('vp-coin-values'),
      coins: $('vp-coins'),
      stake: $('vp-stake'),
      max: $('vp-max'),
      deal: $('vp-deal'),
      rules: $('vp-rules'),
    };
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    this.#coinValue = prefs.coinValue;
    this.#fitCoin();
    this.#coins = Number.isInteger(prefs.coins) && prefs.coins >= 1 && prefs.coins <= MAX_COINS ? prefs.coins : MAX_COINS;
    this.#buildControls();
    this.#buildHand();
    this.#dom.rules.textContent = 'Jacks or Better 9/6: Full 9 y Color 6 por moneda. Pagos «por 1» (incluyen la apuesta). Con estrategia óptima y 5 monedas el retorno es del 99,54 %; con menos monedas la Escalera Real paga 250 en vez de 800. Toca una carta o su botón para retenerla.';
    session.register('video_poker', {
      hasPendingPlay: () => this.#round !== null || this.#busy,
      onZone: () => {
        this.#fitCoin();
        this.#buildCoinValues();
        this.#renderPaytable();
        this.#render();
      },
    });
    this.#recover();
    this.#renderPaytable();
    this.#render();
  }

  // ---------- Construcción ----------

  // Valores de moneda del piso actual.
  #coinList() {
    return session.limits('video_poker').coins;
  }

  #fitCoin() {
    const values = this.#coinList();
    if (!values.includes(this.#coinValue)) this.#coinValue = values[0];
  }

  #buildCoinValues() {
    this.#dom.coinValues.replaceChildren(...this.#coinList().map((value) => {
      const button = el('button', 'seg', formatChips(value));
      button.type = 'button';
      button.dataset.value = String(value);
      button.addEventListener('click', () => {
        if (this.#round || this.#busy) return;
        audio.click();
        this.#coinValue = value;
        this.#savePrefs();
        this.#renderPaytable();
        this.#render();
      });
      return button;
    }));
  }

  #buildControls() {
    const d = this.#dom;
    this.#buildCoinValues();
    d.coins.replaceChildren(...Array.from({ length: MAX_COINS }, (_, i) => {
      const coins = i + 1;
      const button = el('button', 'seg', String(coins));
      button.type = 'button';
      button.dataset.coins = String(coins);
      button.setAttribute('aria-label', `${coins} moneda${coins === 1 ? '' : 's'}`);
      button.addEventListener('click', () => {
        if (this.#round || this.#busy) return;
        audio.click();
        this.#coins = coins;
        this.#savePrefs();
        this.#renderPaytable();
        this.#render();
      });
      return button;
    }));
    d.max.addEventListener('click', () => {
      if (this.#round || this.#busy) return;
      this.#coins = MAX_COINS;
      this.#savePrefs();
      this.#renderPaytable();
      this.deal();
    });
    d.deal.addEventListener('click', () => (this.#round ? this.draw() : this.deal()));
    wallet.addEventListener('update', () => this.#render());
  }

  #buildHand() {
    this.#slots = Array.from({ length: 5 }, (_, i) => {
      const slot = el('div', 'vp-slot');
      const holder = el('div', 'vp-card');
      const hold = el('button', 'vp-hold', 'RETENER');
      hold.type = 'button';
      hold.setAttribute('aria-pressed', 'false');
      hold.addEventListener('click', () => this.toggleHold(i));
      holder.addEventListener('click', () => this.toggleHold(i));
      slot.append(holder, hold);
      return { slot, holder, hold, card: null };
    });
    this.#dom.hand.replaceChildren(...this.#slots.map((s) => s.slot));
    for (const slot of this.#slots) this.#placeCard(slot, 'AS', false);
  }

  #placeCard(slot, code, faceUp) {
    const card = cardElement(code);
    setCardFaceUp(card, faceUp);
    slot.holder.replaceChildren(card);
    slot.card = card;
    return card;
  }

  #savePrefs() {
    storage.write(PREFS_KEY, { coinValue: this.#coinValue, coins: this.#coins });
  }

  #save() {
    const r = this.#round;
    if (r) storage.write(ROUND_KEY, { stake: r.stake, coinValue: r.coinValue, coins: r.coins, deck: r.deck, holds: this.#holds, meta: r.meta });
    else storage.remove(ROUND_KEY);
  }

  #recover() {
    const saved = storage.read(ROUND_KEY, null);
    if (validRound(saved) && wallet.escrowOf('video_poker') >= saved.stake - 1e-9) {
      this.#round = { ...saved, hand: saved.deck.slice(0, 5), stream: { meta: saved.meta } };
      this.#coinValue = saved.coinValue;
      this.#coins = saved.coins;
      this.#hand = this.#round.hand;
      this.#holds = saved.holds.map(Boolean);
      this.#slots.forEach((slot, i) => this.#placeCard(slot, this.#hand[i], true));
      this.#dom.message.textContent = 'Mano recuperada: elige qué cartas retener y pulsa Cambiar';
      return;
    }
    storage.remove(ROUND_KEY);
    if (wallet.escrowOf('video_poker') > 0) wallet.refund('video_poker');
  }

  // ---------- Jugada ----------

  async deal() {
    if (this.#round || this.#busy) return;
    const stake = this.#coinValue * this.#coins;
    if (!wallet.hold('video_poker', stake)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      return;
    }
    this.#busy = true;
    this.#lastRow = null;
    session.beginRound({ game: 'video_poker', stake });
    const stream = session.stream('video_poker');
    const { deck, hand } = dealHand(stream);
    this.#round = { stake, coinValue: this.#coinValue, coins: this.#coins, deck, hand, meta: stream.meta, stream };
    this.#hand = hand;
    this.#holds = [false, false, false, false, false];
    this.#save();
    this.#renderPaytable();
    this.#render();
    audio.shuffle();
    for (let i = 0; i < 5; i++) {
      const card = this.#placeCard(this.#slots[i], hand[i], false);
      card.classList.add('is-dealing');
      audio.cardSlide();
      await sleep(DEAL_STEP_MS);
      setCardFaceUp(card, true);
    }
    await sleep(FLIP_MS * 0.6);
    this.#busy = false;
    const row = evaluateHand(hand);
    this.#dom.message.textContent = row ? `Ya tienes ${row.name}: retén las cartas y cambia el resto` : 'Elige qué cartas retener y pulsa Cambiar';
    this.#render();
  }

  toggleHold(index) {
    if (!this.#round || this.#busy) return;
    this.#holds[index] = !this.#holds[index];
    audio.hold();
    this.#save();
    this.#render();
  }

  async draw() {
    const round = this.#round;
    if (!round || this.#busy) return;
    this.#busy = true;
    this.#render();
    const final = drawCards(round.deck, round.hand, this.#holds);
    const row = evaluateHand(final);
    const pays = payPerCoin(row, round.coins);
    const payout = round2(round.coinValue * round.coins * pays);
    wallet.settle('video_poker', round.stake, payout);
    const holds = [...this.#holds];
    this.#round = null;
    this.#save();

    for (let i = 0; i < 5; i++) {
      if (holds[i]) continue;
      setCardFaceUp(this.#slots[i].card, false);
    }
    await sleep(FLIP_MS * 0.7);
    for (let i = 0; i < 5; i++) {
      if (holds[i]) continue;
      const card = this.#placeCard(this.#slots[i], final[i], false);
      card.classList.add('is-dealing');
      audio.cardSlide();
      await sleep(DEAL_STEP_MS);
      setCardFaceUp(card, true);
    }
    await sleep(FLIP_MS * 0.6);

    wallet.reveal('video_poker');
    this.#hand = final;
    this.#lastRow = row;
    session.record(round.stream, { stake: round.stake, payout, summary: `${final.join(' ')} → ${row ? row.name : 'sin premio'}`, params: { holds, coins: round.coins } });
    session.report({ game: 'video_poker', stake: round.stake, returned: payout, tags: row ? [`vp-${row.id}`] : [] });
    if (row) {
      const big = ['royal', 'straightFlush', 'fourKind'].includes(row.id);
      audio.win(big ? 3 : pays >= 6 ? 2 : 1);
      const rect = this.#dom.hand.getBoundingClientRect();
      hud.celebrate(big ? 3 : pays >= 6 ? 2 : 1, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      this.#dom.message.textContent = `${row.name}: cobras ${formatChips(payout)} (${pays} por 1)`;
    } else {
      audio.lose();
      this.#dom.message.textContent = 'Sin premio. ¡Otra mano!';
    }
    this.#busy = false;
    this.#holds = [false, false, false, false, false];
    this.#renderPaytable();
    this.#render();
  }

  // ---------- Render ----------

  #renderPaytable() {
    const coins = this.#round?.coins ?? this.#coins;
    const head = el('tr');
    head.append(el('th', '', 'Jugada'));
    for (let c = 1; c <= MAX_COINS; c++) {
      const th = el('th', c === coins ? 'is-current' : '', String(c));
      th.setAttribute('aria-label', `${c} moneda${c === 1 ? '' : 's'}`);
      head.append(th);
    }
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    for (const row of PAYTABLE) {
      const tr = el('tr', this.#lastRow?.id === row.id ? 'is-hit' : '');
      tr.append(el('th', '', row.name));
      for (let c = 1; c <= MAX_COINS; c++) tr.append(el('td', c === coins ? 'is-current' : '', formatChips(payPerCoin(row, c) * c)));
      body.append(tr);
    }
    this.#dom.paytable.replaceChildren(thead, body);
  }

  #render() {
    const d = this.#dom;
    const round = this.#round;
    const coins = round?.coins ?? this.#coins;
    const coinValue = round?.coinValue ?? this.#coinValue;
    const stake = coinValue * coins;
    for (const button of d.coinValues.querySelectorAll('[data-value]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.value) === coinValue));
      button.disabled = Boolean(round) || this.#busy;
    }
    for (const button of d.coins.querySelectorAll('[data-coins]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.coins) === coins));
      button.disabled = Boolean(round) || this.#busy;
    }
    d.stake.textContent = formatChips(stake);
    d.max.disabled = Boolean(round) || this.#busy || !wallet.canAfford(coinValue * MAX_COINS);
    d.deal.disabled = this.#busy || (!round && !wallet.canAfford(stake));
    d.deal.textContent = round ? 'Cambiar' : `Repartir · ${formatChips(stake)}`;
    this.#slots.forEach((slot, i) => {
      const held = Boolean(round) && this.#holds[i];
      slot.slot.classList.toggle('is-held', held);
      slot.hold.setAttribute('aria-pressed', String(held));
      slot.hold.disabled = !round || this.#busy;
      slot.hold.textContent = held ? 'RETENIDA' : 'RETENER';
      slot.hold.setAttribute('aria-label', `Retener la carta ${i + 1}`);
      slot.holder.classList.toggle('is-clickable', Boolean(round) && !this.#busy);
    });
  }

  onShow() {
    this.#render();
  }

  onHide() {}
}
