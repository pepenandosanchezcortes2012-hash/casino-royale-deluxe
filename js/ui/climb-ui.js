// Interfaz de «The Syndicate Climb»: piso actual y selector de pisos del HUD, barra hacia los
// 10.000.000, limosna con cuenta atrás, aviso de saldo bajo, Bitácora del Sindicato y encargos,
// prólogo, tarjeta de acceso al desbloquear un piso, transición del ascensor, jugadas críticas,
// epílogo interactivo, mapa de la torre y expediente con logros y salón de la fama.
// Todo el texto se escribe con textContent.

import { climb } from '../climb/climb.js';
import { FLOORS, GOAL, gameFloor, floorById, rangeText } from '../climb/floors.js';
import { ACHIEVEMENTS } from '../climb/achievements.js';
import { PROLOGUE, EPILOGUE } from '../climb/narrative.js';
import { GAME_NAMES } from '../verify.js';
import { wallet } from '../engine/wallet.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { audio } from '../audio.js';
import { hud, formatChips } from './hud.js';
import { el } from './svg.js';

const SIDE_KEY = scopedKey('crd.side.v1');
const LOG_VISIBLE = 40;
const timeFormat = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 2 });

function duration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

const mmss = (ms) => {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const range = (floor) => rangeText(floor, formatChips);

// Máquina de escribir: revela párrafos carácter a carácter; skip() lo completa al instante.
class Typewriter {
  #timer = 0;
  #finish = null;

  play(container, paragraphs, { speed = 26, sound = true } = {}) {
    this.skip();
    container.replaceChildren();
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const nodes = paragraphs.map((text) => {
      const p = el('p', 'cine-line');
      container.append(p);
      return { p, text };
    });
    return new Promise((resolve) => {
      let line = 0;
      let char = 0;
      this.#finish = () => {
        clearTimeout(this.#timer);
        for (const { p, text } of nodes) p.textContent = text;
        nodes.forEach(({ p }) => p.classList.add('is-shown'));
        this.#finish = null;
        resolve();
      };
      if (reduced) {
        this.#finish();
        return;
      }
      const step = () => {
        const node = nodes[line];
        if (!node) {
          this.#finish?.();
          return;
        }
        node.p.classList.add('is-shown');
        char = Math.min(node.text.length, char + 2);
        node.p.textContent = node.text.slice(0, char);
        if (sound && char % 6 === 0) audio.typeTick();
        if (char >= node.text.length) {
          line += 1;
          char = 0;
          this.#timer = setTimeout(step, 420);
        } else {
          this.#timer = setTimeout(step, speed);
        }
      };
      step();
    });
  }

  skip() {
    this.#finish?.();
  }
}

class ClimbUi {
  #dom;
  #games = {};
  #onApply = () => {};
  #typer = new Typewriter();
  #criticalTimer = 0;
  #rescueTimer = 0;
  #brokeTimer = 0;
  #restartArmed = false;
  #replaying = false;
  #pendingUnlocks = [];
  #shown = { balance: null, floor: null, unlocked: null };

  // `games` = mesas por id; `onApply(floor)` se llama cada vez que cambia el piso visible
  // (tema, tinte de las partículas, pestañas…).
  init({ games, onApply }) {
    this.#games = games;
    this.#onApply = onApply ?? (() => {});
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      root: document.documentElement,
      tower: $('btn-tower'),
      floorNum: $('hud-floor-num'),
      floorName: $('hud-floor-name'),
      floorRange: $('hud-floor-range'),
      selector: $('floor-selector'),
      goalTrack: $('goal-track'),
      goalFill: $('goal-fill'),
      goalText: $('goal-text'),
      rescue: $('btn-rescue'),
      rescueText: $('rescue-text'),
      dossierButton: $('btn-dossier'),
      hudTitle: $('hud-title'),
      hudRecord: $('hud-record'),
      notice: $('floor-notice'),
      ticker: $('log-ticker'),
      sideTabs: [$('side-tab-syndicate'), $('side-tab-telemetry')],
      sidePanels: [$('side-syndicate'), $('telemetry')],
      logDealer: $('log-dealer'),
      logList: $('log-list'),
      contracts: $('contract-list'),
      contractsTitle: $('contract-title'),
      intro: $('intro'),
      introText: $('intro-text'),
      introRun: $('intro-run'),
      introSkip: $('intro-skip'),
      introEnter: $('intro-enter'),
      unlock: $('unlock-dialog'),
      unlockKicker: $('unlock-kicker'),
      unlockCard: $('unlock-card'),
      unlockFloor: $('unlock-floor'),
      unlockCardName: $('unlock-card-name'),
      unlockTitle: $('unlock-title'),
      unlockText: $('unlock-text'),
      unlockGames: $('unlock-games'),
      unlockLater: $('unlock-later'),
      unlockGo: $('unlock-go'),
      epilogue: $('epilogue'),
      epilogueText: $('epilogue-text'),
      epilogueStats: $('epilogue-stats'),
      throneForm: $('throne-form'),
      throneName: $('throne-name'),
      throneOwner: $('throne-owner'),
      epilogueContinue: $('epilogue-continue'),
      epilogueRestart: $('epilogue-restart'),
      towerDialog: $('tower-dialog'),
      towerClose: $('tower-close'),
      towerText: $('tower-text'),
      towerFloors: $('tower-floors'),
      dossier: $('dossier'),
      dossierBody: $('dossier-body'),
      dossierClose: $('dossier-close'),
      dossierPrologue: $('dossier-prologue'),
      dossierRestart: $('dossier-restart'),
      transition: $('floor-transition'),
      transitionLevel: $('ft-level'),
      transitionName: $('ft-name'),
      transitionDesc: $('ft-desc'),
    };
    this.#buildSelector();
    this.#bindSide();
    this.#bind();
    this.#applyFloor(climb.floor);
    this.#renderLog();
    this.#render();

    const status = climb.status;
    if (status === 'intro') this.#showIntro();
    else if (status === 'victory' && !climb.owner) this.#showEpilogue(false);
    else setTimeout(() => climb.checkEnd(), 400);
  }

  // ---------- Construcción y eventos ----------

  #buildSelector() {
    const buttons = FLOORS.map((floor) => {
      const button = el('button', 'floor-door');
      button.type = 'button';
      button.dataset.floor = floor.id;
      button.append(el('span', 'floor-door-num', String(floor.level)), el('span', 'floor-door-lock', '🔒'));
      button.addEventListener('click', () => this.travel(floor.id));
      return button;
    });
    this.#dom.selector.replaceChildren(...buttons);
  }

  #bindSide() {
    const { sideTabs, sidePanels } = this.#dom;
    const select = (index, focus = false) => {
      sideTabs.forEach((tab, i) => {
        const on = i === index;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        sidePanels[i].hidden = !on;
        if (on && focus) tab.focus();
      });
      storage.write(SIDE_KEY, index);
    };
    sideTabs.forEach((tab, i) => {
      tab.addEventListener('click', () => {
        audio.click();
        select(i);
      });
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        select((i + 1) % sideTabs.length, true);
      });
    });
    const saved = storage.read(SIDE_KEY, 0);
    select(saved === 1 ? 1 : 0);
    this.showSide = (which) => select(which === 'telemetry' ? 1 : 0);
  }

  #bind() {
    const d = this.#dom;
    climb.addEventListener('update', () => this.#render());
    climb.addEventListener('log', (event) => this.#appendLog(event.detail.entry));
    climb.addEventListener('floor', (event) => this.#transition(event.detail.floor));
    climb.addEventListener('critical', (event) => this.#onCritical(event.detail));
    climb.addEventListener('round', (event) => this.#onRound(event.detail));
    climb.addEventListener('achievement', (event) => this.#onAchievement(event.detail.achievement));
    climb.addEventListener('contract', (event) => this.#onContract(event.detail));
    climb.addEventListener('unlock', (event) => this.#onUnlock(event.detail.floor));
    climb.addEventListener('title', (event) => this.#onTitle(event.detail));
    climb.addEventListener('rescue', (event) => this.#onRescue(event.detail));
    climb.addEventListener('broke', () => this.#onBroke());
    climb.addEventListener('status', (event) => this.#onStatus(event.detail.status));
    wallet.addEventListener('update', () => this.#renderLight());

    d.tower.addEventListener('click', () => this.openTower());
    d.towerClose.addEventListener('click', () => d.towerDialog.close());
    d.towerDialog.addEventListener('click', (event) => {
      if (event.target === d.towerDialog) d.towerDialog.close();
    });
    d.rescue.addEventListener('click', () => this.takeRescue());
    d.dossierButton.addEventListener('click', () => this.#openDossier());
    d.dossierClose.addEventListener('click', () => d.dossier.close());
    d.dossier.addEventListener('click', (event) => {
      if (event.target === d.dossier) d.dossier.close();
    });
    d.dossier.addEventListener('close', () => this.#disarmRestart());
    d.dossierPrologue.addEventListener('click', () => {
      d.dossier.close();
      this.#showIntro(true);
    });
    d.dossierRestart.addEventListener('click', () => this.#confirmRestart());
    d.ticker.addEventListener('click', () => {
      this.showSide?.('syndicate');
      document.getElementById('side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    d.introSkip.addEventListener('click', () => this.#typer.skip());
    d.introEnter.addEventListener('click', () => this.#enter());
    d.unlockLater.addEventListener('click', () => d.unlock.close());
    d.unlockGo.addEventListener('click', () => {
      const id = d.unlock.dataset.floor;
      d.unlock.close();
      if (id) this.travel(id);
    });
    d.unlock.addEventListener('close', () => this.#nextUnlock());
    d.throneForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this.#claimThrone();
    });
    d.epilogueContinue.addEventListener('click', () => {
      if (!climb.owner) this.#claimThrone();
      d.epilogue.close();
    });
    d.epilogueRestart.addEventListener('click', () => this.#restart());

    // Las cinemáticas no se cierran con Escape: solo con sus botones.
    for (const dialog of [d.intro, d.epilogue]) dialog.addEventListener('cancel', (event) => event.preventDefault());
    d.intro.addEventListener('close', () => {
      if (climb.status === 'intro') requestAnimationFrame(() => this.#enter());
    });
    document.addEventListener('visibilitychange', () => this.#renderRescue());
  }

  // ---------- Pisos ----------

  // Toma el ascensor (desde el selector, la torre, la tarjeta de acceso o la terminal).
  travel(id) {
    if (id === climb.floor.id) return { ok: false, reason: 'here' };
    const status = climb.travel(id);
    if (status.ok) {
      audio.click();
      return status;
    }
    audio.click();
    if (status.reason === 'pending') hud.toast('Termina las apuestas en juego antes de tomar el ascensor', 'warn');
    else if (status.reason === 'locked') hud.toast(`Necesitas la tarjeta de acceso: reúne ${formatChips(status.need)} créditos`, 'warn');
    return status;
  }

  // Pide la limosna (desde el HUD o la terminal).
  takeRescue() {
    const amount = climb.takeRescue();
    if (!amount) {
      const status = climb.rescueStatus();
      if (status.broke) hud.toast(`La próxima limosna llega en ${mmss(status.wait)}`, 'warn');
      else hud.toast('La limosna solo se concede con el saldo a cero y sin apuestas en juego', 'warn');
    }
    return amount;
  }

  #applyFloor(floor) {
    const root = this.#dom.root;
    root.dataset.floor = String(floor.level);
    root.dataset.zone = floor.id;
    hud.setDenominations(floor.chips);
    if (climb.playable || climb.status === 'intro') {
      audio.setMood(climb.status === 'victory' ? 'finale' : floor.mood);
      audio.setTension(floor.tension);
    }
    this.#onApply(floor);
    this.#render();
  }

  #transition(floor) {
    const d = this.#dom;
    d.transitionLevel.textContent = `Piso ${floor.level}`;
    d.transitionName.textContent = floor.name;
    d.transitionDesc.textContent = floor.tagline;
    d.transition.hidden = false;
    d.transition.dataset.floor = String(floor.level);
    d.transition.classList.remove('is-out');
    void d.transition.offsetWidth;
    d.transition.classList.add('is-in');
    audio.whoosh();
    if (floor.level === 2) setTimeout(() => audio.neonBuzz(), 500);
    setTimeout(() => this.#applyFloor(floor), 420);
    setTimeout(() => {
      d.transition.classList.remove('is-in');
      d.transition.classList.add('is-out');
      setTimeout(() => {
        d.transition.hidden = true;
      }, 600);
    }, 1900);
  }

  openTower() {
    audio.click();
    this.#renderTower();
    if (!this.#dom.towerDialog.open) this.#dom.towerDialog.showModal();
  }

  #renderTower() {
    const d = this.#dom;
    const balance = wallet.balance;
    d.towerText.textContent = `Reúne ${formatChips(GOAL)} créditos para comprar tu libertad y el control del Sindicato. Cada tarjeta de acceso es permanente: podrás bajar y volver a subir cuando quieras.`;
    d.towerFloors.replaceChildren(...[...FLOORS].reverse().map((floor) => {
      const open = floor.level <= climb.unlockedLevel;
      const here = floor.id === climb.floor.id;
      const item = el('li', `tower-floor${here ? ' is-current' : ''}${open ? '' : ' is-locked'}`);
      item.dataset.floor = String(floor.level);
      const head = el('div', 'tower-floor-head');
      head.append(el('span', 'tower-floor-num', `P${floor.level}`), el('strong', 'tower-floor-name', floor.name));
      const games = floor.unlocks.map((game) => GAME_NAMES[game] ?? game).join(' · ');
      item.append(
        head,
        el('p', 'tower-floor-desc', floor.description),
        el('p', 'tower-floor-meta', `Apuestas ${range(floor)} · Abre: ${games} · Anfitrión: ${floor.host}, ${floor.hostRole}`),
      );
      const button = el('button', `btn ${here ? '' : open ? 'btn-primary' : ''}`, here ? 'Estás aquí' : open ? `Subir al piso ${floor.level}` : `Tarjeta a los ${formatChips(floor.unlockAt)}`);
      button.type = 'button';
      button.disabled = here || !open;
      if (!here && open && floor.level < climb.floor.level) button.textContent = `Bajar al piso ${floor.level}`;
      button.addEventListener('click', () => {
        if (this.travel(floor.id).ok) d.towerDialog.close();
      });
      if (!open) {
        const bar = el('span', 'tower-floor-progress');
        const fill = el('span', 'tower-floor-fill');
        fill.style.transform = `scaleX(${Math.min(1, balance / floor.unlockAt)})`;
        bar.append(fill);
        item.append(bar);
      }
      item.append(button);
      return item;
    }));
  }

  // ---------- Reacciones ----------

  #onCritical({ share }) {
    const floor = climb.floor;
    this.#dom.root.classList.add('is-critical');
    audio.sting();
    audio.riser(1.4);
    audio.startHeartbeat(floor.level >= 3 ? 96 : 84);
    audio.setTension(1);
    clearTimeout(this.#criticalTimer);
    this.#criticalTimer = setTimeout(() => this.#endCritical(null), 30000);
    this.#dom.root.style.setProperty('--critical-share', String(Math.min(1, share)));
  }

  #endCritical(win) {
    clearTimeout(this.#criticalTimer);
    const root = this.#dom.root;
    if (!root.classList.contains('is-critical') && win !== null) return;
    root.classList.remove('is-critical');
    audio.stopHeartbeat();
    audio.setTension(climb.floor.tension);
    if (win === null) return;
    const flash = win ? 'is-critical-win' : 'is-critical-loss';
    root.classList.add(flash);
    setTimeout(() => root.classList.remove(flash), 1300);
    if (win) audio.impact();
    else audio.doom();
  }

  #onRound({ critical, net }) {
    if (critical) this.#endCritical(net > 0);
  }

  #onAchievement(achievement) {
    const reward = achievement.reward > 0 ? ` · +${formatChips(achievement.reward)} créditos` : '';
    hud.toast(`Logro: ${achievement.name}${reward}`, 'success', 4200);
    audio.win(1);
    const rect = this.#dom.dossierButton.getBoundingClientRect();
    if (rect.width) hud.celebrate(1, { x: rect.left + rect.width / 2, y: rect.bottom });
  }

  #onContract({ contract, done }) {
    if (!done) return;
    hud.toast(`Encargo cumplido: +${formatChips(contract.reward)} créditos`, 'success', 3600);
    audio.chip();
    audio.win(1);
  }

  // Tarjeta de acceso: se muestra en cuanto las mesas están en reposo (una por piso).
  #onUnlock(floor) {
    audio.neonBuzz();
    this.#pendingUnlocks.push(floor.id);
    this.#dom.selector.querySelector(`[data-floor="${floor.id}"]`)?.classList.add('is-new');
    setTimeout(() => this.#nextUnlock(), 1200);
  }

  #nextUnlock() {
    const d = this.#dom;
    if (d.unlock.open || !this.#pendingUnlocks.length) return;
    if (climb.pending || document.querySelector('dialog[open]')) {
      setTimeout(() => this.#nextUnlock(), 1500);
      return;
    }
    const floor = floorById(this.#pendingUnlocks.shift());
    d.unlock.dataset.floor = floor.id;
    d.unlock.dataset.level = String(floor.level);
    d.unlockKicker.textContent = `Tarjeta de acceso · ${formatChips(floor.unlockAt)} créditos`;
    d.unlockFloor.textContent = `P${floor.level}`;
    d.unlockCardName.textContent = floor.card;
    d.unlockTitle.textContent = floor.name;
    d.unlockText.textContent = floor.description;
    d.unlockGames.replaceChildren(...floor.unlocks.map((game) => el('li', 'unlock-game', GAME_NAMES[game] ?? game)));
    d.unlockGo.textContent = `Subir al piso ${floor.level}`;
    d.unlockGo.disabled = floor.id === climb.floor.id;
    d.unlock.showModal();
    audio.fanfare();
    const rect = d.unlockCard.getBoundingClientRect();
    hud.celebrate(2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  #onTitle({ title, up }) {
    const node = this.#dom.hudTitle;
    node.classList.remove('is-changed', 'is-down');
    void node.offsetWidth;
    node.classList.add(up ? 'is-changed' : 'is-down');
    if (up) hud.toast(`Nuevo título: ${title.name}`, 'success');
  }

  #onRescue({ amount }) {
    hud.toast(`Limosna del Sindicato: +${formatChips(amount)} créditos. La próxima, dentro de 5 minutos`, 'success', 4200);
    audio.chip();
    audio.win(1);
    this.#renderRescue();
  }

  // Sin créditos: tras ver el resultado de la ronda se recuerda la limosna.
  #onBroke() {
    clearTimeout(this.#brokeTimer);
    this.#brokeTimer = setTimeout(() => {
      const status = climb.rescueStatus();
      if (!status.broke) return;
      hud.toast(status.available ? 'Sin créditos: pide la limosna del Sindicato (+10)' : `Sin créditos: la próxima limosna llega en ${mmss(status.wait)}`, 'warn', 4200);
      this.#dom.rescue.classList.remove('is-calling');
      void this.#dom.rescue.offsetWidth;
      this.#dom.rescue.classList.add('is-calling');
    }, 900);
    this.#renderRescue();
  }

  #onStatus(status) {
    if (status !== 'victory') return;
    for (const game of Object.values(this.#games)) game.onHide?.();
    this.#endCritical(null);
    setTimeout(() => this.#showEpilogue(true), 1600);
  }

  // ---------- Cinemáticas ----------

  #showIntro(replay = false) {
    const d = this.#dom;
    this.#replaying = replay;
    d.introRun.textContent = `Escalada nº ${climb.state.run}`;
    d.introEnter.textContent = replay ? 'Volver a la mesa' : 'Bajar al Subsuelo';
    if (!d.intro.open) d.intro.showModal();
    this.#typer.play(d.introText, PROLOGUE, { speed: 24 });
  }

  #enter() {
    const d = this.#dom;
    this.#typer.skip();
    if (d.intro.open) d.intro.close();
    if (this.#replaying) {
      this.#replaying = false;
      return;
    }
    if (climb.status !== 'intro') return;
    audio.unlock();
    climb.begin();
    this.#transition(climb.floor);
  }

  #stats() {
    const s = climb.state;
    const st = s.stats;
    const ended = s.ended ?? Date.now();
    return [
      ['Récord de la escalada', `${formatChips(climb.record)} cr`],
      ['Piso más alto', `${climb.unlockedFloor.level} · ${climb.unlockedFloor.short}`],
      ['Rondas jugadas', formatChips(st.rounds)],
      ['Victorias', formatChips(st.wins)],
      ['Mayor premio', `${formatChips(st.biggestWin)} cr`],
      ['Mejor multiplicador', st.bestMultiplier > 0 ? `×${formatChips(st.bestMultiplier)}` : '—'],
      ['Mejor racha', formatChips(st.bestStreak)],
      ['Encargos cumplidos', formatChips(st.contractsDone)],
      ['Limosnas', `${st.rescues} (${formatChips(st.rescueCredits)} cr)`],
      ['Logros', `${Object.keys(s.achievements).length} de ${ACHIEVEMENTS.length}`],
      ['Duración', duration(ended - s.started)],
    ];
  }

  #statList(container) {
    const items = this.#stats().map(([label, value]) => {
      const item = el('div', 'stat');
      item.append(el('dt', '', label), el('dd', '', value));
      return item;
    });
    container.replaceChildren(...items);
  }

  #showEpilogue(animate) {
    const d = this.#dom;
    this.#statList(d.epilogueStats);
    this.#renderThrone();
    if (!d.epilogue.open) d.epilogue.showModal();
    audio.setMood('finale');
    audio.setTension(0.2);
    this.#typer.play(d.epilogueText, EPILOGUE, { speed: animate ? 28 : 8, sound: animate });
    if (!animate) return;
    // El diálogo modal vive en la capa superior: el lienzo de partículas se mueve dentro.
    const canvas = document.getElementById('fx-canvas');
    if (canvas) d.epilogue.prepend(canvas);
    hud.goldStorm(12);
    audio.fanfare();
    d.epilogue.addEventListener('close', () => document.body.append(canvas), { once: true });
  }

  #renderThrone() {
    const d = this.#dom;
    const owner = climb.owner;
    d.throneForm.hidden = Boolean(owner);
    d.throneOwner.hidden = !owner;
    if (owner) d.throneOwner.textContent = `${owner.name}, Dueño Absoluto del Sindicato desde el ${dateFormat.format(new Date(owner.at))}.`;
  }

  #claimThrone() {
    const name = climb.claimThrone(this.#dom.throneName.value);
    if (!name) return;
    this.#renderThrone();
    audio.fanfare();
    hud.goldStorm(4);
    hud.toast(`${name} es el nuevo Dueño Absoluto del Sindicato`, 'success', 5200);
  }

  #restart() {
    if (!climb.restart()) {
      hud.toast('Termina las apuestas en juego antes de empezar otra escalada', 'warn');
      return;
    }
    location.reload();
  }

  #confirmRestart() {
    const button = this.#dom.dossierRestart;
    if (!this.#restartArmed) {
      this.#restartArmed = true;
      button.textContent = '¿Seguro? Vuelves a 10 créditos';
      button.classList.add('is-armed');
      return;
    }
    this.#restart();
  }

  #disarmRestart() {
    this.#restartArmed = false;
    this.#dom.dossierRestart.textContent = 'Empezar otra escalada';
    this.#dom.dossierRestart.classList.remove('is-armed');
  }

  // ---------- Expediente ----------

  #openDossier() {
    this.#renderDossier();
    audio.click();
    if (!this.#dom.dossier.open) this.#dom.dossier.showModal();
  }

  #renderDossier() {
    const s = climb.state;
    const hall = climb.hall;
    const floor = climb.floor;
    const head = el('section', 'dossier-head');
    head.append(
      el('p', 'dossier-kicker', `Escalada nº ${s.run} · Piso ${floor.level}: ${floor.name}`),
      el('h3', 'dossier-name', climb.owner ? `${climb.owner.name} · ${climb.title.name}` : climb.title.name),
      el('p', 'dossier-sub', `${formatChips(wallet.balance)} de ${formatChips(GOAL)} créditos · récord ${formatChips(climb.record)} · tarjetas ${climb.unlockedLevel} de ${FLOORS.length}`),
    );
    const progress = el('div', 'goal-track goal-track-lg');
    const fill = el('span', 'goal-fill');
    fill.style.transform = `scaleX(${climb.progress})`;
    progress.append(fill);
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Avance de la torre hacia los 10.000.000');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');
    progress.setAttribute('aria-valuenow', String(Math.round(climb.progress * 100)));
    head.append(progress);

    const stats = el('dl', 'stat-grid');
    this.#statList(stats);

    const achievements = el('ul', 'achievement-grid');
    for (const item of ACHIEVEMENTS) {
      const unlocked = Object.hasOwn(s.achievements, item.id);
      const li = el('li', `achievement ${unlocked ? 'is-unlocked' : 'is-locked'}`);
      const badge = el('span', 'achievement-badge', unlocked ? '★' : '·');
      badge.setAttribute('aria-hidden', 'true');
      const body = el('div', 'achievement-body');
      body.append(
        el('strong', 'achievement-name', item.name),
        el('span', 'achievement-desc', item.description),
        el('span', 'achievement-meta', unlocked
          ? `Conseguido ${dateFormat.format(new Date(s.achievements[item.id]))}${item.reward ? ` · +${formatChips(item.reward)}` : ''}`
          : item.reward ? `Recompensa: ${formatChips(item.reward)} créditos` : 'Sin recompensa en créditos'),
      );
      li.append(badge, body);
      achievements.append(li);
    }

    const owners = el('ol', 'hall-owners');
    for (const owner of hall.owners) owners.append(el('li', '', `${owner.name} · escalada nº ${owner.run} · ${duration(owner.ms)}`));
    const hallText = el('p', 'hall', `Salón de la fama: ${hall.runs} ${hall.runs === 1 ? 'escalada' : 'escaladas'} · ${hall.victories} ${hall.victories === 1 ? 'victoria' : 'victorias'}${hall.bestMs ? ` · récord ${duration(hall.bestMs)}` : ''} · mayor fortuna ${formatChips(hall.bestBalance)} créditos`);

    const children = [head, el('h3', 'modal-subtitle', 'Estadísticas'), stats, el('h3', 'modal-subtitle', 'Logros'), achievements, hallText];
    if (hall.owners.length) children.push(el('h3', 'modal-subtitle', 'Dueños del Sindicato'), owners);
    this.#dom.dossierBody.replaceChildren(...children);
  }

  // ---------- Bitácora y paneles ----------

  #entryNode(entry, fresh) {
    const li = el('li', `log-entry tone-${entry.tone}`);
    li.dataset.floor = entry.floor;
    if (fresh) li.classList.add('is-new');
    const meta = el('div', 'log-meta');
    meta.append(el('span', 'log-speaker', entry.speaker), el('time', 'log-time', timeFormat.format(new Date(entry.t))));
    li.append(meta, el('p', 'log-text', entry.text));
    return li;
  }

  #renderLog() {
    const entries = climb.log.slice(-LOG_VISIBLE).reverse();
    this.#dom.logList.replaceChildren(...entries.map((entry) => this.#entryNode(entry, false)));
    this.#renderTicker(entries[0]);
  }

  #appendLog(entry) {
    const list = this.#dom.logList;
    list.prepend(this.#entryNode(entry, true));
    while (list.children.length > LOG_VISIBLE) list.lastElementChild.remove();
    this.#renderTicker(entry);
  }

  #renderTicker(entry) {
    const ticker = this.#dom.ticker;
    ticker.replaceChildren();
    if (!entry) return;
    ticker.append(el('span', 'log-speaker', entry.speaker), el('span', 'ticker-text', entry.text));
    ticker.dataset.tone = entry.tone;
  }

  // Refresco barato ante cambios de saldo: meta, puertas, aviso y limosna (solo si cambia algo).
  #renderLight() {
    const balance = wallet.balance;
    const floor = climb.floor;
    const unlocked = climb.unlockedLevel;
    if (balance === this.#shown.balance && floor.id === this.#shown.floor && unlocked === this.#shown.unlocked) return;
    this.#shown = { balance, floor: floor.id, unlocked };
    const d = this.#dom;
    const progress = climb.progress;
    d.goalFill.style.transform = `scaleX(${progress})`;
    d.goalTrack.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    d.goalTrack.setAttribute('aria-valuetext', `${formatChips(balance)} de ${formatChips(GOAL)} créditos`);
    d.goalText.textContent = `${compact.format(balance)} / 10M`;
    d.hudRecord.textContent = compact.format(climb.record);
    this.#renderDoors();
    this.#renderNotice();
    this.#renderRescue();
  }

  #render() {
    const d = this.#dom;
    const s = climb.state;
    const floor = climb.floor;
    d.floorNum.textContent = `P${floor.level}`;
    d.floorName.textContent = floor.short;
    d.floorRange.textContent = Number.isFinite(floor.maxBet) ? `${formatChips(floor.minBet)} – ${formatChips(floor.maxBet)}` : `${formatChips(floor.minBet)}+ · sin límite`;
    d.tower.setAttribute('aria-label', `Piso ${floor.level}: ${floor.name}, apuestas ${range(floor)}. Abrir la torre`);
    d.hudTitle.textContent = climb.title.name;
    d.hudTitle.dataset.tier = String(s.title);
    d.dossierButton.setAttribute('aria-label', `Expediente: ${climb.title.name}, récord ${formatChips(climb.record)} créditos`);
    d.logDealer.textContent = `${floor.host} · ${floor.hostRole}`;
    d.contractsTitle.textContent = `Encargos del Sindicato · Piso ${floor.level}`;
    const cards = climb.contracts.map((contract) => {
      const li = el('li', 'contract');
      const top = el('div', 'contract-top');
      top.append(el('span', 'contract-text', contract.text), el('span', 'contract-reward', `+${formatChips(contract.reward)}`));
      const bar = el('div', 'contract-bar');
      const fill = el('span', 'contract-fill');
      fill.style.transform = `scaleX(${contract.progress / contract.goal})`;
      bar.append(fill);
      li.append(top, bar, el('span', 'contract-progress', `${contract.progress}/${contract.goal}`));
      return li;
    });
    d.contracts.replaceChildren(...cards);
    this.#shown.balance = null;
    this.#renderLight();
    if (d.dossier.open) this.#renderDossier();
    if (d.towerDialog.open) this.#renderTower();
  }

  #renderDoors() {
    const floorId = climb.floor.id;
    const unlocked = climb.unlockedLevel;
    for (const floor of FLOORS) {
      const door = this.#dom.selector.querySelector(`[data-floor="${floor.id}"]`);
      if (!door) continue;
      const current = floor.id === floorId;
      const open = floor.level <= unlocked;
      door.classList.toggle('is-current', current);
      door.classList.toggle('is-locked', !open);
      door.classList.toggle('is-open', open && !current);
      if (current) door.classList.remove('is-new');
      if (current) door.setAttribute('aria-current', 'true');
      else door.removeAttribute('aria-current');
      door.setAttribute('aria-label', `Piso ${floor.level}, ${floor.name}: ${current ? 'estás aquí' : open ? 'viajar' : `tarjeta de acceso a los ${formatChips(floor.unlockAt)} créditos`}`);
      door.title = `${floor.name} · ${range(floor)}`;
    }
  }

  // Aviso en la mesa: saldo por debajo de la apuesta mínima del piso.
  #renderNotice() {
    const notice = this.#dom.notice;
    const floor = climb.floor;
    const balance = wallet.balance;
    const short = climb.playable && floor.level > 1 && balance + wallet.inPlay < floor.minBet;
    notice.hidden = !short;
    if (!short) return;
    const lower = [...FLOORS].reverse().find((item) => item.level < floor.level && balance >= item.minBet) ?? FLOORS[0];
    notice.replaceChildren(
      el('span', 'floor-notice-text', `Tu saldo no llega a la apuesta mínima de este piso (${formatChips(floor.minBet)}).`),
    );
    const button = el('button', 'btn btn-small', `Bajar al piso ${lower.level}`);
    button.type = 'button';
    button.addEventListener('click', () => this.travel(lower.id));
    notice.append(button);
  }

  #renderRescue() {
    const d = this.#dom;
    const status = climb.rescueStatus();
    clearTimeout(this.#rescueTimer);
    d.rescue.hidden = !status.broke;
    if (!status.broke) return;
    d.rescue.disabled = !status.available;
    d.rescue.classList.toggle('is-ready', status.available);
    d.rescueText.textContent = status.available ? `Limosna +${status.amount}` : `Limosna en ${mmss(status.wait)}`;
    d.rescue.setAttribute('aria-label', status.available ? `Pedir la limosna del Sindicato: +${status.amount} créditos` : `La próxima limosna llega en ${mmss(status.wait)}`);
    if (!status.available && !document.hidden) this.#rescueTimer = setTimeout(() => this.#renderRescue(), 1000);
  }

  // Pestañas de las mesas: bloqueadas las que no se juegan en el piso actual.
  gameLocked(game) {
    return !climb.available(game);
  }

  lockedMessage(game) {
    const floor = gameFloor(game);
    if (!floor) return '';
    return floor.level <= climb.unlockedLevel
      ? `${GAME_NAMES[game] ?? game} está en el piso ${floor.level}: toma el ascensor para jugar`
      : `${GAME_NAMES[game] ?? game} se abre en el piso ${floor.level} (${floor.short}): tarjeta a los ${formatChips(floor.unlockAt)} créditos`;
  }
}

export const climbUi = new ClimbUi();
