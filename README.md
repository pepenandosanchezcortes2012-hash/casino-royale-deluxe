# Casino Royale Deluxe · Cyber-Ultra

**▶ Jugar ahora:** https://pepenandosanchezcortes2012-hash.github.io/casino-royale-deluxe/

Un casino estático para GitHub Pages con dos modos, que se eligen en el menú principal:

- **Modo Historia · «El Último Crédito»**: el RPG narrativo de supervivencia de siempre, intacto. Neo-Madrid, 2089: empiezas con **un único crédito** en el sótano de un casino clandestino y tienes que reunir **100.000** para comprar tu libertad. Tiene zonas, encargos del Sindicato, Club VIP, salvavidas y dos finales.
- **Cripto-Casino · modo libre**: **10 juegos provably fair** con semillas verificables. Son blackjack, ruleta, slots, Plinko, Crash, Minas, Dados, Torres, Video Póker y la Rueda diaria. Además tiene niveles 1–50, 6 rangos VIP, misiones diarias, reliquias, cofres, pociones, 5 temas de color, modo turbo y una terminal hacker.

Todo es **100 % estático**: HTML5 semántico, CSS3 y módulos ES nativos, sin frameworks, dependencias, CDN ni archivos de audio. El azar sale de `crypto.getRandomValues()`. En el Cripto-Casino, además, cada resultado se deriva de `HMAC-SHA256` y se puede comprobar a mano. La música y los efectos se sintetizan con Web Audio API (sin voces) y los gráficos son SVG y Canvas 2D.

> Ficción de entretenimiento: créditos y fichas virtuales sin valor monetario, para mayores de 18 años.

## Índice

