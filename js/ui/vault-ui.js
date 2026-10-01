// Bóveda de Reliquias: 4 ranuras equipables, colección de 10 reliquias, cofres (abrir con
// animación de gacha o comprar con créditos, al precio de tu piso más alto) y pociones ×2.

import { relics, RELICS, RARITIES, CHESTS, SLOT_COUNT, relicById } from '../relics.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../audio.js';
import { hud, formatChips } from './hud.js';
import { el } from './svg.js';
import { settings } from '../settings.js';

class VaultUi {
  #dom = null;
  #opening = false;

  init() {
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      dialog: $('vault-dialog'),
      close: $('vault-close'),
      slots: $('vault-slots'),
      grid: $('vault-grid'),
      count: $('vault-count'),
      store: $('vault-store'),
      chest: $('chest-dialog'),
      chestTitle: $('chest-title'),
      chestBox: $('chest-box'),
      chestReveal: $('chest-reveal'),
      chestClose: $('chest-close'),
    };
    const d = this.#dom;
    d.close.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('click', (event) => {
      if (event.target === d.dialog) d.dialog.close();
    });
    d.chestClose.addEventListener('click', () => d.chest.close());
    // El cofre no se cierra a medias con Escape: primero se revela la reliquia.
    d.chest.addEventListener('cancel', (event) => {
      if (this.#opening) event.preventDefault();
    });
    relics.addEventListener('change', () => {
      if (d.dialog.open) this.#render();
    });
    wallet.addEventListener('update', () => {
      if (d.dialog.open) this.#renderStore();
    });
  }

  open() {
    this.#render();
    audio.click();
    if (!this.#dom.dialog.open) this.#dom.dialog.showModal();
  }

  #render() {
    this.#renderSlots();
    this.#renderGrid();
    this.#renderStore();
  }

