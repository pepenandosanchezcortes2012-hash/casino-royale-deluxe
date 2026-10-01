// Controles de sonido y pantalla: silencio rápido (botón y tecla M) y volumen general en la
// cabecera, y el diálogo de Ajustes (volumen, música, efectos, modo ligero, lluvia de código y
// scanlines). La música y los efectos los pinta hud.js.

import { audio } from '../audio.js';
import { settings } from '../settings.js';
import { pixelIcon } from './svg.js';

const percent = (value) => `${Math.round(value * 100)} %`;

class SettingsUi {
  #dom = null;

  init() {
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      mute: $('btn-mute'),
      volume: $('volume'),
      open: $('btn-settings'),
      dialog: $('settings-dialog'),
      close: $('settings-close'),
      panelVolume: $('volume-panel'),
      volumeValue: $('volume-value'),
      lite: $('btn-lite'),
      rain: $('btn-rain'),
      crt: $('btn-crt'),
      liteStatus: $('lite-status'),
    };
    const d = this.#dom;
    d.mute.addEventListener('click', () => {
      audio.unlock();
      audio.toggleMute();
      if (!audio.muted) audio.click();
    });
    for (const range of [d.volume, d.panelVolume]) {
      range.addEventListener('input', () => {
        audio.unlock();
        audio.setVolume(Number(range.value) / 100);
      });
      range.addEventListener('change', () => audio.click());
    }
    d.open.addEventListener('click', () => {
      audio.click();
      this.#render();
      d.dialog.showModal();
    });
    d.close.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('click', (event) => {
      if (event.target === d.dialog) d.dialog.close();
    });
    d.lite.addEventListener('click', () => {
      audio.click();
      settings.setLite(!settings.lite);
    });
    d.rain.addEventListener('click', () => {
      audio.click();
      settings.setMatrix(!settings.snapshot.matrix);
    });
    d.crt.addEventListener('click', () => {
      audio.click();
      settings.setScanlines(!settings.snapshot.scanlines);
    });
    audio.addEventListener('change', () => this.#render());
    settings.addEventListener('change', () => this.#render());
    // Silencio rápido con M fuera de los campos de texto.
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (typing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.key === 'm' || event.key === 'M') {
        audio.unlock();
        audio.toggleMute();
      }
    });
    this.#render();
  }

  #toggle(button, on) {
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('is-off', !on);
    const state = button.querySelector('.audio-state');
    if (state) state.textContent = on ? 'ON' : 'OFF';
  }

  #render() {
    const d = this.#dom;
    const muted = audio.muted;
    const level = Math.round(audio.volume * 100);
    d.mute.setAttribute('aria-pressed', String(muted));
    d.mute.classList.toggle('is-muted', muted);
    d.mute.querySelector('.mute-icon').replaceChildren(pixelIcon(muted || level === 0 ? 'px-speaker-off' : level < 40 ? 'px-speaker-low' : 'px-speaker'));
    d.mute.setAttribute('aria-label', muted ? 'Activar el sonido' : 'Silenciar todo');
    for (const range of [d.volume, d.panelVolume]) {
      if (document.activeElement !== range) range.value = String(level);
      range.setAttribute('aria-valuetext', muted ? `${level} %, silenciado` : `${level} %`);
      range.classList.toggle('is-muted', muted);
    }
    d.volumeValue.textContent = muted ? `${percent(audio.volume)} · silencio` : percent(audio.volume);
    this.#toggle(d.lite, settings.lite);
    this.#toggle(d.rain, settings.matrix);
    this.#toggle(d.crt, settings.scanlines);
    d.rain.disabled = settings.lite;
    d.crt.disabled = settings.lite;
    d.liteStatus.textContent = `${settings.liteAuto ? 'Automático: ' : ''}${settings.lite ? 'activado. Sin lluvia ni scanlines, ambiente estático y menos partículas.' : 'desactivado. Actívalo en equipos básicos para ahorrar CPU y batería.'}`;
  }
}

export const settingsUi = new SettingsUi();
