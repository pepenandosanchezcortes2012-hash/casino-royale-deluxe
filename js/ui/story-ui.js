// Interfaz narrativa de «El Último Crédito»: prólogo, finales, transiciones de zona, mapa del
// casino, Bitácora del Crupier, tablero de encargos, salvavidas (bono diario, rescates VIP y
// favores), expediente con logros y efectos de las jugadas críticas. Todo el texto se escribe
// con textContent.

import { campaign } from '../story/campaign.js';
import { ZONES, FREEDOM_GOAL } from '../story/zones.js';
import { ACHIEVEMENTS } from '../story/achievements.js';
import { PROLOGUE, FINALE, GAME_OVER } from '../story/narrative.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { hud, formatChips } from './hud.js';
import { el } from './svg.js';

const LOG_VISIBLE = 40;
const timeFormat = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function duration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${minutes % 60} min` : `${minutes} min`;
}

// Máquina de escribir: revela párrafos carácter a carácter; skip() lo completa al instante.
class Typewriter {
  #timer = 0;
  #done = null;
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

class StoryUi {
  #dom;
  #games = {};
  #typer = new Typewriter();
  #criticalTimer = 0;
  #brokeTimer = 0;
  #restartArmed = false;
  #replaying = false;

  init({ games }) {
    this.#games = games;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      root: document.documentElement,
      zoneBar: $('zone-bar'),
      hudTitle: $('hud-title'),
      hudLegend: $('hud-legend'),
      hudZone: $('hud-zone'),
      dossierButton: $('btn-dossier'),
      lifeline: $('btn-lifeline'),
      lifelineDialog: $('lifeline-dialog'),
      lifelineList: $('lifeline-list'),
      lifelineClose: $('lifeline-close'),
      logPanel: $('log-panel'),
      logList: $('log-list'),
      logTicker: $('log-ticker'),
      logDealer: $('log-dealer'),
      contracts: $('contract-list'),
      contractsTitle: $('contract-title'),
      freedom: $('freedom-fill'),
      freedomText: $('freedom-text'),
      intro: $('intro'),
      introText: $('intro-text'),
      introLegend: $('intro-legend'),
      introSkip: $('intro-skip'),
      introEnter: $('intro-enter'),
      finale: $('finale'),
      finaleText: $('finale-text'),
      finaleStats: $('finale-stats'),
      finaleRestart: $('finale-restart'),
      gameover: $('gameover'),
      gameoverText: $('gameover-text'),
      gameoverStats: $('gameover-stats'),
      gameoverRestart: $('gameover-restart'),
      dossier: $('dossier'),
      dossierBody: $('dossier-body'),
      dossierClose: $('dossier-close'),
      dossierPrologue: $('dossier-prologue'),
      dossierRestart: $('dossier-restart'),
      transition: $('zone-transition'),
      transitionLevel: $('zt-level'),
      transitionName: $('zt-name'),
      transitionDesc: $('zt-desc'),
    };
    this.#buildZoneBar();
    this.#bind();
    this.#applyZone(campaign.zone);
    this.#renderLog();
    this.#render();

    const status = campaign.status;
    if (status === 'intro') this.#showIntro();
    else if (status === 'victory') this.#showEnding('victory', false);
    else if (status === 'gameover') this.#showEnding('gameover', false);
    else setTimeout(() => campaign.checkEnd(), 400);
  }

  // ---------- Construcción y eventos ----------

  #buildZoneBar() {
    const doors = ZONES.map((zone) => {
      const button = el('button', 'zone-door');
      button.type = 'button';
      button.dataset.zone = zone.id;
      button.append(
        el('span', 'zone-level', `Nivel ${zone.level}`),
        el('span', 'zone-name', zone.name),
        el('span', 'zone-req', ''),
      );
      button.addEventListener('click', () => this.#travel(zone.id));
      return button;
    });
    this.#dom.zoneBar.replaceChildren(...doors);
  }

  #bind() {
    const d = this.#dom;
    campaign.addEventListener('update', () => this.#render());
    campaign.addEventListener('log', (event) => this.#appendLog(event.detail.entry));
    campaign.addEventListener('zone', (event) => this.#onZone(event.detail));
    campaign.addEventListener('critical', (event) => this.#onCritical(event.detail));
    campaign.addEventListener('round', (event) => this.#onRound(event.detail));
    campaign.addEventListener('achievement', (event) => this.#onAchievement(event.detail.achievement));
    campaign.addEventListener('contract', (event) => this.#onContract(event.detail));
    campaign.addEventListener('unlock', (event) => this.#onUnlock(event.detail.zone));
    campaign.addEventListener('title', (event) => this.#onTitle(event.detail));
    campaign.addEventListener('favor', (event) => this.#onFavor(event.detail));
    campaign.addEventListener('vip', (event) => this.#onVip(event.detail));
    campaign.addEventListener('broke', () => this.#onBroke());
    campaign.addEventListener('status', (event) => this.#onStatus(event.detail.status));
    wallet.addEventListener('change', () => this.#renderLight());

    d.lifeline.addEventListener('click', () => this.#openLifelines());
    d.lifelineClose.addEventListener('click', () => d.lifelineDialog.close());
    d.lifelineDialog.addEventListener('click', (event) => {
      if (event.target === d.lifelineDialog) d.lifelineDialog.close();
    });
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
    d.logTicker.addEventListener('click', () => d.logPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }));

    d.introSkip.addEventListener('click', () => this.#typer.skip());
    d.introEnter.addEventListener('click', () => this.#enter());
    d.finaleRestart.addEventListener('click', () => this.#restart());
    d.gameoverRestart.addEventListener('click', () => this.#restart());

    // Las cinemáticas no se cierran con Escape: solo con sus botones.
    for (const dialog of [d.intro, d.finale, d.gameover]) {
      dialog.addEventListener('cancel', (event) => event.preventDefault());
    }
    d.intro.addEventListener('close', () => {
      if (campaign.status === 'intro') requestAnimationFrame(() => this.#enter());
    });
    for (const [dialog, status] of [[d.finale, 'victory'], [d.gameover, 'gameover']]) {
      dialog.addEventListener('close', () => {
        if (campaign.status === status) requestAnimationFrame(() => dialog.showModal());
      });
    }
  }

  // ---------- Zonas ----------

  #travel(id) {
    if (id === campaign.zone.id) return;
    const status = campaign.travel(id);
    if (status.ok) return;
    audio.click();
    if (status.reason === 'pending') hud.toast('Termina las apuestas en curso antes de cambiar de zona', 'warn');
    else if (status.reason === 'funds') hud.toast(`Necesitas ${formatChips(status.need)} créditos para entrar`, 'warn');
  }

  #onZone({ zone, forced }) {
    this.#transition(zone, forced);
  }

  #applyZone(zone) {
    this.#dom.root.dataset.zone = zone.id;
    hud.setDenominations(zone.chips);
    if (campaign.playable || campaign.status === 'intro') {
      audio.setMood(zone.mood);
      audio.setTension(zone.tension);
    }
  }

  #transition(zone, forced) {
    const d = this.#dom;
    d.transitionLevel.textContent = forced ? 'Expulsado' : `Nivel ${zone.level}`;
    d.transitionName.textContent = zone.name;
    d.transitionDesc.textContent = zone.description;
    d.transition.hidden = false;
    d.transition.dataset.zone = zone.id;
    d.transition.classList.remove('is-out');
    void d.transition.offsetWidth;
    d.transition.classList.add('is-in');
    audio.whoosh();
    if (zone.id === 'neon') setTimeout(() => audio.neonBuzz(), 500);
    setTimeout(() => this.#applyZone(zone), 450);
    setTimeout(() => {
      d.transition.classList.remove('is-in');
      d.transition.classList.add('is-out');
      setTimeout(() => {
        d.transition.hidden = true;
      }, 600);
    }, 2100);
  }

  // ---------- Reacciones ----------

  #onCritical({ share }) {
    const zone = campaign.zone;
    this.#dom.root.classList.add('is-critical');
    audio.sting();
    audio.riser(1.4);
    audio.startHeartbeat(zone.id === 'penthouse' ? 96 : 84);
    audio.setTension(1);
    clearTimeout(this.#criticalTimer);
    this.#criticalTimer = setTimeout(() => this.#endCritical(null), 30000);
    this.#dom.root.style.setProperty('--critical-share', String(Math.min(1, share)));
  }

  #endCritical(win) {
    clearTimeout(this.#criticalTimer);
    const root = this.#dom.root;
    root.classList.remove('is-critical');
    audio.stopHeartbeat();
    audio.setTension(campaign.zone.tension);
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
    if (achievement.reward <= 0) return;
    hud.toast(`Logro: ${achievement.name} · +${formatChips(achievement.reward)} créditos`, 'success', 4200);
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

  #onUnlock(zone) {
    hud.toast(`${zone.name} te abre sus puertas. Pulsa «Nivel ${zone.level}» para subir.`, 'success', 5200);
    audio.neonBuzz();
    this.#dom.zoneBar.querySelector(`[data-zone="${zone.id}"]`)?.classList.add('is-new');
  }

  #onTitle({ title, up }) {
    const node = this.#dom.hudTitle;
    node.classList.remove('is-changed', 'is-down');
    void node.offsetWidth;
    node.classList.add(up ? 'is-changed' : 'is-down');
    if (up) hud.toast(`Nuevo título: ${title.name}`, 'success');
  }

  #onFavor({ amount, left }) {
    hud.toast(`Favor del Sindicato: +${formatChips(amount)} créditos · quedan ${left}`, 'warn', 4200);
    audio.chip();
  }

  #onVip({ kind, amount, left }) {
    const text = kind === 'daily'
      ? `Bono diario del Club VIP: +${formatChips(amount)} créditos`
      : `Rescate VIP: +${formatChips(amount)} créditos · quedan ${left} en esta leyenda`;
    hud.toast(text, 'success', 4200);
    audio.chip();
    audio.win(kind === 'daily' ? 2 : 1);
  }

  // Sin créditos: tras ver el resultado de la ronda se ofrecen los salvavidas disponibles.
  #onBroke() {
    clearTimeout(this.#brokeTimer);
    this.#brokeTimer = setTimeout(() => {
      if (!campaign.lifelines().broke || document.querySelector('dialog[open]')) return;
      this.#openLifelines();
    }, 1400);
  }

  #openLifelines() {
    this.#renderLifelines();
    if (!this.#dom.lifelineDialog.open) this.#dom.lifelineDialog.showModal();
  }

  #renderLifelines() {
    const life = campaign.lifelines();
    const option = ({ kind, title, detail, action, available, onUse }) => {
      const card = el('div', `lifeline is-${kind}`);
      if (!available) card.classList.add('is-spent');
      const text = el('div', 'lifeline-text');
      text.append(el('strong', '', title), el('span', '', detail));
      const button = el('button', `btn ${kind === 'vip' ? 'btn-gold' : 'btn-danger'}`, action);
      button.type = 'button';
      button.disabled = !available;
      button.addEventListener('click', () => {
        if (onUse() > 0) this.#dom.lifelineDialog.close();
      });
      card.append(text, button);
      return card;
    };
    const daily = option({
      kind: 'vip',
      title: `Bono diario del Club VIP · +${formatChips(life.daily.amount)}`,
      detail: life.daily.available ? 'Uno al día, también cuando tienes saldo.' : 'Ya lo has cobrado hoy. Vuelve mañana.',
      action: 'Reclamar',
      available: life.daily.available,
      onUse: () => campaign.claimDaily(),
    });
    const rescue = option({
      kind: 'vip',
      title: `Rescate VIP ${life.rescue.rank} · +${formatChips(life.rescue.amount)}`,
      detail: `Quedan ${life.rescue.left} de ${life.rescue.total} en esta leyenda. Sube de rango para tener más.`,
      action: 'Usar rescate',
      available: life.rescue.available,
      onUse: () => campaign.takeRescue(),
    });
    const favor = option({
      kind: 'syndicate',
      title: `Favor del Sindicato · +${formatChips(life.favor.amount)}`,
      detail: `Quedan ${life.favor.left} de 3. Crece con la zona más alta que hayas pisado.`,
      action: 'Pedir favor',
      available: life.favor.available,
      onUse: () => campaign.takeFavor(),
    });
    this.#dom.lifelineList.replaceChildren(daily, rescue, favor);
  }

  #onStatus(status) {
    if (status === 'playing') return;
    clearTimeout(this.#brokeTimer);
    if (this.#dom.lifelineDialog.open) this.#dom.lifelineDialog.close();
    for (const game of Object.values(this.#games)) game.onHide?.();
    this.#endCritical(null);
    setTimeout(() => this.#showEnding(status, true), 1800);
  }

  // ---------- Cinemáticas ----------

  #showIntro(replay = false) {
    const d = this.#dom;
    this.#replaying = replay;
    d.introLegend.textContent = `Leyenda nº ${campaign.state.legend}`;
    d.introEnter.textContent = replay ? 'Volver a la mesa' : 'Entrar al Callejón';
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
    if (campaign.status !== 'intro') return;
    audio.unlock();
    campaign.begin();
    this.#transition(campaign.zone, false);
  }

  #stats() {
    const s = campaign.state;
    const st = s.stats;
    const ended = s.ended ?? Date.now();
    return [
      ['Saldo máximo', `${formatChips(st.maxBalance)} cr`],
      ['Rondas jugadas', formatChips(st.rounds)],
      ['Victorias', formatChips(st.wins)],
      ['Mayor premio', `${formatChips(st.biggestWin)} cr`],
      ['Mejor racha', formatChips(st.bestStreak)],
      ['Encargos cumplidos', formatChips(st.contractsDone)],
      ['Favores usados', `${st.favorsUsed} de 3`],
      ['Club VIP', `${st.dailyBonuses} ${st.dailyBonuses === 1 ? 'bono' : 'bonos'} · ${st.vipRescues} ${st.vipRescues === 1 ? 'rescate' : 'rescates'}`],
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

  #showEnding(status, animate) {
    const d = this.#dom;
    const victory = status === 'victory';
    const dialog = victory ? d.finale : d.gameover;
    this.#statList(victory ? d.finaleStats : d.gameoverStats);
    if (!dialog.open) dialog.showModal();
    audio.setMood(victory ? 'finale' : 'gameover');
    audio.setTension(victory ? 0.2 : 0.7);
    const text = victory ? d.finaleText : d.gameoverText;
    this.#typer.play(text, victory ? FINALE : GAME_OVER, { speed: animate ? 28 : 8, sound: animate });
    if (!animate) return;
    if (victory) {
      // El diálogo modal vive en la capa superior: el lienzo de partículas se mueve dentro.
      const canvas = document.getElementById('fx-canvas');
      if (canvas) dialog.prepend(canvas);
      hud.goldStorm(12);
      audio.fanfare();
    } else {
      audio.doom();
    }
  }

  #restart() {
    campaign.restart();
    location.reload();
  }

  #confirmRestart() {
    const button = this.#dom.dossierRestart;
    if (!this.#restartArmed) {
      this.#restartArmed = true;
      button.textContent = '¿Seguro? Se perderá esta leyenda';
      button.classList.add('is-armed');
      return;
    }
    this.#restart();
  }

  #disarmRestart() {
    this.#restartArmed = false;
    this.#dom.dossierRestart.textContent = 'Reiniciar la leyenda';
    this.#dom.dossierRestart.classList.remove('is-armed');
  }

  // ---------- Expediente ----------

  #openDossier() {
    this.#renderDossier();
    if (!this.#dom.dossier.open) this.#dom.dossier.showModal();
  }

  #renderDossier() {
    const s = campaign.state;
    const hall = campaign.hall;
    const zone = campaign.zone;
    const head = el('section', 'dossier-head');
    head.append(
      el('p', 'dossier-kicker', `Leyenda nº ${s.legend} · ${zone.name}`),
      el('h3', 'dossier-name', campaign.title.name),
      el('p', 'dossier-sub', `${formatChips(wallet.balance)} de ${formatChips(FREEDOM_GOAL)} créditos para comprar tu libertad · Favores del Sindicato: ${s.favorsLeft} de 3 · Rescates VIP: ${campaign.lifelines().rescue.left} de ${campaign.lifelines().rescue.total}`),
    );
    const progress = el('div', 'freedom-track freedom-track-lg');
    const fill = el('span', 'freedom-fill');
    fill.style.transform = `scaleX(${Math.min(1, wallet.balance / FREEDOM_GOAL)})`;
    progress.append(fill);
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Progreso hacia la libertad');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(FREEDOM_GOAL));
    progress.setAttribute('aria-valuenow', String(Math.round(wallet.balance)));
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
          : item.reward ? `Recompensa: ${formatChips(item.reward)} créditos` : 'El final de la historia'),
      );
      li.append(badge, body);
      achievements.append(li);
    }

    const hallText = el('p', 'hall', `Salón de la fama: ${hall.legends} leyendas · ${hall.victories} liberaciones${hall.bestMs ? ` · récord ${duration(hall.bestMs)}` : ''}`);

    this.#dom.dossierBody.replaceChildren(
      head,
      el('h3', 'modal-subtitle', 'Estadísticas'),
      stats,
      el('h3', 'modal-subtitle', 'Logros'),
      achievements,
      hallText,
    );
  }

  // ---------- Bitácora y paneles ----------

  #entryNode(entry, fresh) {
    const li = el('li', `log-entry tone-${entry.tone}`);
    li.dataset.zone = entry.zone;
    if (fresh) li.classList.add('is-new');
    const meta = el('div', 'log-meta');
    meta.append(el('span', 'log-speaker', entry.speaker), el('time', 'log-time', timeFormat.format(new Date(entry.t))));
    li.append(meta, el('p', 'log-text', entry.text));
    return li;
  }

  #renderLog() {
    const entries = campaign.log.slice(-LOG_VISIBLE).reverse();
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
    const ticker = this.#dom.logTicker;
    ticker.replaceChildren();
    if (!entry) return;
    ticker.append(el('span', 'log-speaker', entry.speaker), el('span', 'ticker-text', entry.text));
    ticker.dataset.tone = entry.tone;
  }

  // Refresco barato ante cambios de saldo: título, puertas, favor y progreso.
  #renderLight() {
    const balance = wallet.balance;
    this.#dom.freedom.style.transform = `scaleX(${Math.min(1, balance / FREEDOM_GOAL)})`;
    this.#dom.freedomText.textContent = `${formatChips(balance)} / ${formatChips(FREEDOM_GOAL)}`;
    this.#renderDoors();
    this.#renderLifeline();
  }

  #render() {
    const d = this.#dom;
    const s = campaign.state;
    const zone = campaign.zone;
    d.hudTitle.textContent = campaign.title.name;
    d.hudTitle.dataset.tier = String(s.title);
    d.hudLegend.textContent = `Leyenda ${s.legend}`;
    d.hudZone.textContent = zone.name;
    d.dossierButton.setAttribute('aria-label', `Expediente: ${campaign.title.name}, ${zone.name}`);
    d.logDealer.textContent = `${zone.dealer} · ${zone.dealerRole}`;

    d.contractsTitle.textContent = `Encargos del Sindicato · ${zone.name}`;
    const cards = campaign.contracts.map((contract) => {
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
    this.#renderLight();
    if (d.dossier.open) this.#renderDossier();
  }

  #renderDoors() {
    const s = campaign.state;
    const balance = wallet.balance;
    for (const zone of ZONES) {
      const door = this.#dom.zoneBar.querySelector(`[data-zone="${zone.id}"]`);
      if (!door) continue;
      const current = zone.id === s.zone;
      const affordable = balance >= zone.entry;
      door.classList.toggle('is-current', current);
      door.classList.toggle('is-locked', !current && !affordable);
      door.classList.toggle('is-open', !current && affordable);
      // El aviso de zona recién abierta se apaga al entrar (o si ya no alcanza el saldo).
      if (current || !affordable) door.classList.remove('is-new');
      if (current) door.setAttribute('aria-current', 'true');
      else door.removeAttribute('aria-current');
      const req = door.querySelector('.zone-req');
      req.textContent = current ? 'Estás aquí' : affordable ? 'Entrar' : `${formatChips(zone.entry)} cr`;
      door.setAttribute('aria-label', `${zone.name}, nivel ${zone.level}: ${current ? 'estás aquí' : affordable ? 'puedes entrar' : `necesitas ${formatChips(zone.entry)} créditos`}`);
    }
  }

  #renderLifeline() {
    const life = campaign.lifelines();
    const d = this.#dom;
    const show = life.broke && (life.daily.available || life.rescue.available || life.favor.available);
    d.lifeline.hidden = !show;
    if (show) d.lifeline.textContent = 'Sin créditos · Pedir ayuda';
    if (d.lifelineDialog.open) {
      if (life.broke) this.#renderLifelines();
      else d.lifelineDialog.close();
    }
  }
}

export const storyUi = new StoryUi();