- [Menú principal y modos](#menú-principal-y-modos)
- [Cripto-Casino](#cripto-casino)
  - [Los 10 juegos](#los-10-juegos)
  - [Provably fair: cómo verificar una jugada](#provably-fair-cómo-verificar-una-jugada)
  - [Reliquias, cofres y pociones](#reliquias-cofres-y-pociones)
  - [Niveles, rangos VIP y misiones](#niveles-rangos-vip-y-misiones)
  - [Economía: fichas, rescate y abundancia](#economía-fichas-rescate-y-abundancia)
  - [Terminal hacker](#terminal-hacker)
  - [Temas, turbo y efectos](#temas-turbo-y-efectos)
- [Modo Historia: El Último Crédito](#modo-historia-el-último-crédito)
- [Slots Matrix 4×4 (ambos modos)](#slots-matrix-44-ambos-modos)
- [Decisiones de diseño y desviaciones del enunciado](#decisiones-de-diseño-y-desviaciones-del-enunciado)
- [Arquitectura y seguridad](#arquitectura-y-seguridad)
- [Rendimiento](#rendimiento)
- [Accesibilidad y responsive](#accesibilidad-y-responsive)
- [Probar, verificar y publicar](#probar-verificar-y-publicar)
- [Estructura](#estructura)

## Menú principal y modos

La primera visita abre un **menú principal** con la lluvia de código de fondo y dos tarjetas. Cada tarjeta resume su partida guardada:

- en la historia, la leyenda, la zona y los créditos;
- en el Cripto-Casino, las fichas, el nivel y los cofres sin abrir.

El modo elegido se recuerda. El botón **☰ Menú** de la cabecera vuelve a esta pantalla desde cualquiera de los dos modos. Solo se bloquea con un cohete de Crash en vuelo sin retiro automático, porque salir haría perder la apuesta.

Cada modo tiene su propio monedero y sus propios guardados: el Cripto-Casino usa claves `crd.cyber.*`, así que nunca toca la leyenda. Lo que sí comparten es la **carrera global**:

- las rondas de la leyenda suman XP al nivel global;
- cada logro de la historia deja un **cofre de reliquias** en la bóveda del Cripto-Casino (una vez por logro);
- la libertad deja un **cofre legendario** por leyenda;
- las fichas de los niveles subidos jugando la historia esperan al Cripto-Casino.

El Expediente de la historia muestra ese progreso.

Las mesas tienen enlaces directos: `…/casino-royale-deluxe/#plinko` abre esa mesa.

## Cripto-Casino

Se empieza con **1.000 fichas** de 10, 25, 50, 100, 500 y 1.000. La cabecera muestra:

- fichas y fichas en juego, con la barra de la abundancia;
- nivel, XP y rango VIP;
- misiones del día;
- las 4 ranuras de reliquias;
- los botones de turbo ⚡, terminal `>_`, música 🎵, efectos 🔊 y menú.

En escritorio, a la derecha, está el panel de **telemetría** provably fair.

### Los 10 juegos

| Juego | Reglas | RTP |
|---|---|---|
| **Blackjack Pro** | 6 barajas barajadas con Fisher-Yates, 3:2, el crupier pide con 16 y se planta con 17, hasta 3 asientos. Perfect Pairs: mixta 6:1, color 12:1, perfecta 25:1. 21+3: color 5:1, escalera 10:1, trío 30:1, escalera de color 40:1, trío del mismo palo 100:1. Coach de estrategia básica y entrenador Hi-Lo | ≈ 99,6 % con estrategia básica · PP 93,89 % · 21+3 95,38 % |
| **Ruleta europea** | 0–36, tapete completo y racetrack francés (Voisins, Tiers, Orphelins, Jeu Zéro y vecinos) | 97,30 % |
| **Slots Matrix 4×4** | 10 líneas, avalancha ×1 → ×2 → ×3 → ×5, comodín 🃏 pegajoso, estrella ⭐ con 8 giros gratis, Bonus Buy a 80× ([detalle](#slots-matrix-44-ambos-modos)) | 96,38 % |
| **Plinko** | 9 filas de clavijas (la primera es la puerta), 9 cubetas, física guiada con gravedad 0,28 y restitución 0,55, bola suelta o **ráfaga de 5** con 150 ms entre bolas | Bajo 97,20 % · Medio 96,80 % · Alto 96,50 % |
| **Crash Rocket** | M(t) = 1 + 0,06 · t^1,35; retiro manual o automático en pleno vuelo | 97 % con cualquier retiro |
| **Minas 5×5** | 1–24 minas; tras k gemas, ×0,97 · C(25, k) / C(25 − m, k); retírate cuando quieras | 97 % |
| **Dados Over/Under** | Tirada de 0,00 a 99,99; probabilidad 1–97 %; multiplicador 98 / P | 98 % |
| **La Torre de la Muerte** | 8 pisos. Fácil: 3 losas y 1 trampa; Media: 2 losas y 1 trampa; Difícil: 3 losas y 2 trampas. ×0,97 / p^n, retiro en cada piso | 97 % |
| **Video Póker Jacks or Better 9/6** | Pagos «por 1»: Jotas 1, Doble pareja 2, Trío 3, Escalera 4, Color 6, Full 9, Póker 25, Escalera de color 50, Escalera real 250 (800 con 5 monedas) | 99,54 % con estrategia óptima y 5 monedas |
| **Rueda de la Fortuna** | Una tirada gratis cada 24 h, 10 gajos: 200, 400, 800, 1.500, 3.000 y bote de 10.000 fichas, Poción ×2 y cofre | ≈ 555 fichas de media, más pociones (10 %) y cofres (8 %) |

**Plinko.** Las cubetas pagan exactamente lo que pide el enunciado:

| Riesgo | Cubetas | Cubeta central / extremos |
|---|---|---|
| Bajo | 5 · 2 · 1,2 · 1 · 0,5 · 1 · 1,2 · 2 · 5 | 29,57 % / 0,32 % cada extremo |
| Medio | 10 · 4 · 1,5 · 0,5 · 0,2 · 0,5 · 1,5 · 4 · 10 | 26,17 % / 0,44 % |
| Alto | 35 · 12 · 2 · 0,2 · 0 · 0,2 · 2 · 12 · 35 | 35,66 % / 0,17 % |

Cada fila la decide un número verificable. El rebote amortiguado tiene un **sesgo publicado hacia el centro**: desde una posición desplazada, la bola vuelve hacia el centro con probabilidad q. Ese q se ha calculado para que el RTP sea exactamente el anunciado (Bajo q = 0,5151, Medio 0,4918, Alto 0,5546). La distribución de las cubetas se calcula de forma exacta y las pruebas la comprueban.

**Crash.** El punto de explosión es E = 0,97 / (1 − r) con el primer número de la ronda, truncado a 2 decimales. Si queda por debajo de ×1,01, el cohete explota al despegar (3,96 % de las rondas). Así, P(llegar a x) = 0,97 / x para cualquier x ≥ 1,01 y el RTP es del 97 % te retires donde te retires.

La apuesta se cobra al despegar y el retiro se abona al instante. Si recargas la página en pleno vuelo, la ronda se resuelve como lo haría el servidor: cobra el retiro automático si el cohete llegaba a él y, si no, se pierde.

**Estado guardado.** Minas, Torres y Video Póker guardan la partida a medias y la reanudan tras recargar, con la apuesta retenida.

### Provably fair: cómo verificar una jugada

1. Antes de apostar, la telemetría publica **`hash = SHA-256(semilla del servidor)`**. La semilla del servidor son 32 bytes aleatorios de `crypto.getRandomValues()` que siguen ocultos.
2. Tú eliges la **semilla del cliente**: se puede editar en la telemetría o con `clientseed` en la terminal. Cada jugada usa un **nonce** creciente.
3. El primer número de la jugada es:
   ```
   HMAC-SHA256(clave = semilla del servidor, mensaje = "semilla del cliente:nonce")
   → los 8 primeros caracteres hexadecimales como entero de 32 bits ÷ 2^32   ∈ [0, 1)
   ```
   Los juegos que necesitan más números (barajas, caminos, avalanchas) siguen con los siguientes grupos de 8 caracteres. Agotado el hash, continúan con `"semilla del cliente:nonce:1"`, `:2`…
4. **Rotar** la semilla (o cambiar la del cliente) **revela** la anterior y publica un compromiso nuevo. Desde ese momento se puede recalcular cada jugada.

Cada apuesta aparece en **Apuestas en vivo** con su nonce. Al pulsarla se abre el **verificador**, que:

- comprueba que `SHA-256(semilla)` coincide con el hash publicado;
- recalcula el HMAC, los 8 hex, el entero y el número;
- reproduce el resultado completo con las mismas funciones matemáticas de la mesa (la tirada, las minas, el camino de Plinko, la mano de póker, el zapato de blackjack…).

La terminal hace lo mismo con `verify <nonce>`. La comprobación también se puede hacer fuera del juego, por ejemplo con Node:

```js
import { createHmac, createHash } from 'node:crypto';
const hmac = createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}`).digest('hex');
console.log(createHash('sha256').update(serverSeed).digest('hex') === serverSeedHash); // true
console.log(parseInt(hmac.slice(0, 8), 16) / 2 ** 32);                               // primer número
```

Cómo usa cada juego sus números:

| Juego | Números del flujo |
|---|---|
| Ruleta | casilla = ⌊r · 37⌋ |
| Dados | tirada = ⌊r · 10 000⌋ / 100 |
| Crash | E = 0,97 / (1 − r), truncado |
| Minas y Torres | Fisher-Yates de las casillas y losas |
| Plinko | una decisión por fila |
| Video Póker | Fisher-Yates de las 52 cartas: las 5 primeras son la mano y las siguientes, las de reposición |
| Blackjack | un nonce por zapato: Fisher-Yates de las 312 cartas; cada mano anota qué cartas usó |
| Slots | cada símbolo y cada duración de bloqueo, por orden |
| Rueda | gajo según los pesos publicados |

Es una **demostración del protocolo sin servidor**: la semilla oculta vive en tu propio navegador, así que alguien que lea `localStorage` podría conocerla antes de rotarla. Con fichas sin valor, solo se engañaría a sí mismo.

### Reliquias, cofres y pociones

La **Bóveda de Reliquias** se abre desde las ranuras de la cabecera. Guarda 10 reliquias; se equipan hasta 4 a la vez y solo actúan en el Cripto-Casino. Las que tocan probabilidades son **variantes de reglas publicadas y verificables**.

| Reliquia | Rareza | Efecto |
|---|---|---|
| 🍀 Trébol de Oro | Rara | +15 % de peso para comodines y estrellas en las slots (RTP con el Trébol: 124,75 %) |
| 🎲 Dado de Montecarlo | Épica | Si el crupier pide con 15 o 16 duros, un número verificable decide (25 %) si su carta es la siguiente de valor 10 del zapato |
| 🛡️ Escudo | Común | Devuelve lo perdido en la primera mano de blackjack perdida de cada sesión |
| 👑 Corona de Midas | Legendaria | +20 % de cada premio neto (×1,20) |
| 🧲 Imán de Cashback | Rara | Devuelve el 10 % de cada pérdida neta |
| ⏳ Reloj de la Abundancia | Común | +50 fichas extra cada minuto de juego activo |
| 🔋 Batería Cuántica | Épica | Tras una tirada de slots sin premio, un 25 % de las veces (con el siguiente número del giro) vuelves a girar gratis |
| 💎 Zafiro de Plinko | Rara | Otro sesgo publicado hacia los extremos: +8 puntos de RTP en cada riesgo |
| 📡 Radar de Crash | Épica | Alarma visual al llegar al 80 % del punto de explosión |
| 🎟️ Pase del Padrino | Legendaria | Duplica toda la XP |

| Cofre | Precio | Rarezas (reliquia nueva garantizada) | Extra | Con la colección completa |
|---|---|---|---|---|
| Común | 2.500 fichas | Común 55 % · Rara 30 % · Épica 12 % · Legendaria 3 % | — | 1.500 fichas |
| Legendario | 15.000 fichas | Rara 30 % · Épica 45 % · Legendaria 25 % | +1 poción | 10.000 fichas |

Cada cofre saca **una reliquia que aún no tienes**, con una animación de gacha. La reliquia se equipa sola si hay una ranura libre. Los cofres se ganan con los niveles, los rangos, las misiones, la Rueda y los logros de la historia, y también se compran.

La **Poción ×2** duplica el siguiente premio que cobres, en cualquier juego salvo la Rueda.

### Niveles, rangos VIP y misiones

- **XP por ronda** = apuesta × 0,25 + premio × 0,5, y × 2 con el Pase del Padrino. Las rondas del Modo Historia también suman.
- **Niveles 1–50**: pasar del nivel n al n + 1 cuesta 100 · n^1,6 XP. Cada nivel paga **100 × nivel** fichas, cada 5 niveles da un cofre común y cada rango, uno legendario.

| Rango VIP | Nivel | XP total | Abundancia por minuto | Rondas de 100 fichas (aprox.) |
|---|---|---|---|---|
| Bronce | 1 | 0 | 50 | — |
| Plata | 10 | 13.372 | 60 | 180 |
| Oro | 20 | 86.877 | 70 | 1.200 |
| Platino | 30 | 254.960 | 80 | 3.500 |
| Diamante | 40 | 544.664 | 90 | 7.400 |
| El Padrino | 50 | 979.417 | 100 | 13.300 |

**10 misiones diarias acumulativas**. Se renuevan a medianoche y se pagan solas al completarse. Completar las 10 da además un cofre común y +1.000 fichas.

| Misión | Recompensa |
|---|---|
| Juega 40 rondas | 400 fichas · 150 XP |
| Apuesta 5.000 fichas en total | 500 · 200 |
| Gana 15 rondas | 400 · 150 |
| Gana 5 manos de blackjack | 300 · 120 |
| Juega 10 tiradas de ruleta | 250 · 100 |
| Consigue 3 avalanchas dobles en las slots | 350 · 140 |
| Lanza 25 bolas de Plinko | 250 · 100 |
| Retírate en Crash a ×2 o más 3 veces | 350 · 140 |
| Descubre 12 casillas seguras en Minas o Torres | 300 · 120 |
| Consigue un premio de ×10 o más | 600 · 250 |

### Economía: fichas, rescate y abundancia

- **Fondo de rescate**: si el saldo baja de la ficha mínima (10) sin nada en juego, el casino te presta **+500 fichas** automáticamente.
- **Reloj de la abundancia**: cada **60 s con la pestaña visible**, +50 fichas, más el extra del rango y del Reloj de la Abundancia. Lo acompañan un mensaje flotante sobre el saldo y una marimba suave, y la barra bajo el saldo muestra cuánto falta. Con la pestaña oculta, el reloj se pausa.

### Terminal hacker

Se abre con la tecla **`~`** (o `º`/`` ` ``, la misma tecla física) o con el botón `>_`. Tiene fondo negro, fósforo verde y cian, scanlines CRT opcionales, historial con ↑/↓ y autocompletado con Tab.

| Orden | Qué hace |
|---|---|
| `help` | Lista de órdenes (también `ayuda`) |
| `seeds` | Hash comprometido, semilla del cliente y nonce |
| `rotate` | Revela la semilla del servidor y compromete otra |
| `clientseed <texto>` | Cambia tu semilla del cliente |
| `verify <nonce>` | Recalcula una jugada con la semilla ya revelada |
| `history [n]` | Últimas apuestas |
| `rtp` | Retorno teórico de los 10 juegos |
| `relics` | Ranuras, colección, cofres y pociones |
| `missions` · `level` · `balance` | Misiones, nivel y saldo |
| `matrix on\|off` · `turbo on\|off` · `crt on\|off` | Lluvia de fondo, modo turbo y scanlines |
| `theme <matrix\|neon\|onyx\|gold\|blood>` | Tema de color |
| `export` · `import` | Copia de seguridad de toda la partida en JSON |
| `clear` · `exit` | Limpiar y cerrar |

`export` descarga todas las claves `crd.*` en un JSON. `import` valida la copia entera antes de tocar nada (formato, versión, claves `crd.*`, tamaño), la restaura, aplica las migraciones y recarga.

### Temas, turbo y efectos

- **5 temas**: Matrix Green (por defecto), Cyberpunk Neon, Onyx, Gold Imperial y Blood Red. Cada tema redefine la paleta cyber y también los tokens de las mesas clásicas: el oro, el tapete y los paneles.
- **Turbo ⚡**: divide por dos las animaciones sin tocar ninguna probabilidad ni ningún pago. La frenada de la ruleta pasa al 40 % (100 → 40 fotogramas), el blackjack reparte una carta cada 150 ms, y Plinko y Crash simulan el doble de rápido.
- **Efectos**: sacudida de pantalla por «trauma» (minas, trampas, explosiones), glitch del título, chispas y confeti de un pool de partículas sin basura, y la lluvia Matrix en un Web Worker.
- **Sonido procedural** con Web Audio: clavijas de Plinko, motor del cohete que sube de tono con el multiplicador, explosión, gemas, minas, dados, losas, cofres, reliquias, subida de nivel y la marimba de la abundancia. Música y efectos tienen interruptores independientes.

## Modo Historia: El Último Crédito

Está **intacto**: la misma campaña, los mismos encargos, zonas, logros, Club VIP y finales. Las mesas del modo conservan al 100 % sus apuestas laterales, el racetrack y las avalanchas. Sus novedades son:

- el sexto rango del Club VIP, **El Padrino**;
- el motor v4 de las slots;
- el botón Menú;
- la conexión con la carrera global.

### La historia

1. **Prólogo**: una cinemática con lluvia y texto a máquina de escribir. Se puede saltar y releer desde el Expediente.
2. **Leyenda nº N**: cada partida empieza con **1 crédito**, 3 favores del Sindicato, los rescates de tu rango VIP y el título «Rata del Callejón».
3. **Ascenso**: tu saldo abre las zonas superiores. Cada zona cambia las mesas, las fichas, el crupier, la música y la iluminación.
4. **Final**: con 100.000 créditos compras tu libertad («Dueño del Destino»). Sin créditos ni salvavidas llega el Game Over definitivo.

### Las tres zonas

| | Nivel 1 · El Callejón | Nivel 2 · El Salón de Neón | Nivel 3 · El Penthouse |
|---|---|---|---|
| Acceso | Desde el inicio | 250 créditos | 5.000 créditos |
| Expulsión por debajo de | — | 100 | 2.500 |
| Crupier | Moss | Vera | SIBILA, la IA del Sindicato |
| Fichas | 1 · 5 · 10 | 5 · 10 · 25 · 100 · 500 | 100 · 500 · 1K · 5K · 10K |
| Blackjack | 1 asiento, 1–10, sin laterales | 3 asientos, 5–500, laterales hasta 100 | 3 asientos, 100–25.000, laterales hasta 5.000 |
| Ruleta | 10 por casilla, sin racetrack | 500 por casilla, con racetrack | 25.000 por casilla |
| Slots | 1–10, sin Bonus Buy | 10–500, con Bonus Buy | 500–10.000, con Bonus Buy |

### Encargos, logros y Club VIP

- **Encargos del Sindicato**: 3 a la vez por zona. Pagan una base × el factor de la zona (×2, ×30 y ×600), que se calibró con los motores reales. Las mesas conservan su ventaja de la casa, así que el progreso viene de ahí.
- **17 logros** con recompensa y **títulos** que siguen al saldo, de «Alma en Pena» a «Dueño del Destino».
- **Club VIP**: XP (1 por crédito apostado), rango, bono diario, rescates por leyenda y tapetes de lujo que sobreviven al reinicio. Ahora tiene 6 rangos:

| Rango | XP | Bono diario | Rescate VIP | Rescates por leyenda |
|---|---|---|---|---|
| Bronce | 0 | 100 | 500 | 1 |
| Plata | 5.000 | 250 | 750 | 2 |
| Oro | 25.000 | 500 | 1.000 | 3 |
| Platino | 100.000 | 1.000 | 1.500 | 4 |
| Diamante | 400.000 | 2.500 | 2.500 | 5 |
| **El Padrino** | 1.500.000 | 5.000 | 4.000 | 6 |

- **Salvavidas**: sin créditos se abre un diálogo con el bono diario, los rescates VIP y los favores del Sindicato. Solo cuando no queda ninguno llega el Game Over.
- **Tensión**: jugadas críticas con latido y viñeta roja, bitácora del crupier, expediente con el Salón de la Fama y música lounge/jazz por zona.

`npm run simulate` juega 600 leyendas completas con el núcleo real de la campaña y el motor real de las slots, incluidos los comodines fijos entre giros:

| Estilo | Libertad | Game Over | Rondas hasta la libertad (mediana / p90) |
|---|---|---|---|
| Prudente (apuesta mínima) | 100 % | 0 % | 545 / 966 |
| Moderado (3 % del saldo) | 100 % | 0 % | 618 / 1.449 |
| Temerario (10 % del saldo) | 82 % | 12 % | 927 / 2.810 |

El 6 % restante de las leyendas temerarias seguía en juego al llegar al tope de 6.000 rondas.

## Slots Matrix 4×4 (ambos modos)

- **10 líneas** (4 filas, 4 columnas y 2 diagonales): 3 o 4 iguales desde la primera celda. Con 4 idénticos se cobra el **Súper Bono ×15**; si un comodín completa el cuarteto, ×5.
- **Avalancha**: los símbolos ganadores explotan, el resto cae y entran nuevos en el mismo giro. Los combos sucesivos pagan **×1, ×2, ×3 y ×5**.
- **Comodín 🃏 pegajoso**: sustituye a los símbolos de pago (3 comodines pagan como la corona). Cuando forma parte de un premio **queda fijo 2 o 3 giros**, con un candado y un contador. En cada uno de esos giros actúa una vez y **multiplica ×2** cada línea que pasa por él (varios se multiplican entre sí, hasta ×8). Mientras haya comodines fijos, la apuesta queda bloqueada, para que no se pueda subir justo cuando valen más.
- **Estrella ⭐**: 3 o más al final del giro dan **8 giros gratis** con rodillos cargados de comodines.
- **Bonus Buy**: 8 giros gratis por **80 × apuesta**. En el Modo Historia se abre en el Salón de Neón.
- **Auto-Spin** con límite de pérdida obligatorio. El premio máximo es 5.000 × apuesta.

| Símbolo | Peso base | Peso en giros gratis | 3 en línea | 4 iguales |
|---|---|---|---|---|
| ⭐ Estrella (scatter) | 1,83 % | 1,44 % | 3+ → 8 giros gratis | |
| 🃏 Comodín | 0,41 % | 4,62 % | ×50 | ×750 |
| Corona Real | 5,88 % | 15,38 % | ×50 | ×750 |
| 7 de Oro | 8,92 % | 16,41 % | ×20 | ×300 |
| Campana | 12,98 % | 17,44 % | ×8 | ×120 |
| Herradura | 18,26 % | 16,41 % | ×4 | ×60 |
| Trébol | 22,31 % | 14,36 % | ×1 | ×15 |
| Cerezas | 29,41 % | 13,95 % | ×1 | ×15 |

Con la avalancha y los comodines pegajosos, las celdas dejan de ser independientes, así que el RTP se **mide** con el motor real (`npm run slots`):

| Medida | Valor |
|---|---|
| RTP total | **96,38 %** |
| Líneas del juego base | 67,53 % |
| Giros gratis | 28,84 % (1 de cada 268 tiradas, 77,3 × apuesta de media) |
| Compra de bono | **96,63 %** |
| Tiradas con premio | 39,46 % |
| Muestra | 3 millones de tiradas y 300.000 rondas de bono |

## Decisiones de diseño y desviaciones del enunciado

- **«El Último Crédito» como Modo Historia** (opción 1 elegida): la campaña queda intacta y convive con el Cripto-Casino desde el menú principal. Sus recompensas se fusionan con la carrera global: XP, rangos, cofres y fichas.
- **Plinko**: se mantienen los multiplicadores pedidos. Con caídas 50/50 darían otro RTP (el alto pasaría del 150 %), así que se usa un **sesgo hacia el centro publicado** que clava el 97,2 / 96,8 / 96,5 %.
- **Crash**: la fórmula `max(1,01; 0,97/(1−r))` permitiría ganar siempre retirándose en ×1,01. Por eso, por debajo de ×1,01 el cohete **explota al despegar** (3,96 %), y el RTP es del 97 % con cualquier retiro.
- **Video Póker**: pagos «por 1» (incluyen la apuesta), la convención estándar de las máquinas 9/6.
- **Dados**: la probabilidad llega hasta el 97 %: con 98 / P, un 98 % pagaría ×1 y ganar no daría nada.
- **Reliquias**: solo actúan en el Cripto-Casino, para que la dificultad de la historia no cambie. Las que alteran probabilidades son variantes de reglas publicadas, y sus sorteos (Dado, Batería) usan números verificables del flujo.
- **Abundancia**: con el Reloj de la Abundancia equipado, sus +50 se suman a los +50 base (y al extra del rango).
- **Rescate**: salta con el saldo por debajo de la ficha mínima (10) y sin nada en juego, no solo con 0 exacto.

## Arquitectura y seguridad

- **Máquina de estados de la app** (`js/app.js`): `boot → menu | story | free → leaving`. Cambiar de modo recarga la página, para que cada módulo arranque con el monedero y los datos de su modo. `app.js` también lleva el router de pestañas, el temporizador de la abundancia y el turbo.
- **EventBus** (`js/event_bus.js`): las mesas avisan de `round:start` y `round:end`. La progresión, las misiones, las reliquias y la telemetría escuchan sin depender unas de otras. El bus también transporta `reward:chest`, `reward:chips`, `rescue`, `abundance` y `app:state`.
- **Sesión** (`js/session.js`): es la única puerta entre las mesas y el modo. Da los límites, el azar de cada jugada (el flujo provably fair en el Cripto-Casino, `crypto.getRandomValues()` en la historia) y el registro verificable.
- **State Store unidireccional** por mesa, con estado inmutable y fases atómicas `IDLE → BETTING → DEALING → RESOLVING → PAYOUT`.
- **Anti doble gasto**: `hold` pasa las fichas del saldo al escrow de la mesa, `settle` las liquida en cuanto se decide el azar y `reveal` acredita el premio al terminar la animación. Las bolas simultáneas de Plinko revelan cada una su parte. Recargar nunca anula un resultado ya sorteado.
- **Almacenamiento reactivo** (`js/storage.js`): `localStorage` con respaldo en memoria, suscripciones por clave (también entre pestañas), migraciones numeradas y copias de seguridad JSON validadas.
- **Seguridad**: una Content-Security-Policy estricta (`script-src 'self'; style-src 'self'`, sin nada en línea). El DOM dinámico se crea solo con `createElement` y `textContent`, nunca con `innerHTML`. Las importaciones se validan antes de escribir.

## Rendimiento

Medido con Chrome, pantalla de móvil y la CPU ralentizada ×4: tiempo del hilo principal ocupado por segundo.

| Escenario | ms/s |
|---|---|
| Menú con la lluvia Matrix | 6 |
| Cripto-Casino en reposo: blackjack · Plinko · Crash · Rueda | 12–28 |
| Slots en reposo | 57–66 |
| Crash con el cohete en vuelo | ≈ 525 |
| Plinko, ráfaga de 5 bolas | ≈ 600 |

- **Lluvia Matrix en un Web Worker** con OffscreenCanvas, a 15 fps y media resolución. Dibujarla en el hilo principal obligaba a producir fotogramas y recalcular estilos, y costaba unos 95 ms/s en reposo; en el worker se queda en 3. Si el navegador no admite OffscreenCanvas, se dibuja en el hilo principal con el mismo pintor.
- **Canvas con sprites cacheados**: el tablero, las cubetas y la bola de Plinko se pintan una vez; los emojis del cohete se rasterizan una sola vez; las partículas usan un pool fijo de arrays tipados, sin basura para el recolector.
- **Animaciones solo en el compositor**: todas las animaciones infinitas mueven solo `opacity` y `transform`, y una prueba lo vigila.
- **Carga**: 56 módulos precargados en paralelo con `modulepreload` (lista generada con `npm run preload` y comprobada por las pruebas). Son unos 220 KB comprimidos y la app está lista en ≈ 2,7 s con una red de 1,6 Mbps y 150 ms de latencia.

## Accesibilidad y responsive

- Pestañas con roles ARIA y navegación por teclado (flechas, Inicio y Fin), diálogos nativos `<dialog>`, regiones `aria-live` para los resultados y etiquetas en cada casilla, losa, carta y control.
- En móvil, la cabecera del Cripto-Casino se compacta en tres filas (marca con menú, saldo y carrera, reliquias e iconos) y deja de ser fija. Las 10 pestañas se desplazan en horizontal. A 390 px no hay desplazamiento horizontal en ninguna mesa.
- Respeta `prefers-reduced-motion`: sin lluvia, menos partículas y animaciones mínimas.

## Probar, verificar y publicar

Los módulos ES no se cargan desde `file://`, así que hay que servir la carpeta por HTTP:

```bash
python -m http.server 8080      # o: npx serve .   → http://localhost:8080
npm test                        # 85 pruebas (Node 20+, sin dependencias)
npm run slots                   # mide el RTP de las slots con el motor real
npm run simulate                # 600 leyendas completas del Modo Historia
npm run preload                 # regenera la lista de módulos precargados de index.html
```

Las pruebas cubren:

- SHA-256 y HMAC comparados con `node:crypto`;
- el flujo provably fair y el verificador de cada juego;
- el RTP exacto de los juegos nuevos y el Monte Carlo de las slots;
- la progresión, las misiones, las reliquias y los cofres;
- la terminal, el almacenamiento con sus migraciones y copias de seguridad;
- la campaña, el sonido y el sitio: precarga, CSP, identificadores del DOM y animaciones baratas.

**Publicar en GitHub Pages**: sube el repositorio con `index.html` en la raíz y, en **Settings → Pages**, elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`. El archivo `.nojekyll` evita el procesado de Jekyll.

## Estructura

```
index.html                    Menú principal, armazón de ambos modos, 10 mesas, diálogos, sprite SVG y CSP
css/main.css                  Variables, layout, cabecera, pestañas y pantalla de arranque
css/themes.css                5 temas: Matrix Green, Cyberpunk Neon, Onyx, Gold Imperial y Blood Red
css/cyber.css                 Menú, HUD del Cripto-Casino, telemetría, bóveda, carrera y verificador
css/arcade.css                Plinko, Crash, Minas, Dados, Torres, Video Póker, Rueda y control de apuesta
css/hacker_terminal.css       Terminal: fósforo, cursor y scanlines
css/animations.css            Trauma, glitch, cofres, reliquias, textos flotantes y ajustes del turbo
css/tables.css                Blackjack, ruleta y slots (comodines pegajosos)
css/components.css            Botones, fichas, cartas 3D, modales y Club VIP
css/story.css                 Zonas, neón, bitácora, cinemáticas y jugadas críticas del Modo Historia
js/app.js                     Máquina de estados, router de pestañas, abundancia y turbo
js/event_bus.js               Bus de eventos (pub/sub)
js/mode.js                    Modo activo y claves de guardado por modo
js/session.js                 Límites, azar por modo, registro verificable y fondo de rescate
js/provably_fair.js           SHA-256/HMAC en JS puro, semillas, nonce, flujo e historial
js/verify.js                  Verificador independiente de las jugadas de los 10 juegos
js/progression.js             XP, niveles 1–50, 6 rangos VIP y 10 misiones diarias
js/relics.js                  10 reliquias, 4 ranuras, cofres, pociones y bonificaciones
js/terminal.js                Intérprete de órdenes de la terminal (sin DOM)
js/settings.js                Turbo, tema, lluvia y scanlines
js/storage.js                 Persistencia reactiva, migraciones y copias de seguridad JSON
js/audio.js                   Efectos procedurales y buses de música y efectos
js/particles.js               Partículas con pool fijo y sprites cacheados
js/engine/                    RNG criptográfico, Store, monedero con escrow, Club VIP y música lounge
js/story/                     Campaña, zonas, encargos, logros, títulos y narrativa
js/ui/                        HUD, menú, HUD cyber, telemetría, terminal, bóveda, lluvia (worker), SVG y utilidades
js/games/*-math.js            Matemáticas puras de Plinko, Crash, Minas, Dados, Torres, Video Póker y Rueda
js/games/slots-engine.js      Motor de las slots v4: líneas, avalancha, comodines pegajosos y giros gratis
js/games/*.js                 Las 10 mesas (blackjack, roulette, slots, plinko, crash, mines, dice, towers, video_poker, wheel)
tests/                        85 pruebas con node:test
tools/                        Medición del RTP de las slots, simulación de la historia y precarga
```
