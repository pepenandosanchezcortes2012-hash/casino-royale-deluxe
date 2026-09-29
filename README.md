# Casino Royale Deluxe

**▶ Jugar ahora:** https://pepenandosanchezcortes2012-hash.github.io/casino-royale-deluxe/

Plataforma de casino web **100 % estática y autocontenida** (HTML5 + CSS3 + JavaScript ES modules, sin frameworks ni dependencias), con la experiencia de un casino online moderno:

- **Blackjack multimano**: 3 asientos con apuesta principal, **Perfect Pairs** y **21+3**; coach de **estrategia básica** y entrenador de conteo **Hi-Lo** (Running Count y True Count).
- **Ruleta Francesa**: tapete clásico y **racetrack** con Voisins du Zéro, Tiers du Cylindre, Orphelins, Jeu Zéro y **vecinos ±1 a ±3**; **zoom balístico** sobre la bola en el Canvas; Repetir y Repetir ×2.
- **Slots Matrix 4×4**: **avalancha** con multiplicador ×1 ×2 ×3 ×5, **giros gratis con multiplicadores dorados**, **Bonus Buy** y **Auto-Spin** con límites de pérdida y de premio.
- **Inmersión**: voz del crupier con **Web Speech API** (español/inglés), **música lounge/jazz procedural**, rangos VIP con **XP** (Bronce → Diamante), bono diario y rescate por rango.

Todo el azar sale de `crypto.getRandomValues()`, todo el sonido se sintetiza con Web Audio API y todos los gráficos (cartas, fichas, símbolos, rueda, racetrack) se dibujan en SVG/Canvas: no hay imágenes ni audios externos.

> Fichas virtuales sin valor monetario. Proyecto de entretenimiento y demostración técnica.

## Publicar en GitHub Pages (2 pasos)

1. **Sube el proyecto** a un repositorio de GitHub (con `index.html` en la raíz):
   ```bash
   git init && git add . && git commit -m "Casino Royale Deluxe"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/casino-royale-deluxe.git
   git push -u origin main
   ```
2. En GitHub: **Settings → Pages → Build and deployment → Source: _Deploy from a branch_**, rama **`main`**, carpeta **`/ (root)`** y **Save**. En un minuto estará en `https://<tu-usuario>.github.io/casino-royale-deluxe/`.

El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

## Probar en local

Los módulos ES no se cargan desde `file://`; sirve la carpeta por HTTP:

```bash
python -m http.server 8080      # o: npx serve .
# abre http://localhost:8080
```

Auditoría matemática automatizada (Node 20+, sin dependencias):

```bash
npm test
```

## Estructura

```
index.html                  Estructura semántica, sprite SVG, diálogos (Club VIP, sonido, auto-spin, bonus), CSP
css/main.css                Variables, temas de tapete, layout, cabecera y pestañas
css/tables.css              Mesa multimano, racetrack, rueda, gabinete de slots con avalancha
css/components.css          Botones, fichas, cartas 3D, modales, controles de sonido, rangos VIP
js/app.js                   Inicializador maestro, pestañas accesibles, desbloqueo y pausa del audio
js/engine/rng.js            Entropía criptográfica, Fisher-Yates, muestreo ponderado, probabilidad
js/engine/store.js          State Store unidireccional y máquina de estados atómica
js/engine/wallet.js         Monedero con escrow anti doble gasto, XP, rangos VIP, bono diario, rescate
js/engine/storage.js        Persistencia localStorage tolerante a fallos
js/engine/audio.js          Buses de efectos y música, efectos sintetizados, fachada de voz
js/engine/music.js          Música lounge procedural (piano FM, contrabajo walking, escobillas, vibráfono)
js/engine/voice.js          Voz del crupier con Web Speech API (es/en)
js/engine/particles.js      Confeti y chispas doradas en Canvas
js/ui/svg.js                Cartas (índices jumbo), fichas y símbolos generados con createElementNS
js/ui/hud.js                Saldo, rango y XP, Club VIP, panel de sonido y voz, avisos
js/ui/input.js              Clic derecho / pulsación larga para retirar fichas
js/games/blackjack-rules.js Reglas puras: liquidación, Perfect Pairs, 21+3, estrategia básica, Hi-Lo
js/games/blackjack.js       Mesa multimano: asientos, seguro por asiento, coach, conteo, reanudación
js/games/roulette.js        Plato con zoom balístico, tapete, racetrack y apuestas anunciadas
js/games/slots-engine.js    Motor matemático: líneas, avalancha, giros gratis, multiplicador dorado
js/games/slots.js           Rodillos, animación de avalancha, Bonus Buy y Auto-Spin
tests/math.test.js          22 pruebas de RNG, reglas, ventajas exactas y RTP (node:test)
```

## Blackjack multimano (Las Vegas Strip)

