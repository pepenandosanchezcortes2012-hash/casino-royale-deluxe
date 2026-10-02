// Service worker de la PWA: guarda el juego completo al instalarse y lo sirve desde la caché, de
// modo que se puede instalar en el móvil o el escritorio y jugar sin conexión. La lista y la
// versión de la caché las genera tools/build-pwa.mjs (no editar a mano): cada cambio en un
// archivo cambia la versión, el navegador instala la nueva caché y borra la anterior.
// Estrategia: caché primero (todo el juego es una instantánea coherente de una misma versión);
// lo que no esté en la lista va a la red.

const CACHE = 'crd-6.0.0-849ab6ce93';
const ASSETS = [
  './',
  './css/animations.css',
  './css/arcade.css',
  './css/components.css',
  './css/cyber.css',
  './css/fish.css',
  './css/floors.css',
  './css/hacker_terminal.css',
  './css/main.css',
  './css/meta.css',
  './css/pixel.css',
  './css/tables.css',
  './css/themes.css',
  './fonts/press-start-2p.woff',
  './fonts/silkscreen-bold.woff',
  './fonts/silkscreen.woff',
  './fonts/vt323.woff',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './index.html',
  './js/app.js',
  './js/arcade/boss-battle.js',
  './js/arcade/daily.js',
  './js/arcade/hall-of-fame.js',
  './js/arcade/pwa.js',
  './js/arcade/shop.js',
  './js/arcade/trophies.js',
  './js/audio.js',
  './js/climb/achievements.js',
  './js/climb/climb.js',
  './js/climb/contracts.js',
  './js/climb/floors.js',
  './js/climb/narrative.js',
  './js/climb/titles.js',
  './js/engine/chiptune.js',
  './js/engine/music.js',
  './js/engine/rng.js',
  './js/engine/store.js',
  './js/engine/wallet.js',
  './js/event_bus.js',
  './js/games/blackjack-rules.js',
  './js/games/blackjack.js',
  './js/games/crash-math.js',
  './js/games/crash.js',
  './js/games/dice-math.js',
  './js/games/dice.js',
  './js/games/fish-math.js',
  './js/games/fish.js',
  './js/games/mines-math.js',
  './js/games/mines.js',
  './js/games/plinko-math.js',
  './js/games/plinko.js',
  './js/games/roulette.js',
  './js/games/slots-engine.js',
  './js/games/slots.js',
  './js/games/towers-math.js',
  './js/games/towers.js',
  './js/games/video_poker-math.js',
  './js/games/video_poker.js',
  './js/games/wheel-math.js',
  './js/games/wheel.js',
  './js/mode.js',
  './js/particles.js',
  './js/progression.js',
  './js/provably_fair.js',
  './js/relics.js',
  './js/session.js',
  './js/settings.js',
  './js/storage.js',
  './js/terminal.js',
  './js/ui/arcade-hub.js',
  './js/ui/arcade.js',
  './js/ui/bet-control.js',
  './js/ui/boss-ui.js',
  './js/ui/climb-ui.js',
  './js/ui/cyber-hud.js',
  './js/ui/hud.js',
  './js/ui/input.js',
  './js/ui/matrix-core.js',
  './js/ui/matrix-worker.js',
  './js/ui/matrix.js',
  './js/ui/pixel-art.js',
  './js/ui/pixel-sprites.js',
  './js/ui/settings-ui.js',
  './js/ui/svg.js',
  './js/ui/telemetry.js',
  './js/ui/terminal-ui.js',
  './js/ui/vault-ui.js',
  './js/verify.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('crd-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Navegaciones (también con #mesa o ?parámetros): la portada guardada.
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((cached) => cached ?? fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? fetch(request)));
});
