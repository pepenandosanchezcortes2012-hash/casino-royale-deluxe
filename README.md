# Casino Royale Deluxe

**▶ Jugar ahora:** https://pepenandosanchezcortes2012-hash.github.io/casino-royale-deluxe/

Plataforma de casino web **100 % estática y autocontenida** (HTML5 + CSS3 + JavaScript ES modules, sin frameworks ni dependencias): Blackjack con reglas de Las Vegas Strip, Ruleta Europea con plato físico en Canvas y Slots Matrix 4×4 con par sheet de ~96 % RTP. Todo el azar sale de `crypto.getRandomValues()`, todo el sonido se sintetiza con Web Audio API y todos los gráficos (cartas, fichas, símbolos, rueda) se dibujan en SVG/Canvas: no hay imágenes ni audios externos.

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

Auditoría matemática automatizada (Node 20+ sin dependencias):

```bash
npm test
```

## Estructura

```
index.html              Estructura semántica, sprite SVG (palos, símbolos, degradados), CSP y meta móviles
css/main.css            Variables, temas de tapete, layout, cabecera y pestañas
css/tables.css          Mesa de blackjack, rueda y tapete de ruleta, gabinete de slots
css/components.css      Botones, fichas, cartas 3D (preserve-3d), avisos, tienda VIP
js/app.js               Inicializador maestro, pestañas accesibles, desbloqueo de audio
js/engine/rng.js        Entropía criptográfica, Fisher-Yates, muestreo ponderado, probabilidad
js/engine/store.js      State Store unidireccional y máquina de estados atómica
js/engine/wallet.js     Monedero con escrow anti doble gasto, rescate y tapetes VIP
js/engine/storage.js    Persistencia localStorage tolerante a fallos
js/engine/audio.js      Sintetizador Web Audio (cartas, fichas, bola, rodillos, campanas)
js/engine/particles.js  Confeti y chispas doradas en Canvas
js/ui/svg.js            Cartas, fichas y símbolos vectoriales generados con createElementNS
js/ui/hud.js            Saldo, racks de fichas, rescate por bancarrota, tienda VIP, avisos
js/games/blackjack.js   Reglas, crupier, peek, seguro, doblar, dividir y reanudación
js/games/roulette.js    Física del plato en Canvas y resolución de apuestas del tapete
js/games/slots.js       Par sheet, rodillos, líneas, Súper Bono, scatter y giros gratis
tests/math.test.js      Pruebas de RNG, reglas, ventaja de la casa y RTP (node:test)
```

## Integridad matemática

### Generador de números aleatorios
- `randomInt(n)` usa **muestreo por rechazo** sobre enteros de 32 bits de `crypto.getRandomValues()`: sin sesgo de módulo.
- `shuffle()` es **Fisher-Yates (Durstenfeld)**: las n! permutaciones son equiprobables.
- Las pruebas verifican uniformidad con chi-cuadrado (37 casillas, p < 0,001).

### Blackjack (Las Vegas Strip)
| Regla | Valor |
|---|---|
| Zapato | 6 barajas (312 cartas), Fisher-Yates, carta de corte al 75 % (carta 234) |
| Blackjack natural | Paga 3 a 2 |
| Crupier | Pide con 16 o menos, se planta con todos los 17 (S17) |
| Dealer Peek | Con As o carta de valor 10 visible revisa la oculta antes de tu turno |
| Seguro | Se ofrece con As visible; cuesta media apuesta y paga 2 a 1 |
| Doblar | Con dos cartas cualesquiera, también tras dividir |
| Dividir | Parejas del mismo valor, hasta 4 manos; los ases divididos reciben una carta |
| Límites | Mínimo 10, máximo 5.000 |

Ventaja teórica de la casa con estas reglas y estrategia básica: ≈ 0,4–0,5 %.

### Ruleta Europea
- 37 casillas en el orden físico real del plato: `0-32-15-19-4-21-2-25-17-34-6-27-13-36-11-30-8-23-10-5-24-16-33-1-20-14-31-9-22-18-29-7-28-12-35-3-26`.
- Pagos: Pleno 35:1, Dividida 17:1, Calle 11:1, Cuadro 8:1, Docena/Columna 2:1, sencillas 1:1.
- **Todas** las apuestas tienen la misma ventaja de la casa: `1 − 36/37 = 2,7027 %` (verificado para las 157 casillas del tapete).
- El número se sortea antes de lanzar la bola; la física se resuelve en forma cerrada (desaceleración constante en la pista + oscilador amortiguado al caer entre los trastes) para que la bola aterrice exactamente en él, con posición y velocidad continuas.