| Regla | Valor |
|---|---|
| Asientos | Hasta 3, con decisiones independientes por mano |
| Zapato | 6 barajas (312 cartas), Fisher-Yates, carta de corte al 75 % |
| Blackjack natural | Paga 3 a 2 |
| Crupier | Pide con 16 o menos, se planta con todos los 17 (S17) y revisa Blackjack (peek) |
| Seguro | Se ofrece asiento por asiento con As visible; cuesta media apuesta y paga 2 a 1 |
| Doblar / Dividir | Doblar con dos cartas (también tras dividir); dividir hasta 4 manos por asiento; ases divididos reciben una carta |
| Límites | Principal 10–5.000 · laterales hasta 1.000 (requieren apuesta principal) |

**Apuestas laterales** (se resuelven con las dos primeras cartas y la carta visible del crupier). Ventaja de la casa **exacta**, calculada enumerando el zapato completo con multiplicidades (las pruebas también reproducen los valores publicados para 8 barajas: 4,10 % y 3,70 %):

| Perfect Pairs | Paga | | 21+3 | Paga |
|---|---|---|---|---|
| Pareja perfecta (mismo palo) | 25:1 | | Trío del mismo palo | 100:1 |
| Pareja de color | 12:1 | | Escalera de color | 40:1 |
| Pareja mixta | 6:1 | | Trío | 30:1 |
| **Ventaja (6 barajas)** | **6,11 %** | | Escalera | 10:1 |
| | | | Color | 5:1 |
| | | | **Ventaja (6 barajas)** | **4,62 %** |

**Modo didáctico**
- **Coach**: recomienda en tiempo real la jugada de estrategia básica (6 barajas, S17, doblar tras dividir, sin rendición), resalta el botón y puntúa tu precisión. Si no puedes doblar o dividir, recomienda la alternativa correcta.
- **Entrenador Hi-Lo**: etiqueta cada carta (2–6 = +1, 7–9 = 0, 10–As = −1) y muestra Running Count, True Count (RC ÷ mazos restantes) y mazos restantes; la carta oculta del crupier no cuenta hasta que se descubre. Con True Count ≥ +3 el coach recomienda el seguro.

## Ruleta Francesa

- 37 casillas en el orden físico real del plato europeo.
- Tapete con plenos, divididas, calles, cuadros, docenas, columnas y suertes sencillas, además de **divididas y tríos con el cero** (0/1, 0/2, 0/3, 0/1/2, 0/2/3).
- **Racetrack** con los números en el orden del plato:

| Apuesta anunciada | Fichas | Números | Reparto |
|---|---|---|---|
| Voisins du Zéro | 9 | 17 | 2 en trío 0/2/3, 4/7, 12/15, 18/21, 19/22, 2 en cuadro 25/29, 32/35 |
| Tiers du Cylindre | 6 | 12 | 5/8, 10/11, 13/16, 23/24, 27/30, 33/36 |
| Orphelins | 5 | 8 | pleno 1, 6/9, 14/17, 17/20, 31/34 |
| Jeu Zéro | 4 | 7 | 0/3, 12/15, pleno 26, 32/35 |
| Vecinos | 3, 5 o 7 | 3, 5 o 7 | pleno al número y ±1, ±2 o ±3 casillas del plato |

- **Todas** las apuestas, simples o anunciadas, tienen la misma ventaja de la casa: `1 − 36/37 = 2,7027 %` (verificado para cada casilla del tapete y cada apuesta anunciada).
- **Zoom balístico**: el número se sortea antes de lanzar la bola y la física se resuelve en forma cerrada (desaceleración en la pista + oscilador amortiguado entre los trastes). Al entrar la bola en la fase final, una cámara suavizada acerca el plato ×1,9 al sector donde cae, la sigue en los rebotes y se aleja tras mostrar el número; el rotor se renderiza a doble resolución para que el zoom sea nítido.
- Acciones rápidas: **Deshacer**, **Limpiar**, **Repetir**, **Repetir ×2** y **Doblar**.

## Slots Matrix 4×4 con avalancha

- 10 líneas (4 filas, 4 columnas, 2 diagonales); 3 o 4 iguales desde la primera celda (4 = **Súper Bono ×15**).
- **Avalancha**: los símbolos ganadores explotan, el resto cae y entran símbolos nuevos en el mismo giro; cada combo sucesivo aplica **×1, ×2, ×3 y ×5** (se mantiene en ×5).
- **Giros gratis**: 10 (3 diamantes), 12 (4) o 15 (5+), con rodillos premium y un **multiplicador dorado** en cada giro (×2 40 %, ×3 25 %, ×5 18 %, ×10 10 %, ×25 5 %, ×50 1,5 %, ×100 0,5 %); 3+ diamantes durante el bono suman +5 giros.
- **Bonus Buy**: 10 giros gratis por 100 × apuesta, con confirmación.
- **Auto-Spin**: 10–100 tiradas con **límite de pérdida obligatorio**, límite por premio y parada opcional al activarse el bono; se detiene al cambiar de mesa o de pestaña.
- Premio máximo: 5.000 × apuesta por giro o por ronda de bono.

