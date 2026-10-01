# Casino Royale Deluxe · The Syndicate Climb & Cyber-Fish Casino

**▶ Jugar ahora:** https://pepenandosanchezcortes2012-hash.github.io/casino-royale-deluxe/

Neo-Madrid, 2089. Despiertas en un callejón con **10 créditos** en tu monedero cripto. Sobre ti se alza la torre del Sindicato: cuatro pisos de mesas, cada uno más alto, más caro y más peligroso. Reúne **10.000.000 de créditos** para comprar tu libertad y tomar el control del Sindicato.

Es un juego **100 % estático** para GitHub Pages: HTML5 semántico, CSS3 y módulos ES nativos, sin frameworks, dependencias, CDN ni archivos de audio. Cada resultado sale de `HMAC-SHA256` con semillas comprometidas y se puede verificar a mano (*provably fair*). La música y los efectos chiptune se sintetizan con Web Audio API, sin voces. La interfaz es **pixel art** con una fuente propia y los gráficos son SVG y Canvas 2D.

> Ficción de entretenimiento: créditos virtuales sin valor monetario, para mayores de 18 años.

## Índice

- [La escalada](#la-escalada)
- [Los 4 pisos del Sindicato](#los-4-pisos-del-sindicato)
- [Cyber-Fish Hunter](#cyber-fish-hunter)
- [Los 11 juegos](#los-11-juegos)
- [Economía de la torre](#economía-de-la-torre)
- [Provably fair: cómo verificar una jugada](#provably-fair-cómo-verificar-una-jugada)
- [Pixel art y sonido](#pixel-art-y-sonido)
- [Terminal hacker](#terminal-hacker)
- [Persistencia](#persistencia)
- [Decisiones de diseño](#decisiones-de-diseño)
- [Arquitectura y seguridad](#arquitectura-y-seguridad)
- [Rendimiento](#rendimiento)
- [Accesibilidad y móvil](#accesibilidad-y-móvil)
- [Probar, verificar y publicar](#probar-verificar-y-publicar)
- [Estructura](#estructura)

## La escalada

1. **Prólogo**: una cinemática con lluvia y texto a máquina de escribir (se puede saltar y releer desde el Expediente).
2. **Subsuelo con 10 créditos**: empiezas en el Piso 1 con apuestas de 1 a 50.
3. **Tarjetas de acceso**: al reunir 10.000, 100.000 y 1.000.000 de créditos consigues la tarjeta del piso siguiente. Una tarjeta animada te ofrece subir. La tarjeta es **permanente**: aunque pierdas el saldo, podrás volver a ese piso.
4. **Selector de pisos**: los botones 1–4 de la cabecera llevan el ascensor a cualquier piso desbloqueado, siempre que no haya apuestas en juego. Cada piso cambia los límites de las mesas, las fichas, el anfitrión, la música y el ambiente.
5. **Limosna**: si tu saldo llega a 0 sin nada en juego, el botón 🪙 te da **+10 créditos**. Después hay que esperar **5 minutos** (cuenta atrás en el botón) para la siguiente.
6. **Victoria**: al llegar a **10.000.000** se abre el epílogo. Escribes tu alias, reclamas el trono y te proclamas **Dueño Absoluto del Sindicato**. Puedes seguir jugando como Dueño o empezar otra escalada.

La cabecera muestra el piso actual con su rango de apuestas, el selector de pisos, la **barra hacia los 10M**, los créditos, lo que hay en juego, tu título y récord, la carrera (nivel, rango y misiones), las 4 reliquias y los botones de turbo, terminal, música y efectos. La barra hacia la meta tiene un cuarto por piso y avanza de forma logarítmica: de 10 a 10.000 en el Subsuelo y ×10 en cada piso siguiente.

A la derecha (debajo, en móvil), un panel con dos pestañas:

- **Sindicato**: la bitácora, que narran los anfitriones (Moss, Vera, Ferro y SIBILA), y los **3 encargos** del piso.
- **Telemetría**: semillas, nonce, RTP real, apuestas en vivo y verificador.

## Los 4 pisos del Sindicato

| | Piso 1 · El Subsuelo Clandestino | Piso 2 · La Bahía Arcade & Casino Neón | Piso 3 · El Salón VIP del Padrino | Piso 4 · El Penthouse Cripto-Olympus |
|---|---|---|---|---|
| Ambiente | Neón parpadeante, tuberías, mesas ilegales | Sala arcade futurista | Alfombras carmesí, mármol oscuro, camareros androides | Rascacielos, mesas de oro |
| Tarjeta de acceso | Desde el inicio | 10.000 créditos | 100.000 | 1.000.000 |
| Apuestas | 1 – 50 | 50 – 1.000 | 1.000 – 25.000 | Desde 10.000, **sin límite** |
| Abre | Minas, Dados, Torres | **Cyber-Fish Hunter**, Plinko, Slots | Crash, Ruleta Europea, Video Póker | Blackjack High-Roller, Rueda de la Fortuna Legendaria |
| Fichas | 1 · 5 · 10 · 25 · 50 | 50 · 100 · 250 · 500 · 1K | 1K · 2,5K · 5K · 10K · 25K | 10K · 25K · 100K · 500K · 1M |
| Anfitrión | Moss, crupier del subsuelo | Vera, jefa de sala | Ferro, mayordomo androide del Padrino | SIBILA, IA soberana del Sindicato |
| Tema automático | Matrix | Neón | Sangre | Oro |
| Escala económica | 0,1 | 1 | 10 | 100 |

Las mesas de los pisos inferiores siguen disponibles en los superiores, con los límites del piso en el que estás. Las de pisos superiores aparecen en las pestañas con un candado y el piso en que se abren. Si tu saldo no llega a la apuesta mínima del piso, un aviso te ofrece bajar al piso que puedes pagar.

Con el tema **automático** (por defecto), los colores siguen al piso. Desde la terminal puedes fijar cualquiera de los 5 temas.

## Cyber-Fish Hunter

Un acuario en Canvas 2D con un cañón abajo que apunta al **cursor o al dedo**. Cada clic o toque dispara una bala; si mantienes pulsado, dispara seguido.

- **Coste por bala** según el piso: 50 · 100 · 250 · 500 · 1.000 en la Bahía, 1.000–25.000 en el Salón y 10.000–250.000 en el Olimpo.
- **🔁 Auto-disparo**: dispara solo (4 balas por segundo) mientras te llegue el saldo.
- **🎯 Auto-apuntar**: el cañón sigue a la criatura más valiosa de la sala y anticipa su movimiento.
- Las balas rebotan en las paredes y en la superficie. Si no tocan nada en 6 s, se devuelven.

| Criatura | Premio | Captura por impacto |
|---|---|---|
| Pez Neón | ×1,5 · ×2 · ×2,5 · ×3 | 64 % – 32 % |
| Medusa Eléctrica | ×8 | 12 % |
| Manta Raya Cibernética | ×20 | 4,8 % |
| Tiburón Martillo Blindado | ×60 | 1,6 % |
| **Mega Kraken** (aparece cada 75 s y patrulla 40 s) | ×150 – ×500 | 0,64 % – 0,19 % |

**Matemática.** Cada bala es una apuesta con **su propio nonce provably fair**. Su número r se compromete al disparar. Al impactar en una criatura de multiplicador m, la bala la captura si **r < 0,96 / m**. La probabilidad de captura es, por tanto, inversamente proporcional al premio, y **P(captura) · m = 0,96: el RTP es del 96 % apuntes a donde apuntes**. La resistencia de las criaturas grandes es visual; cada impacto es un sorteo independiente, así que el Kraken necesita de media m / 0,96 impactos. Al capturar, la criatura estalla en partículas y un número flotante muestra el premio, que se suma al saldo en el acto.

**Rondas.** Las balas disparadas en una ventana de 2,5 s (como mucho 20) forman una ronda. Esa ronda cuenta para encargos, misiones, XP, reliquias y estadísticas.

**Rendimiento.** Peces, balas, partículas, burbujas y números flotantes salen de **pools de tamaño fijo**: el bucle no crea objetos. Los sprites de las criaturas, de la bala y del cañón se pintan una vez, y el fondo está en su propio lienzo. El bucle `requestAnimationFrame` solo corre con la mesa visible y la pestaña activa; al cambiar de mesa o de pestaña se para y **las balas en vuelo se devuelven** (su número sigue oculto, así que devolverlas no revela nada).

## Los 11 juegos

| Juego | Piso | Reglas | RTP |
|---|---|---|---|
| **Minas 5×5** | 1 | 1–24 minas; tras k gemas, ×0,97 · C(25, k) / C(25 − m, k); retírate cuando quieras | 97 % |
| **Dados Over/Under** | 1 | Tirada de 0,00 a 99,99; probabilidad 1–97 %; multiplicador 98 / P | 98 % |
| **La Torre de la Muerte** | 1 | 8 pisos (Fácil 3 losas y 1 trampa · Media 2 y 1 · Difícil 3 y 2); ×0,97 / p^n | 97 % |
| **Cyber-Fish Hunter** | 2 | Ver arriba | 96 % |
| **Plinko** | 2 | 9 filas, 9 cubetas, bola suelta o ráfaga de 5; sesgo publicado hacia el centro | Bajo 97,20 % · Medio 96,80 % · Alto 96,50 % |
| **Slots Matrix 4×4** | 2 | 10 líneas, avalancha ×1 → ×2 → ×3 → ×5, comodín pegajoso que multiplica ×2, 8 giros gratis con 3 estrellas, Bonus Buy a 80× | 96,38 % (compra 96,63 %) |
| **Crash Rocket** | 3 | M(t) = 1 + 0,06 · t^1,35; E = 0,97 / (1 − r); por debajo de ×1,01 explota al despegar | 97 % con cualquier retiro |
| **Ruleta Europea** | 3 | Un solo cero, tapete completo y racetrack francés (Voisins, Tiers, Orphelins, Jeu Zéro, vecinos) | 97,30 % |
| **Video Póker Jacks or Better 9/6** | 3 | Pagos «por 1»; escalera real 800 con 5 monedas | 99,54 % con estrategia óptima |
| **Blackjack High-Roller** | 4 | 6 barajas, 3:2, S17, 3 asientos, Perfect Pairs y 21+3, coach de estrategia básica y entrenador Hi-Lo | ≈ 99,6 % · PP 93,89 % · 21+3 95,38 % |
| **Rueda de la Fortuna Legendaria** | 4 | Una tirada gratis cada 24 h: 20.000 a 300.000 créditos, bote de 1.000.000 (1 %), Poción ×2 y cofre legendario | ≈ 55.500 créditos de media |

Minas, Torres, Video Póker y Blackjack guardan la jugada a medias y la reanudan tras recargar, con la apuesta retenida. Crash resuelve un vuelo interrumpido como lo haría el servidor: solo cobra el retiro automático si el cohete llegaba a él.

## Economía de la torre

Las mesas son justas: todas conservan su ventaja de la casa. Multiplicar 10 créditos por 1.000.000 solo con juegos de esperanza negativa es casi imposible. Por el teorema de parada opcional, P(éxito) ≤ saldo inicial / meta. El progreso viene del **Sindicato** y de tu **carrera**.

### Encargos del Sindicato

Hay **3 encargos a la vez por piso**. Al cumplir uno se cobra al instante y llega otro de distinto tipo. La recompensa es una base × el factor del piso: **×8, ×80, ×800 y ×8.000**. La base es ≈ 0,6 × las rondas que cuesta cumplirlo por la vía más rápida: un premio de ×M sale, como mucho, con probabilidad RTP / M en cualquier mesa. Solo cuentan los premios de **×2 o más**, así que una apuesta casi segura no avanza ningún encargo. Las mesas recién abiertas en un piso tienen el doble de peso al sortearse.

| Encargo (ejemplos) | Base | Subsuelo | Bahía | Salón | Olimpo |
|---|---|---|---|---|---|
| Gana 3 rondas con premio de ×2 o más | 4 | 32 | 320 | 3.200 | 32.000 |
| Encadena 3 victorias seguidas de ×2 o más | 9 | 72 | 720 | 7.200 | 72.000 |
| Consigue un premio de ×25 o más | 15 | 120 | 1.200 | 12.000 | 120.000 |
| Corona la Torre de la Muerte | 15 | 120 | 1.200 | 12.000 | 120.000 |
| Derrota al Mega Kraken | 40 | — | 3.200 | 32.000 | 320.000 |
| Activa los giros gratis de las slots | 161 | — | 12.880 | 128.800 | 1.288.000 |

Hay 24 tipos en total: los generales (×2, ×3, ×5, ×10 y ×25, y la racha) y los de cada mesa (francotirador de dados, minas, torre, medusas, tiburón, Kraken, Plinko ×10, avalanchas, giros gratis, Crash ×3, pleno, docenas, racetrack, trío de póker, natural, doblada, dividida y apuestas laterales).

### Carrera: niveles, rangos y misiones

- **XP por ronda** = (apuesta × 0,25 + premio × 0,5) ÷ la escala de tu piso más alto, y × 2 con el Pase del Padrino. Así, subir de nivel cuesta lo mismo en todos los pisos.
- **Niveles 1–50** (100 · n^1,6 XP de un nivel al siguiente). Cada nivel paga 100 × nivel × escala créditos. Cada 5 niveles da un cofre común y cada rango (Plata 10, Oro 20, Platino 30, Diamante 40, El Padrino 50), uno legendario.
- **10 misiones diarias según tu piso más alto**: 4 generales (40 rondas, apostar 5.000 × escala, 15 victorias, un ×10) y 6 de las mesas de tu piso, empezando por las recién abiertas. Pagan en la escala del piso. Solo cuentan las apuestas de al menos la mínima de tu piso más alto. Completar todas da un cofre común y 1.000 × escala.
- **Abundancia**: cada minuto con la pestaña visible y al menos una ronda con esa apuesta mínima, (50 + extra del rango + Reloj de la Abundancia) × escala.
- **Hitos**: un cofre común con la tarjeta del Piso 2, uno legendario con la del 3 y otro con la del 4 (una vez), y uno legendario por cada victoria.
- **24 logros** con recompensa en créditos (de 5 a 250.000) y **11 títulos** que siguen al saldo, de «Alma en Pena» a «Dueño Absoluto del Sindicato».

### Reliquias

Hay 10 reliquias en la **Bóveda**, con 4 ranuras. Los cofres garantizan una reliquia que aún no tienes y se compran a 2.500 (común) y 15.000 (legendario) × la escala de tu piso más alto. Se han **reequilibrado para la escalada**: ninguna convierte una mesa en una apuesta ganadora a largo plazo, y las que pagan créditos tienen un **tope por ronda en apuestas mínimas del piso**, para que no se disparen con las apuestas sin límite del Olimpo.

| Reliquia | Efecto |
|---|---|
| 🍀 Trébol de Oro | Pesos del juego base duplicados y +1 a la estrella (+2,8 % de estrellas): RTP medido **98,11 %** |
| 🎲 Dado de Montecarlo | Si el crupier pide con 15 o 16 duros, un número verificable decide (10 %) si recibe el siguiente 10 del zapato |
| 🛡️ Escudo | Devuelve la primera mano de blackjack perdida **de cada día** (tope 25 apuestas mínimas) |
| 👑 Corona de Midas | +20 % del premio neto (tope 10 apuestas mínimas por ronda) |
| 🧲 Imán de Cashback | 10 % de cada pérdida neta (tope 5 apuestas mínimas) |
| ⏳ Reloj de la Abundancia | +50 × escala en cada minuto de abundancia |
| 🔋 Batería Cuántica | Tras una tirada de slots sin premio, un 5 % de las veces vuelves a girar gratis |
| 💎 Zafiro de Plinko | Otro sesgo publicado hacia los extremos: +2,5 puntos de RTP (99,7 / 99,3 / 99,0 %) |
| 📡 Radar de Crash | Alarma visual al 80 % del punto de explosión |
| 🎟️ Pase del Padrino | Duplica la XP |

La **Poción ×2** duplica el premio neto de tu siguiente ronda ganadora (tope 25 apuestas mínimas).

### Calibración: `npm run simulate`

Simula escaladas completas con el núcleo real (encargos, logros, tarjetas, limosna), la carrera real (misiones y niveles) y el motor real de las slots. Usa un modelo de tiempo por mesa (dados 1,5 s, una bala 0,25 s, una ronda de ruleta 7 s…) y sesiones de 2 horas al día. Cada jugador persigue el encargo más barato con la mesa adecuada, sube al piso más alto que su saldo aguanta (40, 25 o 15 apuestas mínimas según el estilo) y pide limosna al quedarse a cero. Las reliquias no se simulan, así que el resultado es conservador.

| Estilo (150 escaladas cada uno) | Victoria | Horas de juego (mediana / p90) | Rondas (mediana) | Piso 1→2 · 2→3 · 3→4 · 4→meta | Pasó por la bancarrota |
|---|---|---|---|---|---|
| Prudente (apuesta mínima) | 100 % | 4,3 h / 10,5 h | 5.702 | 0,8 · 0,6 · 1,2 · 1,5 h | 15 % |
| Moderado (2 % del saldo) | 100 % | 4,6 h / 17,6 h | 6.362 | 0,4 · 0,4 · 1,0 · 1,5 h | 15 % |
| Temerario (8 % del saldo) | 67 % en 80 h | 23,3 h / 67 h | 48.312 | 0,4 · 0,8 · 5,9 · 11,6 h | 89 % (26 limosnas de media) |

Gestionar el riesgo compensa: el jugador prudente llega en una tarde larga, y el temerario cae una y otra vez al Subsuelo.

## Provably fair: cómo verificar una jugada

1. Antes de apostar, la telemetría publica **`hash = SHA-256(semilla del servidor)`**. La semilla son 32 bytes de `crypto.getRandomValues()` que siguen ocultos.
2. Tú eliges la **semilla del cliente** (en la telemetría o con `clientseed`). Cada jugada usa un **nonce** creciente.
3. El primer número de la jugada es:
   ```
   HMAC-SHA256(clave = semilla del servidor, mensaje = "semilla del cliente:nonce")
   → los 8 primeros caracteres hexadecimales como entero de 32 bits ÷ 2^32   ∈ [0, 1)
   ```
   Los juegos que necesitan más números siguen con los siguientes grupos de 8 caracteres. Agotado el hash, continúan con `"semilla del cliente:nonce:1"`, `:2`…
4. **Rotar** la semilla (o cambiar la del cliente) **revela** la anterior y compromete otra. Desde ese momento se puede recalcular cada jugada.

Cada apuesta aparece en **Apuestas en vivo** con su nonce. Al pulsarla se abre el **verificador**: comprueba el hash, recalcula el HMAC y reproduce el resultado completo con las mismas funciones de la mesa. La terminal hace lo mismo con `verify <nonce>`.

| Juego | Números del flujo | Parámetros del verificador |
|---|---|---|
| Ruleta | casilla = ⌊r · 37⌋ | — |
| Dados | tirada = ⌊r · 10 000⌋ / 100 | `{"chance":49,"direction":"under"}` |
| Crash | E = 0,97 / (1 − r), truncado | — |
| Minas y Torres | Fisher-Yates de casillas y losas | `{"mines":3}` · `{"difficulty":"easy"}` |
| Plinko | una decisión por fila | `{"risk":"low"}` |
| **Cyber-Fish** | **una bala por nonce: captura si r < 0,96 / m** | `{"species":"jelly","multiplier":8}` |
| Video Póker | Fisher-Yates de las 52 cartas | `{"holds":[…],"coins":5}` |
| Blackjack | un nonce por zapato de 312 cartas | — |
| Slots | cada símbolo y cada duración de bloqueo | — |
| Rueda Legendaria | gajo según los pesos publicados | — |

Es una **demostración del protocolo sin servidor**: la semilla oculta vive en tu navegador, así que alguien que lea `localStorage` podría conocerla antes de rotarla. Con créditos sin valor, solo se engañaría a sí mismo.

## Pixel art y sonido

**Dirección visual.**

- **Tipografía:** fuente pixel propia, «Syndicate Pixel» (`fonts/syndicate-pixel.woff`, 3,5 KB). Son glifos de 5 × 7 dibujados a mano con tildes, ñ, ü, ¿, ¡ y «». Se genera con `python tools/build-pixel-font.py` y se usa en títulos, cifras, etiquetas, pestañas y botones, siempre a 10, 20, 30 o 40 px para que cada píxel caiga en la rejilla (una prueba lo vigila). Los textos largos van en monoespaciada.
- **Formas:** esquinas rectas, bordes de 2 px y sombras duras en lugar de halos. Los botones se hunden 2 px al pulsarlos.
- **Detalles:** barras de estado segmentadas, cursor parpadeante en el piso actual, avisos que entran a saltos y fondo con tramado.
- **Paleta:** los acentos cyberpunk de los 5 temas se han rebajado de saturación.
- **Lienzos:** se pintan a 1 píxel por píxel CSS y el navegador los amplía con `image-rendering: pixelated`. Cyber-Fish se dibuja a media resolución, con sus etiquetas en la fuente pixel.

**Sonido.**

- **Volumen general y silencio:** el botón 🔊 y la tecla **M** silencian todo; el deslizador de la cabecera regula el volumen. Ambos se guardan.
- **Ajustes (⚙):** volumen, música, efectos y opciones de pantalla.
- **Capa chiptune** de onda cuadrada para la interfaz: clic, aviso (acción bloqueada o saldo insuficiente), recompensa (encargos y logros) y el arpegio del ascensor al cambiar de piso.

**Modo ligero** (Ajustes → Pantalla): se activa solo en equipos de 4 núcleos o menos, o con 4 GB de memoria o menos. Apaga la lluvia de código, las scanlines y el ambiente animado, y reduce las partículas a menos de la mitad.

## Terminal hacker

Se abre con **`~`** (o `º`/`` ` ``) o con el botón `>_`. Tiene historial con ↑/↓ y autocompletado con Tab.

| Orden | Qué hace |
|---|---|
| `floor [1-4]` (`piso`) | Pisos y tarjetas; con un número, toma el ascensor |
| `goal` (`meta`) | Progreso hacia los 10.000.000 y récord |
| `contracts` (`encargos`) | Encargos del piso |
| `alms` (`limosna`) | Pide la limosna o dice cuánto falta |
| `seeds` · `rotate` · `clientseed <texto>` | Semillas y nonce, revelar y cambiar |
| `verify <nonce>` · `history [n]` | Verificar una jugada y últimas apuestas |
| `rtp` | RTP de los 11 juegos |
| `relics` · `missions` · `level` · `balance` | Reliquias, misiones, nivel y saldo |
| `matrix` · `turbo` · `crt on\|off` | Lluvia de fondo, turbo y scanlines |
| `theme <auto\|matrix\|neon\|onyx\|gold\|blood>` | Tema (automático: el del piso) |
| `export` · `import` | Copia de seguridad JSON de toda la partida |

## Persistencia

Todo se guarda en `localStorage` con el prefijo `crd.climb.`:

- `crd.climb.v1`: estado de la escalada. Incluye el piso actual y el desbloqueado, el récord, el **enfriamiento de la limosna** (hora de la última), los encargos de cada piso, los logros, el título, las estadísticas, la bitácora y el Dueño.
- `crd.climb.wallet.v1`: el **saldo**, con el escrow de cada mesa.
- `crd.climb.hall.v1`: salón de la fama (escaladas, victorias, mejor tiempo, mayor fortuna y Dueños).
- Carrera, reliquias, semillas (las semillas se guardan al instante; el historial, con un pequeño retardo), ajustes, mesas a medias y preferencias de cada mesa.

**Empezar otra escalada** (desde el Expediente o el epílogo) borra la escalada, el monedero y las jugadas a medias. Conserva la carrera, las reliquias, las semillas y el salón de la fama. Las partidas de las versiones anteriores (`crd.*` y `crd.cyber.*`) se quedan donde estaban, sin mezclarse.

## Decisiones de diseño

- **El Cripto-Casino es ahora el juego entero**: el menú y el Modo Historia «El Último Crédito» se retiran. Siguen en el historial de git (v4.0.0, `56a8798`). Su motor narrativo (bitácora, encargos, logros, títulos, jugadas críticas, cinemáticas) se ha reutilizado y generalizado para la torre.
- **Pisos acumulativos y selector**: las mesas de los pisos inferiores siguen abiertas arriba, con los límites del piso actual. Las tarjetas de acceso no se pierden nunca.
- **«Sin límite de apuesta» en el Olimpo**: sin máximo, con una mínima de 10.000 para que el último piso sea de alto riesgo.
- **Fichas de Cyber-Fish por piso**: el ejemplo del enunciado (5–100 por bala) no encaja con el rango de la Bahía (50–1.000), así que las balas cuestan 50 · 100 · 250 · 500 · 1.000 allí y escalan en cada piso.
- **Economía escalada por piso** (encargos, misiones, niveles, abundancia, cofres y Rueda ×100) y calibrada con la simulación. Contra el abuso:
  - las misiones y la abundancia solo cuentan con la apuesta mínima del piso más alto;
  - la XP se normaliza por su escala;
  - los encargos solo cuentan premios de ×2 o más.
- **Reliquias reequilibradas**: en la v4 el Trébol daba un 124,75 % de RTP y la Batería y el Zafiro también hacían rentables sus mesas, lo que habría trivializado la meta. Ahora rondan el 98–99,7 %. Los efectos en créditos tienen topes por piso, el Escudo es diario (antes se reiniciaba recargando) y la poción duplica el neto con tope.
- **Limosna con saldo < 1** (la mínima del Subsuelo) y sin nada en juego, no solo con 0 exacto. Un reloj atrasado no alarga la espera más allá de 5 minutos.
- Se mantienen las decisiones de la v4: sesgo publicado de Plinko, explosión de Crash por debajo de ×1,01, video póker «por 1» y dados hasta el 97 %.

## Arquitectura y seguridad

- **Escalada** (`js/climb/`): pisos, núcleo de estados `intro → playing → victory`, encargos, logros, títulos y narrativa. No tiene DOM y se prueba aislada.
- **Sesión** (`js/session.js`): es la única puerta entre las mesas y la escalada. Da los límites del piso, el flujo provably fair de cada jugada y el registro verificable, y reparte cada ronda a la escalada y al **EventBus** (`round:end`), que escuchan la carrera, las reliquias y la telemetría.
- **Anti doble gasto**: `hold → settle → reveal` con escrow por mesa. Las balas de Cyber-Fish y las bolas de Plinko revelan cada una su parte. Recargar nunca anula un resultado ya sorteado. Además, **solo las mesas del piso actual pueden retener apuestas**.
- **Almacenamiento reactivo** con respaldo en memoria, migraciones y copias de seguridad JSON validadas.
- **Seguridad**: CSP estricta (`script-src 'self'; style-src 'self'`, nada en línea). El DOM dinámico se crea con `createElement` y `textContent`, nunca con `innerHTML`, y el alias del trono se limpia (sin caracteres de control ni `<>`, como mucho 24 caracteres).

## Rendimiento

- **Sin fugas**: los bucles `requestAnimationFrame` se cancelan al ocultar cada mesa y con la pestaña oculta, los temporizadores se limpian y los oyentes se registran una sola vez. En una auditoría con recolección de basura forzada (viajes entre pisos, las 11 mesas, auto-disparo y diálogos, varias veces), la memoria JS se queda en unos 3,5 MB y los nodos y oyentes del DOM solo crecen hasta llenar las listas acotadas (bitácora, apuestas en vivo, resultados recientes).
- **Lienzos 1:1 y pixelados**: hasta 4 veces menos píxeles en pantallas densas, también en el confeti a pantalla completa.

- **Cyber-Fish**: **60 fps** en reposo y en auto-disparo. Con la CPU ralentizada ×4 (un móvil modesto), 57 fps en reposo y 28 fps en auto-disparo. Al ocultar la mesa el bucle se detiene: el hilo principal baja a ≈ 15 ms/s a CPU ×4.
- **Repintados agrupados**: el monedero avisa a la interfaz una vez por fotograma (evento `update`), aunque una ráfaga de balas genere varios cambios. La telemetría pinta las apuestas en vivo por lotes cada 200 ms y el historial verificable se guarda con retardo.
- **Lluvia Matrix en un Web Worker** con OffscreenCanvas, a 15 fps y media resolución. Toma el color del tema del piso.
- **Animaciones solo en el compositor**: las animaciones infinitas (ambiente de cada piso incluido) mueven solo `opacity` y `transform`, y una prueba lo vigila.
- **Carga**: 56 módulos precargados en paralelo con `modulepreload` (lista generada con `npm run preload` y comprobada por las pruebas).

## Accesibilidad y móvil

- Pestañas con roles ARIA y flechas (que saltan las mesas bloqueadas), diálogos nativos, regiones `aria-live` (Cyber-Fish anuncia las capturas grandes y, como mucho, una pequeña cada 1,5 s) y etiquetas en cada control. El acuario se maneja también con el teclado: ← → giran el cañón y Espacio dispara.
- En móvil la cabecera se compacta en 4 filas: piso y selector con los créditos; meta y en juego; título y nivel; reliquias e iconos. La limosna, cuando aparece, ocupa una fila entera. A 390 px no hay desplazamiento horizontal y el acuario se dispara con toques.
- Respeta `prefers-reduced-motion`. El silencio y el volumen tienen etiqueta y estado accesibles (`aria-pressed`, `aria-valuetext`), y la tecla M silencia todo.

## Probar, verificar y publicar

Los módulos ES no se cargan desde `file://`, así que hay que servir la carpeta por HTTP:

```bash
python -m http.server 8080      # → http://localhost:8080
npm test                        # 94 pruebas (Node 20+, sin dependencias)
npm run simulate                # calibración de la escalada (150 escaladas por estilo)
npm run slots                   # RTP de las slots con el motor real (--clover para el Trébol)
npm run preload                 # regenera la precarga de módulos de index.html
```

Las pruebas cubren:

- la escalada: pisos, límites, tarjetas, limosna y enfriamiento, encargos, logros, victoria, trono y persistencia;
- Cyber-Fish: RTP con cualquier objetivo, Monte Carlo con balas provably fair, ráfagas y verificador;
- SHA-256 y HMAC frente a `node:crypto`;
- el RTP exacto de los juegos y el Monte Carlo de las slots;
- la carrera con las misiones por piso, las reliquias con sus topes, la terminal y el almacenamiento;
- el sitio: precarga, CSP, identificadores del DOM y animaciones baratas.

**Publicar en GitHub Pages**: rama `main`, carpeta `/ (root)` en **Settings → Pages**. El archivo `.nojekyll` evita el procesado de Jekyll.

## Estructura

```
index.html                    Armazón de la torre: HUD, 11 mesas, panel lateral, diálogos, sprite SVG y CSP
css/main.css · themes.css     Variables, layout, pestañas, arranque y los 5 temas
css/cyber.css · arcade.css    HUD cyber, telemetría, bóveda, verificador y mesas arcade
css/floors.css                Ambiente de cada piso, selector, meta, limosna, panel lateral, bitácora, tarjetas, epílogo
css/fish.css                  Cyber-Fish Hunter
css/pixel.css                 Dirección visual pixel art (se carga la última) y modo ligero
fonts/syndicate-pixel.woff    Fuente pixel propia (tools/build-pixel-font.py)
css/tables.css · components.css · hacker_terminal.css · animations.css
js/app.js                     Arranque, router de pestañas con candados, abundancia y ajustes
js/climb/                     Pisos, núcleo de la escalada, encargos, logros, títulos y narrativa
js/session.js                 Puerta única entre las mesas y la escalada
js/provably_fair.js · verify.js   SHA-256/HMAC, semillas, flujo, historial y verificador de los 11 juegos
js/progression.js · relics.js     Carrera (niveles, rangos, misiones por piso) y reliquias
js/terminal.js · settings.js · storage.js · audio.js · particles.js
js/engine/                    RNG criptográfico, Store, monedero con escrow y música lounge
js/ui/                        HUD, escalada, ajustes de sonido y pantalla, HUD cyber, telemetría, terminal, bóveda, lluvia (worker)
js/games/*-math.js            Matemáticas puras (incluida fish-math.js)
js/games/*.js                 Las 11 mesas
tests/                        94 pruebas con node:test
tools/                        Simulación de la escalada, medición de las slots y precarga
```
