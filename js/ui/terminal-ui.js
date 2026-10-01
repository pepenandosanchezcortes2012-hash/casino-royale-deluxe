// Terminal hacker de la torre del Sindicato: fondo negro, fósforo verde/cian y scanlines opcionales.
// Se abre con la tecla ~ o con el botón >_ del HUD. Historial con ↑/↓, autocompletado con Tab y
// copia de seguridad (exportar/importar) de toda la partida en JSON.

import { runCommand, complete, PROMPT } from '../terminal.js';
import { climb } from '../climb/climb.js';
import { fair } from '../provably_fair.js';
import { relics } from '../relics.js';
import { progression } from '../progression.js';
import { settings } from '../settings.js';
import { wallet } from '../engine/wallet.js';
import { storage } from '../storage.js';
import { audio } from '../audio.js';
import { el } from './svg.js';

const MAX_LINES = 400;
const HISTORY_LIMIT = 50;
const BANNER = Object.freeze([
  ['SYNDICATE OS · terminal de auditoría de la torre del Sindicato', 'accent'],
  ['Canal cifrado · semillas provably fair · HMAC-SHA256', 'dim'],
  ['Escribe `help` para ver los comandos. Esc o `exit` para salir.', 'dim'],
]);

class TerminalUi {
  #dom = null;
  #telemetry = null;
  #history = [];
  #cursor = -1;
  #greeted = false;
  #lastTick = 0;
  #actions = {};

  // `travel(id)` y `takeRescue()` pasan por la interfaz de la escalada (transiciones y avisos).
  init({ telemetry, travel = null, takeRescue = null }) {
    this.#telemetry = telemetry;
    this.#actions = { travel, takeRescue };
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      dialog: $('terminal'),
      screen: $('terminal-screen'),
      output: $('terminal-output'),
      input: $('terminal-input'),
      close: $('terminal-close'),
      file: $('import-file'),
      button: $('btn-terminal'),
    };
    const d = this.#dom;
    d.close.addEventListener('click', () => this.close());
    d.screen.addEventListener('click', (event) => {
      if (!window.getSelection()?.toString() && event.target !== d.input) d.input.focus();
    });
    d.input.addEventListener('keydown', (event) => this.#onKey(event));
    d.dialog.addEventListener('close', () => {
      d.button?.setAttribute('aria-expanded', 'false');
      d.button?.focus({ preventScroll: true });
    });
    d.file.addEventListener('change', () => this.#importFile());
  }

  get #context() {
    return {
      climb,
      fair,
      relics,
      progression,
      settings,
      wallet,
      travel: this.#actions.travel ?? undefined,
      takeRescue: this.#actions.takeRescue ?? undefined,
      verify: (nonce) => this.#telemetry.verifyNonce(nonce),
    };
  }

  toggle() {
    if (this.#dom.dialog.open) this.close();
    else this.open();
  }

  open() {
    const d = this.#dom;
    if (!this.#greeted) {
      this.#greeted = true;
      for (const [text, tone] of BANNER) this.#print(text, tone);
    }
    audio.click();
    d.dialog.showModal();
    d.button?.setAttribute('aria-expanded', 'true');
    d.input.focus();
  }

  close() {
    if (this.#dom.dialog.open) this.#dom.dialog.close();
  }

  #print(text, tone = 'info') {
    const output = this.#dom.output;
    output.append(el('li', `term-line is-${tone}`, text));
    while (output.children.length > MAX_LINES) output.firstElementChild.remove();
    this.#dom.screen.scrollTop = this.#dom.screen.scrollHeight;
  }

  #onKey(event) {
    const input = this.#dom.input;
    if (event.key === 'Enter') {
      event.preventDefault();
      const line = input.value;
      input.value = '';
      this.#execute(line);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.#history.length) return;
      const step = event.key === 'ArrowUp' ? -1 : 1;
      this.#cursor = Math.min(this.#history.length, Math.max(0, (this.#cursor < 0 ? this.#history.length : this.#cursor) + step));
      input.value = this.#history[this.#cursor] ?? '';
      requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const [word, ...rest] = input.value.split(' ');
      const options = complete(word);
      if (options.length === 1) input.value = [options[0], ...rest].join(' ') + (rest.length ? '' : ' ');
      else if (options.length > 1) this.#print(options.join('  '), 'dim');
    } else if (event.key.length === 1) {
      const now = performance.now();
      if (now - this.#lastTick > 35) {
        this.#lastTick = now;
        audio.typeTick();
      }
    }
  }

  #execute(line) {
    const text = line.trim();
    this.#print(`${PROMPT} ${text}`, 'prompt');
    if (!text) return;
    if (this.#history.at(-1) !== text) this.#history.push(text);
    if (this.#history.length > HISTORY_LIMIT) this.#history.shift();
    this.#cursor = -1;
    const result = runCommand(text, this.#context);
    for (const item of result.lines) this.#print(item.text, item.tone);
    switch (result.action) {
      case 'clear':
        this.#dom.output.replaceChildren();
        break;
      case 'close':
        setTimeout(() => this.close(), 250);
        break;
      case 'export':
        this.#export();
        break;
      case 'import':
        this.#dom.file.value = '';
        this.#dom.file.click();
        break;
      default:
        break;
    }
  }

  #export() {
    const backup = storage.exportData();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `syndicate-climb-copia-${backup.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.#print(`Copia exportada: ${Object.keys(backup.data).length} claves → ${link.download}`, 'ok');
  }

  async #importFile() {
    const file = this.#dom.file.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      this.#print('El archivo es demasiado grande para ser una copia de la partida.', 'error');
      return;
    }
    const text = await file.text();
    const result = storage.importData(text);
    if (!result.ok) {
      this.#print(`Importación rechazada: ${result.error}. No se ha cambiado nada.`, 'error');
      return;
    }
    this.#print(`Copia restaurada: ${result.keys} claves. Reiniciando la torre…`, 'ok');
    setTimeout(() => location.reload(), 1200);
  }
}

export const terminalUi = new TerminalUi();
