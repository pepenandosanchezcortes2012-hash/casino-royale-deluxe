// Panel de telemetría de la torre: compromiso de la semilla del servidor (hash SHA-256), semilla
// del cliente editable, nonce, rotación con revelado, RTP real y las apuestas en vivo. Incluye el
// verificador: recalcula cualquier jugada con la semilla ya revelada. Las apuestas en vivo se
// pintan por lotes (como mucho cada 200 ms): el disparo continuo de Cyber-Fish genera varias por
// segundo.

import { fair, isValidClientSeed } from '../provably_fair.js';
import { verifyBet, GAME_NAMES } from '../verify.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../audio.js';
import { hud, formatChips } from './hud.js';
import { el } from './svg.js';

const FEED_LIMIT = 24;
const FLUSH_MS = 200;
// Ejemplo de parámetros por juego para el verificador.
const PARAMS_HINT = Object.freeze({
  mines: '{"mines":3}',
  towers: '{"difficulty":"easy"}',
  dice: '{"chance":49,"direction":"under"}',
  plinko: '{"risk":"low"}',
  fish: '{"species":"jelly","multiplier":8}',
  video_poker: '{"holds":[true,true,false,false,true],"coins":5}',
});
const pct = (value) => `${(value * 100).toFixed(2).replace('.', ',')} %`;
const mult = (value) => `×${value.toFixed(2).replace('.', ',')}`;

class Telemetry {
  #dom = null;
  #queue = [];
  #timer = 0;
  #dirty = { seeds: false, stats: false, feed: false };

