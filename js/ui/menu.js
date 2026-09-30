// Menú principal: elige entre el Modo Historia («El Último Crédito») y el Cripto-Casino, con un
// resumen de cada partida guardada. Solo lee datos: no crea la campaña ni toca ningún monedero.

import { storage } from '../storage.js';
import { audio } from '../audio.js';
import { progression } from '../progression.js';
import { relics } from '../relics.js';
import { WALLET_CONFIG } from '../engine/wallet.js';
import { ZONES } from '../story/zones.js';
import { STORY_KEY } from '../story/campaign.js';
import { formatChips } from './hud.js';

const STATUS_TEXT = Object.freeze({
  intro: 'Leyenda sin empezar',
  playing: 'Leyenda en curso',
  victory: 'Libertad comprada',
  gameover: 'Bancarrota: toca reiniciar',
});

function storySummary() {
  const story = storage.read(STORY_KEY, null);
  if (!story || typeof story !== 'object' || !STATUS_TEXT[story.status]) return { text: 'Nueva partida: empiezas con 1 crédito.', resume: false };
  const walletState = storage.read(WALLET_CONFIG.story.key, null);
  const balance = Number(walletState?.balance) || 0;
  const zone = ZONES.find((item) => item.id === story.zone) ?? ZONES[0];
  const legend = Number.isInteger(story.legend) ? story.legend : 1;
  return {
    text: `Leyenda nº ${legend} · ${zone.name} · ${formatChips(balance)} créditos · ${STATUS_TEXT[story.status]}`,
    resume: story.status === 'playing',
  };
}

function freeSummary() {
  const walletState = storage.read(WALLET_CONFIG.free.key, null);
  const p = progression.progress();
  const chests = relics.chests;
  const chestCount = chests.common + chests.legendary;
  if (!walletState) {
    const bonus = chestCount ? ` · ${chestCount} cofre${chestCount === 1 ? '' : 's'} esperando` : '';
    return { text: `Empiezas con ${formatChips(WALLET_CONFIG.free.starting)} fichas · nivel ${p.level} (${p.rank.name})${bonus}`, resume: false };
  }
  const balance = Number(walletState.balance) || 0;
  const extra = chestCount ? ` · ${chestCount} cofre${chestCount === 1 ? '' : 's'} sin abrir` : '';
  return { text: `${formatChips(balance)} fichas · nivel ${p.level} · rango ${p.rank.name}${extra}`, resume: true };
}

class MainMenu {
  init({ onChoose }) {
    const $ = (id) => document.getElementById(id);
    const story = storySummary();
    const free = freeSummary();
    $('menu-story-save').textContent = story.text;
    $('menu-free-save').textContent = free.text;
    $('menu-story').textContent = story.resume ? 'Continuar la leyenda' : 'Jugar la historia';
    $('menu-free').textContent = free.resume ? 'Volver al Cripto-Casino' : 'Entrar al Cripto-Casino';
    const choose = (mode) => {
      audio.unlock();
      audio.click();
      onChoose(mode);
    };
    $('menu-story').addEventListener('click', () => choose('story'));
    $('menu-free').addEventListener('click', () => choose('free'));
    $('menu-story').focus({ preventScroll: true });
  }
}

export const mainMenu = new MainMenu();