  #relicCard(relic, { tag = 'div', owned = true } = {}) {
    const card = el(tag, `relic-card rarity-${relic.rarity}${owned ? '' : ' is-locked'}`);
    card.append(
      el('span', 'relic-icon', owned ? relic.icon : '?'),
      el('span', 'relic-name', owned ? relic.name : 'Sin descubrir'),
      el('span', 'relic-rarity', RARITIES[relic.rarity].name),
    );
    if (owned) card.append(el('span', 'relic-text', relic.text));
    return card;
  }

  #renderSlots() {
    const equipped = relics.equipped;
    this.#dom.slots.replaceChildren(...Array.from({ length: SLOT_COUNT }, (_, i) => {
      const item = el('li', 'vault-slot');
      const relic = relicById(equipped[i]);
      if (!relic) {
        item.classList.add('is-empty');
        item.append(el('span', 'vault-slot-num', `Ranura ${i + 1}`), el('span', 'vault-slot-empty', 'Vacía: equipa una reliquia de tu colección'));
        return item;
      }
      const remove = el('button', 'btn btn-small', 'Quitar');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Quitar ${relic.name} de la ranura ${i + 1}`);
      remove.addEventListener('click', () => {
        relics.unequip(i);
        audio.click();
      });
      item.append(el('span', 'vault-slot-num', `Ranura ${i + 1}`), this.#relicCard(relic), remove);
      return item;
    }));
  }

  #renderGrid() {
    const owned = relics.owned;
    this.#dom.count.textContent = `${owned.length}/${RELICS.length}`;
    this.#dom.grid.replaceChildren(...RELICS.map((relic) => {
      const has = owned.includes(relic.id);
      const item = el('li', 'vault-item');
      item.append(this.#relicCard(relic, { owned: has }));
      if (has) {
        const equipped = relics.isEquipped(relic.id);
        const button = el('button', `btn btn-small${equipped ? ' is-on' : ''}`, equipped ? 'Equipada' : 'Equipar');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(equipped));
        button.addEventListener('click', () => {
          if (relics.isEquipped(relic.id)) relics.unequip(relic.id);
          else if (!relics.equip(relic.id)) hud.toast('Las 4 ranuras están ocupadas: quita una reliquia primero', 'warn');
          audio.click();
        });
        item.append(button);
      }
      return item;
    }));
  }

  #renderStore() {
    const chests = relics.chests;
    const blocks = Object.values(CHESTS).map((chest) => {
      const box = el('div', `vault-chest chest-${chest.id}`);
      const owned = chests[chest.id];
      const open = el('button', 'btn btn-primary', owned ? `Abrir (${owned})` : 'Abrir');
      open.type = 'button';
      open.disabled = owned <= 0 || this.#opening;
      open.addEventListener('click', () => this.openChest(chest.id));
      const price = relics.priceOf(chest.id);
      const buy = el('button', 'btn', `Comprar · ${formatChips(price)}`);
      buy.type = 'button';
      buy.disabled = !wallet.canAfford(price);
      buy.addEventListener('click', () => {
        if (relics.buyChest(chest.id, wallet)) audio.chip();
        else hud.toast('No tienes créditos suficientes para ese cofre', 'warn');
      });
      const odds = Object.entries(chest.weights).filter(([, w]) => w > 0).map(([rarity, w]) => `${RARITIES[rarity].name} ${w} %`).join(' · ');
      box.append(
        el('strong', 'vault-chest-name', chest.name),
        el('span', 'vault-chest-odds', `Reliquia nueva garantizada · ${odds}${chest.potions ? ' · +1 poción' : ''}`),
        el('span', 'vault-chest-owned', `En la bóveda: ${owned}`),
        el('div', 'btn-row'),
      );
      box.lastElementChild.append(open, buy);
      return box;
    });
    const potion = el('div', 'vault-potion');
    const arm = el('button', 'btn btn-gold', relics.potionArmed ? 'Poción activa' : 'Activar poción ×2');
    arm.type = 'button';
    arm.disabled = relics.potionArmed || relics.potions <= 0;
    arm.addEventListener('click', () => {
      if (relics.armPotion()) {
        audio.shimmer();
        hud.toast('Poción ×2 activa: tu próximo premio neto se duplica', 'success');
      }
    });
    potion.append(
      el('strong', 'vault-chest-name', '🧪 Poción ×2'),
      el('span', 'vault-chest-odds', 'Duplica el premio neto de tu próxima ronda ganadora (hasta 25 apuestas mínimas del piso; no vale en la rueda).'),
      el('span', 'vault-chest-owned', `Pociones: ${relics.potions}${relics.potionArmed ? ' · una activa' : ''}`),
      arm,
    );
    this.#dom.store.replaceChildren(...blocks, potion);
  }

  // ---------- Gacha ----------

  async openChest(tier) {
    if (this.#opening) return;
    const result = relics.openChest(tier);
    if (!result) return;
    this.#opening = true;
    const d = this.#dom;
    const fast = settings.speed;
    d.chestTitle.textContent = `${CHESTS[tier].name}…`;
    d.chestReveal.hidden = true;
    d.chestReveal.replaceChildren();
    d.chestClose.disabled = true;
    d.chestBox.className = `chest chest-${tier} is-shaking`;
    if (!d.chest.open) d.chest.showModal();
    audio.chestShake();
    await new Promise((resolve) => setTimeout(resolve, 1400 * fast));
    d.chestBox.classList.replace('is-shaking', 'is-open');
    audio.chestOpen();
    const rect = d.chestBox.getBoundingClientRect();
    hud.celebrate(result.relic?.rarity === 'legendary' ? 3 : 2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    await new Promise((resolve) => setTimeout(resolve, 450 * fast));
    const reveal = [];
    if (result.relic) {
      const card = this.#relicCard(result.relic);
      card.classList.add('is-revealed');
      reveal.push(card, el('p', 'chest-note', result.equipped ? 'Equipada en una ranura libre.' : 'Guardada en la bóveda: equípala cuando quieras.'));
      d.chestTitle.textContent = `¡${RARITIES[result.relic.rarity].name}! ${result.relic.name}`;
      audio.relicReveal(result.relic.rarity);
    } else {
      wallet.grant(result.chips, 'chest');
      reveal.push(el('p', 'chest-chips', `+${formatChips(result.chips)} créditos`), el('p', 'chest-note', 'Ya tienes toda la colección: el cofre paga en créditos.'));
      d.chestTitle.textContent = 'Colección completa';
      audio.win(2);
    }
    if (result.potions) reveal.push(el('p', 'chest-note', `+${result.potions} poción ×2`));
    d.chestReveal.replaceChildren(...reveal);
    d.chestReveal.hidden = false;
    d.chestClose.disabled = false;
    d.chestClose.focus();
    this.#opening = false;
    if (d.dialog.open) this.#render();
  }
}

export const vaultUi = new VaultUi();