| Símbolo | Peso base | Peso bono | 3 en línea | 4 en línea |
|---|---|---|---|---|
| Diamante (scatter) | 1,8 % | 2,0 % | 3 → ×2 · 4 → ×10 · 5+ → ×50 apuesta | + giros gratis |
| Corona Real | 6,0 % | 15,8 % | ×50 | ×750 |
| 7 de Oro | 9,0 % | 17,0 % | ×20 | ×300 |
| Campana | 13,0 % | 18,0 % | ×8 | ×120 |
| Herradura | 18,0 % | 17,0 % | ×4 | ×60 |
| Trébol | 22,0 % | 15,0 % | ×1 | ×15 |
| Cerezas | 30,2 % | 15,2 % | ×1 | ×15 |

Premios de línea en apuestas de línea (apuesta ÷ 10). La avalancha hace que las celdas dejen de ser independientes entre combos, así que el RTP se **mide** con el motor real, con reducción de varianza (líneas y scatter medidos directamente; giros gratis = frecuencia de activación × valor medio de la ronda):

| Componente | RTP |
|---|---|
| Líneas con avalancha | 60,02 % |
| Scatter | 0,95 % |
| Giros gratis | 35,33 % |
| **Total juego base** | **96,29 % (± 0,1)** |
| **Compra de bono** | **96,25 % (± 0,14)** |

Muestra: 60 millones de tiradas del juego base y 4,5 millones de rondas de bono. Frecuencia de premio 37,5 %; giros gratis 1 de cada 276 tiradas. Las pruebas vuelven a simular el motor con un PRNG con semilla y comprueban ambos valores.

## Voz, música y rangos VIP

- **Voz del crupier** (Web Speech API, voces instaladas en el dispositivo): «Hagan sus apuestas», «No va más», anuncio del número y color, «Blackjack», «Gana la casa», «El crupier se pasa», giros gratis, súper bono y ascensos de rango. En español o inglés; solo habla tras la primera interacción y nunca acumula frases en cola.
- **Música lounge procedural**: progresión de 8 compases (I–vi–ii–V…) con piano eléctrico FM y trémolo estéreo, contrabajo walking con aproximaciones cromáticas, ride y escobillas con swing, vibráfono ocasional y reverb por convolución. Cada compás varía; se pausa con la pestaña oculta.
- **Volúmenes independientes** de efectos, música y voz, más silencio total, en el panel de sonido.
- **XP y rangos**: 1 XP por ficha apostada en cualquier mesa.

| Rango | XP | Rescate por bancarrota | Bono diario |
|---|---|---|---|
| Bronce | 0 | 500 | 100 |
| Plata | 5.000 | 750 | 250 |
| Oro | 25.000 | 1.000 | 500 |
| Platino | 100.000 | 1.500 | 1.000 |
| Diamante | 400.000 | 2.500 | 2.500 |

El bono diario se reclama una vez por día natural en el Club VIP; el rescate aparece si el saldo baja del mínimo sin apuestas en juego (enfriamiento de 3 minutos).

## Arquitectura y seguridad

- **State Store unidireccional**: cada mesa tiene un `Store` con estado inmutable (`deepFreeze`) y fases atómicas `IDLE → BETTING → DEALING → RESOLVING → PAYOUT`; una transición ilegal lanza un error.
- **Anti doble gasto**: las fichas pasan del saldo a un **escrow** por mesa al apostar (`hold`), se liquidan en cuanto se decide el azar (`settle`) y el premio se acredita al terminar la animación (`reveal`). Los controles se desactivan con el flag `busy`. «En juego» muestra solo lo apostado, sin revelar el resultado antes de tiempo.
- **Recargar no hace trampa**: el resultado se liquida antes de animarse; al recargar se abonan los premios pendientes, se devuelven las apuestas de ruleta aún no sorteadas, la mano de blackjack se **reanuda** y los giros gratis pendientes se conservan.
- **Protección XSS**: todo el DOM dinámico se crea con `createElement`/`createElementNS` y `textContent`; no se usa `innerHTML`. Una Content-Security-Policy bloquea scripts y estilos en línea.
- **Monedero**: 1.000 fichas iniciales, denominaciones 10/25/50/100/500/1000, persistencia en `localStorage`.
- **Tienda de tapetes** en el Club VIP: Verde Esmeralda, Azul Zafiro, Rojo Carmesí y Negro Ónix, aplicados en tiempo real.

## Accesibilidad y responsive

- Pestañas con roles ARIA y navegación con flechas, Inicio y Fin; regiones `aria-live` para mensajes, coach y resultados; diálogos nativos `<dialog>`.
- Áreas de toque mínimas de 44×44 px en botones, fichas, círculos de apuesta y controles (las apuestas de borde del tapete, de 26 px, están sobre las líneas como en una mesa real).
- En móviles los tres asientos caben en pantalla con cartas de índice grande; el tapete y el racetrack se desplazan horizontalmente dentro de su contenedor, sin mover la página.
- Respeta `prefers-reduced-motion` (sin zoom de cámara y con animaciones abreviadas).
