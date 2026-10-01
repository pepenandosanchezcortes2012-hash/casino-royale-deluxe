// HUD de la carrera: nivel, XP y rango VIP, misiones del día, ranuras de reliquias, interruptor
// turbo, acceso a la terminal y mensajes flotantes sobre el saldo. También pinta el diálogo
// «Carrera y misiones» (nivel, escalera de rangos y las 10 misiones diarias de tu piso).

import { progression, VIP_RANKS } from '../progression.js';
import { relics, relicById, RARITIES, SLOT_COUNT } from '../relics.js';
import { settings } from '../settings.js';
import { audio } from '../audio.js';
import { formatChips } from './hud.js';
import { el, svg, useRef, pixelIcon } from './svg.js';

function duration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

export function rankGem(rankId, className = 'rank-gem') {
  const gem = svg('svg', { viewBox: '0 0 100 100', class: className, 'aria-hidden': 'true', focusable: 'false' }, [useRef('gem')]);
  gem.dataset.rank = rankId;
  return gem;
}

class CyberHud {
  #dom = null;
  #handlers = {};
  #level = 0;

  // `minStake()` = apuesta mínima que cuenta para las misiones (la de tu piso más alto).
  init({ onTerminal, onVault, minStake = () => 0 }) {
    this.#handlers = { onTerminal, onVault, minStake };
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      career: $('btn-career'),
      level: $('hud-level'),
      rank: $('hud-vip-rank'),
      fill: $('hud-level-fill'),
      missions: $('hud-missions'),
      relics: $('hud-relics'),
      turbo: $('btn-turbo'),
      terminal: $('btn-terminal'),
      balance: $('hud-balance'),
      dialog: $('career-dialog'),
      dialogClose: $('career-close'),
      levelCard: $('career-level'),
      ranks: $('career-ranks'),
      missionList: $('career-missions'),
      reset: $('career-reset'),
    };
    this.#buildSlots();
    this.#bind();
    this.#level = progression.level;
    this.#render();
  }

  #bind() {
    const d = this.#dom;
    d.career.addEventListener('click', () => this.openCareer());
    d.dialogClose.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('click', (event) => {
      if (event.target === d.dialog) d.dialog.close();
    });
    d.turbo.addEventListener('click', () => {
      audio.click();
      settings.toggleTurbo();
    });
    d.terminal.addEventListener('click', () => this.#handlers.onTerminal?.());
    progression.addEventListener('change', () => this.#render());
    progression.addEventListener('levelup', () => this.#pulse(d.career));
    relics.addEventListener('change', () => this.#renderSlots());
    settings.addEventListener('change', () => this.#renderTurbo());
  }

  // ---------- Ranuras de reliquias ----------

  #buildSlots() {
    const buttons = Array.from({ length: SLOT_COUNT }, (_, i) => {
      const button = el('button', 'relic-slot');
      button.type = 'button';
      button.dataset.slot = String(i);
      button.addEventListener('click', () => {
        audio.click();
        this.#handlers.onVault?.();
      });
      return button;
    });
    const potion = el('span', 'potion-badge');
    potion.append(pixelIcon('px-potion'), '×2');
    potion.hidden = true;
    potion.title = 'Poción ×2 activa: tu próximo premio neto se duplica';
    this.#dom.relics.replaceChildren(...buttons, potion);
    this.#renderSlots();
  }

  #renderSlots() {
    const equipped = relics.equipped;
    const buttons = [...this.#dom.relics.querySelectorAll('.relic-slot')];
    buttons.forEach((button, i) => {
      const relic = relicById(equipped[i]);
      const icon = el('span', 'relic-slot-icon', relic ? null : '+');
      if (relic) icon.append(pixelIcon(relic.sprite));
      button.replaceChildren(icon);
      button.classList.toggle('is-empty', !relic);
      button.dataset.rarity = relic?.rarity ?? '';
      const label = relic ? `Ranura ${i + 1}: ${relic.name} (${RARITIES[relic.rarity].name}). ${relic.text}` : `Ranura ${i + 1} vacía: abre la bóveda`;
      button.setAttribute('aria-label', label);
      button.title = relic ? `${relic.name} — ${relic.text}` : 'Ranura vacía · Bóveda de Reliquias';
    });
    const chests = relics.chests;
    const pending = chests.common + chests.legendary;
    this.#dom.relics.classList.toggle('has-chests', pending > 0);
    this.#dom.relics.dataset.chests = pending > 0 ? String(pending) : '';
    this.#dom.relics.querySelector('.potion-badge').hidden = !relics.potionArmed;
  }

  #renderTurbo() {
    const on = settings.turbo;
    this.#dom.turbo.setAttribute('aria-pressed', String(on));
    this.#dom.turbo.classList.toggle('is-on', on);
  }

  // ---------- Nivel y misiones ----------

  #render() {
    const d = this.#dom;
    const p = progression.progress();
    d.level.textContent = String(p.level);
    d.rank.textContent = p.rank.name;
    d.career.dataset.rank = p.rank.id;
    d.fill.style.transform = `scaleX(${p.ratio})`;
    const done = progression.missionsDone;
    const total = progression.missionsTotal;
    d.missions.textContent = `${done}/${total}`;
    d.career.setAttribute('aria-label', `Nivel ${p.level}, rango ${p.rank.name}, ${done} de ${total} misiones: abrir carrera y misiones`);
    this.#renderTurbo();
    if (d.dialog.open) this.#renderCareer();
  }

  #pulse(node) {
    node.classList.remove('is-levelup');
    void node.offsetWidth;
    node.classList.add('is-levelup');
  }

  openCareer() {
    audio.click();
    this.#renderCareer();
    this.#dom.dialog.showModal();
  }

  #renderCareer() {
    const d = this.#dom;
    const p = progression.progress();
    const stats = progression.stats;

    const bar = el('span', 'xp-bar-lg');
    const fill = el('span', 'xp-bar-fill');
    fill.style.transform = `scaleX(${p.ratio})`;
    bar.append(fill);
    const info = el('div', 'career-info');
    info.append(
      el('span', 'career-kicker', `Rango ${p.rank.name}`),
      el('strong', 'career-level-num', `Nivel ${p.level}`),
      bar,
      el('span', 'career-xp', p.max ? `XP total ${formatChips(Math.floor(p.xp))} · nivel máximo` : `${formatChips(Math.floor(p.into))} / ${formatChips(p.needed)} XP para el nivel ${p.level + 1}`),
    );
    const facts = el('dl', 'career-facts');
    const fact = (label, value) => {
      const item = el('div');
      item.append(el('dt', '', label), el('dd', '', value));
      facts.append(item);
    };
    fact('Rondas', formatChips(stats.rounds));
    fact('Apostado', formatChips(Math.round(stats.wagered)));
    fact('Mejor multiplicador', stats.best > 0 ? `×${stats.best.toFixed(2).replace('.', ',')}` : '—');
    fact('XP por ronda', '(apuesta × 0,25 + premio × 0,5) ÷ escala de tu piso');
    d.levelCard.dataset.rank = p.rank.id;
    d.levelCard.replaceChildren(rankGem(p.rank.id, 'rank-gem rank-gem-lg'), info, facts);

    d.ranks.replaceChildren(...VIP_RANKS.map((rank, i) => {
      const item = el('li', 'rank-row');
      const reached = p.level >= rank.level;
      item.classList.toggle('is-done', reached && rank.id !== p.rank.id);
      item.classList.toggle('is-current', rank.id === p.rank.id);
      const scale = progression.scale;
      const perk = i === 0 ? `Rango inicial · abundancia ${formatChips(50 * scale)} créditos/min` : `Cofre legendario al llegar · abundancia ${formatChips((50 + rank.abundance) * scale)} créditos/min`;
      item.append(rankGem(rank.id), el('span', 'rank-row-name', rank.name), el('span', 'rank-row-req', `Nivel ${rank.level}`), el('span', 'rank-row-perk', perk));
      return item;
    }));

    const missions = progression.missions();
    const bonus = progression.missionBonus;
    d.reset.textContent = `· se renuevan en ${duration(progression.missionsResetAt - Date.now())} · todas: cofre común y +${formatChips(bonus.chips)} · cuentan las apuestas desde ${formatChips(this.#minStake())}`;
    d.missionList.replaceChildren(...missions.map((mission) => {
      const item = el('li', `mission${mission.done ? ' is-done' : ''}`);
      const track = el('span', 'mission-track');
      const fillBar = el('span', 'mission-fill');
      fillBar.style.transform = `scaleX(${Math.min(1, mission.progress / mission.goal)})`;
      const shown = (value) => formatChips(Math.floor(mission.amount ? value * mission.scale : value));
      track.append(fillBar);
      item.append(
        el('span', 'mission-check', mission.done ? '✔' : '◯'),
        el('span', 'mission-text', mission.text),
        el('span', 'mission-progress', `${shown(mission.progress)}/${shown(mission.goal)}`),
        track,
        el('span', 'mission-reward', `+${formatChips(mission.chips)} créditos · +${mission.xp} XP`),
      );
      return item;
    }));
  }

  #minStake() {
    return this.#handlers.minStake?.() ?? 0;
  }

  // Repinta el nivel y las misiones (al cambiar de piso cambian sus importes).
  refresh() {
    if (this.#dom) this.#render();
  }

  // ---------- Mensajes flotantes ----------

  floatBalance(text) {
    const anchor = this.#dom?.balance;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const node = el('div', 'float-text', text);
    node.style.left = `${rect.left + rect.width / 2}px`;
    node.style.top = `${rect.bottom}px`;
    document.body.append(node);
    setTimeout(() => node.remove(), 1800);
  }
}

export const cyberHud = new CyberHud();
