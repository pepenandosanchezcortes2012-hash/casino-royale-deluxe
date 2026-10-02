// Gestor de la PWA: registra el service worker (que deja el juego en caché para jugar sin
// conexión), recoge el aviso de instalación del navegador para ofrecer un botón «Instalar» y avisa
// cuando una versión nueva queda lista (se aplica al recargar, sin cortar la partida en curso).

class PwaManager extends EventTarget {
  #prompt = null;
  #registered = false;
  #updated = false;

  get supported() {
    return 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  }

  // ¿Se puede ofrecer el botón «Instalar»?
  get canInstall() {
    return this.#prompt !== null;
  }

  // ¿Se está ejecutando ya como app instalada?
  get installed() {
    return globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  get offlineReady() {
    return this.#registered;
  }

  get updateReady() {
    return this.#updated;
  }

  init() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.#prompt = event;
      this.dispatchEvent(new Event('change'));
    });
    window.addEventListener('appinstalled', () => {
      this.#prompt = null;
      this.dispatchEvent(new Event('change'));
    });
    if (!this.supported) return;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // La primera instalación no es una actualización.
      if (!hadController) return;
      this.#updated = true;
      this.dispatchEvent(new Event('update'));
      this.dispatchEvent(new Event('change'));
    });
    // Tras la carga, para no competir con los recursos de la propia página.
    const register = () => {
      navigator.serviceWorker.register('service-worker.js', { scope: './' }).then(
        () => {
          this.#registered = true;
          this.dispatchEvent(new Event('change'));
        },
        (error) => console.warn('[pwa] sin service worker:', error?.message ?? error),
      );
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  // Muestra el diálogo de instalación del navegador. Devuelve true si se aceptó.
  async install() {
    const prompt = this.#prompt;
    if (!prompt) return false;
    this.#prompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    this.dispatchEvent(new Event('change'));
    return choice?.outcome === 'accepted';
  }
}

export const pwa = new PwaManager();