### Slots Matrix 4×4 (par sheet)
Cada una de las 16 celdas es independiente con estos pesos (Σ = 100):

| Símbolo | Peso | 3 en línea | 4 en línea (Súper Bono ×15) |
|---|---|---|---|
| Diamante (scatter) | 3 | — | — |
| Corona Real | 6 | ×90 | ×1.350 |
| 7 de Oro | 9 | ×35 | ×525 |
| Campana | 13 | ×15 | ×225 |
| Herradura | 18 | ×6 | ×90 |
| Trébol | 22 | ×3 | ×45 |
| Cerezas | 29 | ×2 | ×30 |

- 10 líneas (4 filas, 4 columnas, 2 diagonales); premios en apuestas de línea (apuesta ÷ 10).
- Scatter (Diamante): 3 → ×2 apuesta + 8 giros, 4 → ×10 + 10 giros, 5+ → ×50 + 12 giros.
- Giros Gratis con multiplicador progresivo ×1, ×2, ×3, ×4, ×5 (se mantiene en ×5).

RTP exacto por linealidad de la esperanza: cada línea aporta `Σ pay3·(p³(1−p) + 15·p⁴)` y el scatter sigue una binomial B(16, 0,03):

| Componente | RTP |
|---|---|
| Líneas | 68,67 % |
| Scatter | 3,46 % |
| Giros gratis | 24,05 % |
| **Total** | **96,18 %** |

Los giros gratis se activan 1 de cada ~89 tiradas. Una simulación Monte Carlo de 3 millones de tiradas del motor real da 96,4 % (dentro del margen estadístico).

## Arquitectura y seguridad

- **State Store unidireccional**: cada mesa tiene un `Store` con estado inmutable (`deepFreeze`) y fases atómicas `IDLE → BETTING → DEALING → RESOLVING → PAYOUT`. Una transición ilegal lanza un error.
- **Anti doble gasto**: las fichas pasan del saldo a un **escrow** por mesa al apostar (`hold`), se liquidan al decidirse el azar (`settle`) y el premio se acredita al terminar la animación (`reveal`). Los controles se desactivan con el flag `busy` durante las animaciones.
- **Recargar no hace trampa**: el resultado se liquida antes de animarse; al recargar se abonan los premios pendientes, se devuelven las apuestas de ruleta/slots aún no sorteadas y la mano de blackjack se **reanuda** desde `localStorage`.
- **Protección XSS**: todo el DOM dinámico se crea con `createElement`/`createElementNS` y `textContent`; no se usa `innerHTML`. Una Content-Security-Policy bloquea scripts y estilos en línea.
- **Monedero**: 1.000 fichas iniciales, denominaciones 10/25/50/100/500/1000, persistencia en `localStorage` y **Rescate por Bancarrota** (+500, enfriamiento de 3 minutos) cuando el saldo baja del mínimo y no hay apuestas en juego.
- **Tienda VIP**: tapetes Verde Esmeralda (incluido), Azul Zafiro (1.000), Rojo Carmesí (2.500) y Negro Ónix (5.000), aplicados en tiempo real con variables CSS.

## Audio procedural

| Efecto | Síntesis |
|---|---|
| Carta deslizada | Ruido blanco → paso banda con barrido 3,4→1,3 kHz y caída exponencial |
| Barajeo | 34 ráfagas cortas de ruido en cascada + puente de cartas |
| Fichas cerámicas | Dos resonancias inarmónicas (f y 1,53f) con decaimiento de ~70 ms + rebote |
| Bola de ruleta | Ruido resonante modulado por un LFO que se ralentiza + clics en cada traste |
| Rodillos | Tren de clics del mecanismo + zumbido de motor filtrado + golpe de parada |
| Victoria | Campana con parciales 1 : 2 : 2,76 : 4,07 : 5,4 y arpegios según el premio |

El `AudioContext` se crea y reanuda en el primer gesto del usuario, respetando las políticas de autoplay.

## Accesibilidad y responsive

- Pestañas con roles ARIA y navegación con flechas, Inicio y Fin; regiones `aria-live` para resultados.
- Áreas de toque mínimas de 44×44 px en botones, fichas y casillas numéricas (las apuestas de borde —divididas, calles, cuadros— son marcadores de 26 px sobre las líneas, como en un tapete real).
- El tapete de ruleta se desplaza horizontalmente dentro de su contenedor en móviles, sin desplazar la página.
- Respeta `prefers-reduced-motion`.