  init() {
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      hash: $('tele-hash'),
      client: $('tele-client'),
      nonce: $('tele-nonce'),
      apply: $('tele-apply'),
      rotate: $('tele-rotate'),
      verify: $('tele-verify'),
      revealed: $('tele-revealed'),
      wagered: $('tele-wagered'),
      paid: $('tele-paid'),
      rtp: $('tele-rtp'),
      feed: $('tele-feed'),
      dialog: $('verify-dialog'),
      close: $('verify-close'),
      game: $('verify-game'),
      server: $('verify-server'),
      serverHash: $('verify-hash'),
      clientSeed: $('verify-client'),
      nonceInput: $('verify-nonce'),
      params: $('verify-params'),
      run: $('verify-run'),
      result: $('verify-result'),
    };
    const d = this.#dom;
    d.game.replaceChildren(...Object.entries(GAME_NAMES).map(([id, name]) => {
      const option = el('option', '', name);
      option.value = id;
      return option;
    }));
    this.#bind();
    this.#renderSeeds();
    this.#renderStats();
    this.#renderFeed();
  }

  #bind() {
    const d = this.#dom;
    d.apply.addEventListener('click', () => this.#applyClientSeed());
    d.client.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#applyClientSeed();
      }
    });
    d.rotate.addEventListener('click', () => this.rotate());
    d.verify.addEventListener('click', () => this.openVerifier());
    d.close.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('click', (event) => {
      if (event.target === d.dialog) d.dialog.close();
    });
    d.run.addEventListener('click', () => this.#runVerifier());
    d.game.addEventListener('change', () => {
      d.params.placeholder = PARAMS_HINT[d.game.value] ?? '{}';
    });
    fair.addEventListener('change', () => this.#schedule('seeds'));
    fair.addEventListener('bet', (event) => {
      this.#queue.push(event.detail.entry);
      if (this.#queue.length > FEED_LIMIT) this.#queue.splice(0, this.#queue.length - FEED_LIMIT);
      this.#schedule('feed');
    });
    fair.addEventListener('rotate', () => {
      this.#queue = [];
      this.#renderFeed();
    });
    wallet.addEventListener('update', () => this.#schedule('stats'));
  }

  // Agrupa los repintados en un solo paso cada FLUSH_MS.
  #schedule(part) {
    this.#dirty[part] = true;
    if (this.#timer) return;
    this.#timer = setTimeout(() => this.#flush(), FLUSH_MS);
  }

  #flush() {
    this.#timer = 0;
    const dirty = this.#dirty;
    this.#dirty = { seeds: false, stats: false, feed: false };
    if (dirty.seeds) this.#renderSeeds();
    if (dirty.stats) this.#renderStats();
    if (dirty.feed && this.#queue.length) {
      const entries = this.#queue;
      this.#queue = [];
      this.#prependFeed(entries);
    }
  }

  // ---------- Semillas ----------

  #renderSeeds() {
    const d = this.#dom;
    const c = fair.commitment;
    d.hash.textContent = c.serverSeedHash;
    d.hash.title = c.serverSeedHash;
    if (document.activeElement !== d.client) d.client.value = c.clientSeed;
    d.nonce.textContent = String(c.nonce);
    const last = fair.revealed.at(-1);
    d.revealed.textContent = last ? `Última semilla revelada: ${last.serverSeed.slice(0, 20)}… (${last.nonces} jugadas verificables)` : 'Rota la semilla para revelarla y verificar tus jugadas.';
  }

  #applyClientSeed() {
    const d = this.#dom;
    const value = d.client.value.trim();
    if (value === fair.commitment.clientSeed) return;
    if (!isValidClientSeed(value)) {
      hud.toast('Semilla del cliente no válida: 1 a 64 caracteres visibles, sin espacios', 'warn');
      d.client.value = fair.commitment.clientSeed;
      return;
    }
    fair.setClientSeed(value);
    audio.click();
    hud.toast('Semilla del cliente aplicada: la semilla anterior del servidor queda revelada', 'success');
  }

  rotate() {
    const revealed = fair.rotate();
    audio.shimmer();
    hud.toast(`Semilla revelada (${revealed.nonces} jugadas). Nuevo compromiso publicado.`, 'success', 3800);
    return revealed;
  }

  #renderStats() {
    const d = this.#dom;
    const { wagered, paid } = wallet.totals;
    d.wagered.textContent = formatChips(wagered);
    d.paid.textContent = formatChips(paid);
    d.rtp.textContent = wagered > 0 ? pct(paid / wagered) : '—';
  }

  // ---------- Apuestas en vivo ----------

  #feedItem(entry) {
    const item = el('li', 'tele-bet');
    const won = entry.payout > entry.stake;
    item.classList.toggle('is-win', won);
    item.classList.toggle('is-loss', entry.stake > 0 && entry.payout < entry.stake);
    const button = el('button', 'tele-bet-btn');
    button.type = 'button';
    button.append(
      el('span', 'tele-bet-game', GAME_NAMES[entry.game] ?? entry.game),
      el('span', 'tele-bet-nonce', `#${entry.nonce}`),
      el('span', 'tele-bet-mult', entry.stake > 0 ? mult(entry.multiplier) : '—'),
      el('span', 'tele-bet-pay', entry.stake > 0 ? `${won ? '+' : ''}${formatChips(Math.round((entry.payout - entry.stake) * 100) / 100)}` : entry.summary.slice(0, 18)),
    );
    button.setAttribute('aria-label', `${GAME_NAMES[entry.game] ?? entry.game}, nonce ${entry.nonce}: ${entry.summary}. Verificar`);
    button.title = entry.summary;
    button.addEventListener('click', () => this.openVerifier(entry));
    item.append(button);
    return item;
  }

  #renderFeed() {
    const history = fair.history.slice(-FEED_LIMIT).reverse();
    if (!history.length) {
      this.#dom.feed.replaceChildren(el('li', 'tele-empty', 'Tus apuestas aparecerán aquí, con su nonce para verificarlas.'));
      return;
    }
    this.#dom.feed.replaceChildren(...history.map((entry) => this.#feedItem(entry)));
  }

  // Añade de una vez las apuestas acumuladas (la más reciente queda arriba).
  #prependFeed(entries) {
    const feed = this.#dom.feed;
    feed.querySelector('.tele-empty')?.remove();
    const items = entries.slice(-FEED_LIMIT).reverse().map((entry) => {
      const item = this.#feedItem(entry);
      item.classList.add('is-new');
      return item;
    });
    feed.prepend(...items);
    while (feed.children.length > FEED_LIMIT) feed.lastElementChild.remove();
  }

  // ---------- Verificador ----------

  // Semilla revelada con la que se jugó una entrada del historial (null si sigue oculta).
  #seedFor(entry) {
    return fair.revealedFor(entry.serverSeedHash)?.serverSeed ?? null;
  }

  // Verificación por nonce para la terminal: la entrada más reciente con ese nonce.
  verifyNonce(nonce) {
    const entries = fair.history.filter((entry) => entry.nonce === nonce);
    if (!entries.length) return { ok: false, error: `No hay ninguna apuesta registrada con el nonce ${nonce}.` };
    const entry = entries.at(-1);
    const serverSeed = this.#seedFor(entry);
    if (!serverSeed) return { ok: false, hidden: true, error: `La semilla del nonce ${nonce} sigue comprometida: ejecuta \`rotate\` para revelarla y vuelve a verificar.` };
    return verifyBet({ game: entry.game, serverSeed, serverSeedHash: entry.serverSeedHash, clientSeed: entry.clientSeed, nonce: entry.nonce, params: entry.params });
  }

  openVerifier(entry = null) {
    const d = this.#dom;
    d.result.replaceChildren();
    if (entry) {
      d.game.value = entry.game;
      d.nonceInput.value = String(entry.nonce);
      d.clientSeed.value = entry.clientSeed;
      d.serverHash.value = entry.serverSeedHash;
      d.server.value = this.#seedFor(entry) ?? '';
      d.params.value = JSON.stringify(entry.params ?? {});
      d.params.placeholder = PARAMS_HINT[entry.game] ?? '{}';
    } else if (!d.server.value) {
      const last = fair.revealed.at(-1);
      if (last) {
        d.server.value = last.serverSeed;
        d.serverHash.value = last.serverSeedHash;
        d.clientSeed.value = last.clientSeed;
        d.nonceInput.value = '0';
        d.params.value = '{}';
      }
    }
    audio.click();
    if (!d.dialog.open) d.dialog.showModal();
    if (entry && !d.server.value) this.#hiddenNotice(entry);
    else if (d.server.value) this.#runVerifier();
  }

  #hiddenNotice() {
    const d = this.#dom;
    const note = el('div', 'verify-note');
    const text = el('p', '', 'Esta jugada usa la semilla del servidor comprometida ahora mismo: su hash se publicó antes de apostar, pero la semilla se revela al rotarla (y la rotación empieza una semilla nueva).');
    const button = el('button', 'btn btn-primary', 'Rotar y revelar ahora');
    button.type = 'button';
    button.addEventListener('click', () => {
      const revealed = this.rotate();
      d.server.value = revealed.serverSeed;
      this.#runVerifier();
    });
    note.append(text, button);
    d.result.replaceChildren(note);
  }

  #runVerifier() {
    const d = this.#dom;
    let params = {};
    try {
      params = d.params.value.trim() ? JSON.parse(d.params.value) : {};
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('objeto');
    } catch {
      d.result.replaceChildren(el('p', 'verify-error', 'Los parámetros deben ser un objeto JSON, por ejemplo {"mines":3}.'));
      return;
    }
    const result = verifyBet({
      game: d.game.value,
      serverSeed: d.server.value.trim().toLowerCase(),
      serverSeedHash: d.serverHash.value.trim().toLowerCase() || null,
      clientSeed: d.clientSeed.value.trim(),
      nonce: Number(d.nonceInput.value),
      params,
    });
    if (!result.ok) {
      d.result.replaceChildren(el('p', 'verify-error', result.error));
      return;
    }
    const list = el('dl', 'verify-rows');
    const row = (label, value, tone = '') => {
      const item = el('div', tone ? `is-${tone}` : '');
      item.append(el('dt', '', label), el('dd', '', value));
      list.append(item);
    };
    if (result.seedOk !== null) row('SHA-256(semilla)', result.seedOk ? '✔ coincide con el hash publicado' : '✘ no coincide con el hash publicado', result.seedOk ? 'ok' : 'bad');
    row('Mensaje HMAC', result.message);
    row('HMAC-SHA256', result.hmac);
    row('8 primeros hex', `${result.first8} → ${result.int}`);
    row('Primer número', `${result.int} / 2^32 = ${result.float.toFixed(10)}`);
    for (const [label, value] of result.rows) row(label, value);
    row('Resultado', result.outcome, 'ok');
    d.result.replaceChildren(el('p', 'verify-title', `${result.name} · nonce ${d.nonceInput.value} · ${result.used} número${result.used === 1 ? '' : 's'} del flujo`), list);
  }
}

export const telemetry = new Telemetry();
