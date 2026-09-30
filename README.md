# El Último Crédito · Casino Royale Deluxe

**▶ Jugar ahora:** https://pepenandosanchezcortes2012-hash.github.io/casino-royale-deluxe/

Neo-Madrid, 2089. Despiertas en el sótano de un casino clandestino con **un único crédito**. El Sindicato que controla las mesas te ofrece un trato: reúne **100.000 créditos** y comprarás tu libertad. Si pierdes el último, tu leyenda termina ahí.

**El Último Crédito** es un RPG narrativo de supervivencia de casino con estética noir/cyberpunk, construido sobre los tres juegos de Casino Royale Deluxe:

- **Blackjack multimano** (Las Vegas Strip, 6 barajas) con Perfect Pairs, 21+3, coach de estrategia básica y entrenador de conteo Hi-Lo.
- **Ruleta francesa** con racetrack (Voisins, Tiers, Orphelins, Jeu Zéro y vecinos) y zoom balístico.
- **Slots Matrix 4×4** con avalanchas ×1 → ×5, giros gratis con multiplicadores dorados, Bonus Buy y Auto-Spin.

Tres zonas que se abren según tu saldo, encargos del Sindicato, logros, títulos dinámicos, un **Club VIP** con rangos, bono diario, rescates y tapetes de lujo que se conservan entre partidas, jugadas críticas con latido de corazón, una bitácora donde los crupieres reaccionan a tu suerte, música de fondo lounge/jazz procedural y dos finales: la libertad o el Game Over definitivo.

Es **100 % estático** (HTML5, CSS3 y módulos ES, sin frameworks, dependencias ni recursos externos). El azar sale de `crypto.getRandomValues()`, la música y los efectos se sintetizan con Web Audio API (sin voces ni archivos de audio) y todos los gráficos son SVG o Canvas.

> Ficción de entretenimiento: créditos virtuales sin valor monetario.

## Publicar en GitHub Pages (2 pasos)

1. **Sube el proyecto** a un repositorio de GitHub (con `index.html` en la raíz):
   ```bash
   git init && git add . && git commit -m "El Último Crédito"
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

Pruebas y simulación (Node 20+, sin dependencias):

```bash
npm test             # 48 pruebas: RNG, reglas, RTP, campaña, Club VIP, sonido y sitio
npm run simulate     # 600 leyendas completas con el núcleo real de la campaña (tabla de equilibrio)
```

## La historia

1. **Prólogo**: la primera visita abre una cinemática con lluvia y texto a máquina de escribir. Se puede saltar y releer desde el Expediente.
2. **Leyenda nº N**: cada partida es una leyenda numerada que empieza con **exactamente 1 crédito**, 3 favores del Sindicato, los rescates de tu rango VIP y el título «Rata del Callejón». El bono diario del Club VIP se puede cobrar en cualquier momento.
3. **Ascenso**: tu saldo abre las puertas de las zonas superiores. Cada zona cambia las mesas, las fichas, el crupier, la música y la iluminación.
4. **Final**: con 100.000 créditos compras tu libertad («Dueño del Destino»). Sin créditos ni favores llega el Game Over definitivo.

La leyenda se guarda en `localStorage`: recargar la reanuda donde estaba, incluido un final ya alcanzado.

## Las tres zonas

| | Nivel 1 · El Callejón | Nivel 2 · El Salón de Neón | Nivel 3 · El Penthouse |
|---|---|---|---|
| Acceso | Desde el inicio | 250 créditos | 5.000 créditos |
| Expulsión por debajo de | — | 100 | 2.500 |
| Crupier | Moss, crupier del sótano | Vera, crupier del Salón | SIBILA, la IA del Sindicato |
| Fichas | 1 · 5 · 10 | 5 · 10 · 25 · 100 · 500 | 100 · 500 · 1K · 5K · 10K |
| Blackjack | 1 asiento, apuesta 1–10, sin laterales | 3 asientos, 5–500, laterales hasta 100 | 3 asientos, 100–25.000, laterales hasta 5.000 |
| Ruleta | 10 por casilla y 50 por mesa, sin racetrack | 500 por casilla y 5.000 por mesa, con racetrack | 25.000 por casilla y 100.000 por mesa |
| Slots | Apuesta 1–10, sin Bonus Buy | 10–500, con Bonus Buy | 500–10.000, con Bonus Buy |
| Ambiente | Bombilla que parpadea, lluvia, piano y trompeta con sordina (re menor, 58 BPM) | Neón rosa y cian, contrabajo walking, escobillas y vibráfono (do menor, 74 BPM) | Oro y cristal, pedal grave, reloj y escáner rojo de SIBILA (la menor, 64 BPM) |

- **Viajar**: se hace desde las puertas de la barra de zonas, solo con las mesas en reposo (sin apuestas en juego ni giros gratis pendientes), y va acompañado de una transición a pantalla completa.
- **Histéresis**: se entra con el umbral de acceso, pero solo te expulsan si caes por debajo del umbral de permanencia. Así, una mala mano justo al llegar no te devuelve al sótano. La degradación es automática y la narra el Sindicato.
- En el Callejón las funciones avanzadas se ven bloqueadas con su zona de desbloqueo: los asientos 2 y 3 («Reservado · Salón de Neón»), las apuestas laterales, el racetrack y el Bonus Buy.

## Encargos del Sindicato: el motor del progreso

Las mesas conservan su ventaja de la casa real: blackjack ≈ 0,5 %, ruleta 2,70 % y slots ≈ 3,7 %. Con juegos de esperanza nula o negativa, el **teorema de parada opcional** limita la probabilidad de convertir 1 crédito en 100.000 a **1 entre 100.000 como mucho**, sea cual sea la estrategia. Por eso el progreso viene del Sindicato:

- Un tablero con **3 encargos simultáneos** por zona; al cumplir uno llega otro distinto.
- Solo cuentan las rondas con **ganancia neta** (los empates y las pérdidas no suman).
- La recompensa es la base × el factor de la zona (**×2** Callejón, **×30** Salón, **×600** Penthouse). La base es ≈ 0,6 × las rondas que se tarda de media en cumplirlo, medidas con los motores reales, de modo que premia el esfuerzo sin eliminar el riesgo.

| Encargo | Base | Callejón | Salón | Penthouse |
|---|---|---|---|---|
| Gana 3 rondas en cualquier mesa | 4 | 8 | 120 | 2.400 |
| Gana 2 rondas de blackjack | 3 | 6 | 90 | 1.800 |
| Gana 2 giros de ruleta | 3 | 6 | 90 | 1.800 |
| Gana 3 tiradas en las slots | 13 | 26 | 390 | 7.800 |
| Cobra 2 suertes sencillas (rojo, par, 1-18…) | 3 | 6 | 90 | 1.800 |
| Cobra una docena o una columna | 2 | 4 | 60 | 1.200 |
| Acierta un pleno en la ruleta | 22 | 44 | 660 | 13.200 |
| Consigue un Blackjack natural | 13 | 26 | 390 | 7.800 |
| Gana una mano de blackjack doblada | 11 | 22 | 330 | 6.600 |
| Gana una mano de blackjack dividida | 48 | 96 | 1.440 | 28.800 |
| Encadena 3 victorias seguidas | 9 | 18 | 270 | 5.400 |
| Consigue 2 avalanchas en un solo giro | 8 | 16 | 240 | 4.800 |
| Gana 10 veces lo apostado en una sola ronda | 22 | 44 | 660 | 13.200 |
| Activa los giros gratis de las slots | 165 | 330 | 4.950 | 99.000 |
| Cobra un Perfect Pairs o un 21+3 | 4 | — | 120 | 2.400 |
| Cobra una apuesta anunciada del racetrack | 2 | — | 60 | 1.200 |

### Equilibrio simulado

`npm run simulate` juega 200 leyendas completas por estilo con el núcleo real de la campaña y del Club VIP, y con el motor real de las slots. La ruleta es exacta y el blackjack usa la distribución de resultados de la estrategia básica.

Cada leyenda simulada es **la primera de un jugador nuevo** (rango Bronce). Ese jugador:
- cobra el bono diario al empezar;
- persigue el encargo más rápido y sube de zona en cuanto puede;
- al arruinarse, usa primero el rescate VIP y después los favores.

Las semillas son fijas, así que los resultados se reproducen exactamente.

| Estilo | Victoria | Game Over | Llega al Penthouse | Rondas hasta la libertad (mediana / p90) | Rescates VIP usados | Favores usados |
|---|---|---|---|---|---|---|
| Prudente (apuesta mínima) | 100 % | 0 % | 100 % | 625 / 1.186 | 0,01 | 0 |
| Moderado (3 % del saldo) | 99,0 % | 0 % | 99,5 % | 707 / 1.811 | 0,13 | 0 |
| Temerario (10 % del saldo) | 68,5 % | 20,5 % | 85,0 % | 843 / 2.548 | 1,85 | 0,83 |

El resto de leyendas (1 % y 11 %) seguía en juego al llegar al tope de 6.000 rondas. Con los salvavidas del Club VIP, jugar con cabeza siempre acaba en libertad. Ir a por todo todavía se paga: una de cada cinco leyendas temerarias termina en Game Over.

## Logros y títulos

Cada logro se desbloquea una vez por leyenda y el Sindicato paga su recompensa.

| Logro | Condición | Recompensa |
|---|---|---|
| Primer Crédito | Gana tu primera ronda | 2 |
| Desde el Fondo | Gana una ronda apostando todo tu saldo | 5 |
| Natural | Consigue un Blackjack natural | 5 |
| Pleno al Número | Acierta un pleno en la ruleta | 10 |
| Avalancha | Encadena 3 avalanchas en un solo giro | 10 |
| Súper Bono | Alinea 4 símbolos iguales en las slots | 15 |
| Lluvia Dorada | Activa los giros gratis | 40 |
| Mano Caliente | Gana 5 rondas seguidas | 25 |
| Nervios de Acero | Gana justo después de perder 5 rondas seguidas | 15 |
| Todo o Nada | Gana una jugada crítica | 20 |
| Estratega | 25 decisiones con el coach y un 90 % de acierto | 30 |
| Apuesta Paralela | Cobra un Perfect Pairs o un 21+3 | 50 |
| Apuesta Anunciada | Cobra una apuesta del racetrack | 50 |
| Luces de Neón | Entra en el Salón de Neón | 100 |
| Aire Enrarecido | Entra en el Penthouse | 1.000 |
| Tiburón | Alcanza 25.000 créditos | 2.500 |
| Dueño del Destino | Compra tu libertad | — |

Los **títulos** siguen a tu saldo, hacia arriba y hacia abajo, y cada cambio se narra en la bitácora:

| Saldo | Título |
|---|---|
| 0 | Alma en Pena |
| 1 | Rata del Callejón |
| 10 | Buscavidas |
| 100 | Tahúr de Barrio |
| 500 | Lobo de Neón |
| 5.000 | High-Roller |
| 25.000 | Tiburón del Sindicato |
| 100.000 | Dueño del Destino |

## Club VIP

El Club VIP es tu carrera en el casino: el XP, el rango, los tapetes comprados y el bono diario **se conservan aunque la leyenda termine**, así que cada partida nueva empieza con más ayuda. Se abre con el botón del rango en la cabecera, que muestra un aviso «Bono» cuando el bono diario está disponible.

- **XP**: 1 por cada crédito apostado en cualquier mesa. Cada ascenso se celebra con fanfarria, confeti y una entrada en la bitácora.
- **Bono diario**: una vez por día natural (se renueva a medianoche), en cualquier momento de la leyenda.
- **Rescates VIP**: cuando te quedas sin créditos; su número por leyenda depende del rango.
- **Tapetes de lujo**: se compran con créditos de la leyenda y quedan en el Club para siempre. Sustituyen al tapete de la zona hasta que vuelvas a elegir «Tapete de la zona».

| Rango | XP | Bono diario | Rescate VIP | Rescates por leyenda |
|---|---|---|---|---|
| Bronce | 0 | 100 | 500 | 1 |
| Plata | 5.000 | 250 | 750 | 2 |
| Oro | 25.000 | 500 | 1.000 | 3 |
| Platino | 100.000 | 1.000 | 1.500 | 4 |
| Diamante | 400.000 | 2.500 | 2.500 | 5 |

| Tapete | Precio |
|---|---|
| Tapete de la zona (verde, violeta u ónix según la zona) | Incluido |
| Verde Esmeralda | Incluido |
| Azul Zafiro | 1.000 |
| Rojo Carmesí | 2.500 |
| Negro Ónix | 5.000 |

## Salvavidas, Game Over y gran final

- **Salvavidas**: si tu saldo cae por debajo de 1 crédito con las mesas en reposo, se abre el diálogo «Sin créditos» (y la cabecera muestra «Pedir ayuda») con todas las ayudas que te quedan:
  - el **bono diario** del Club VIP, si no lo has cobrado hoy;
  - los **rescates VIP** de tu rango;
  - los **favores del Sindicato**: 3 por leyenda, de 5, 50 o 500 créditos según la zona más alta que hayas pisado.
- **Game Over definitivo**: sin créditos y sin ningún salvavidas, el juego se detiene. Aparece una cinemática roja con las estadísticas y un único botón, **Reiniciar la Leyenda**, que borra la leyenda y conserva el Salón de la Fama y el Club VIP. La cinemática no se cierra con Esc y reaparece al recargar.
- **Gran final**: al llegar a 100.000 créditos con las mesas en reposo, el juego se detiene, cae una tormenta de partículas doradas y suena una fanfarria. La cinemática final te corona **«Dueño del Destino»** con las estadísticas de la leyenda.

## Tensión y atmósfera

- **Jugadas críticas**: apostarlo todo, o arriesgar al menos la mitad de tu bankroll (apuesta ÷ (saldo + apuesta) ≥ 50 %) con 10 apuestas mínimas o más en juego. Así el drama no se repite en cada apuesta pequeña cuando vas justo de saldo. La pantalla se cierra con una viñeta roja, suenan un latido y un riser, la música de fondo se aparta para dejar sitio al latido. El resultado estalla en un impacto dorado o en un golpe grave con destello rojo.
- **Bitácora del Crupier**: es un panel lateral (en móvil va al final, con un teletipo sobre la mesa). En él Moss, Vera, SIBILA, el Sindicato y el Narrador reaccionan a premios grandes, pérdidas duras, rachas de 3, 5, 7, 10, 15 y 20, títulos, logros, encargos, favores y cambios de zona. Guarda las últimas 60 entradas.
- **Expediente**: reúne las estadísticas de la leyenda, los logros y el Salón de la Fama (leyendas jugadas, victorias, mejor tiempo y mejor saldo). Desde aquí se relee el prólogo y se reinicia la leyenda con doble confirmación.
- **CSS atmosférico**: cada zona redefine su paleta con variables CSS. Hay un letrero de neón con parpadeo; en el Callejón, bombilla temblorosa y lluvia; en el Salón, un neón que respira; en el Penthouse, un barrido dorado y el escáner de SIBILA. Todo respeta `prefers-reduced-motion`.

## Música de fondo y efectos

El juego no usa ninguna voz: no hay síntesis de voz ni locuciones, solo música y efectos generados con Web Audio API.

- **Música de fondo lounge / jazz nocturno** (`js/engine/music.js`), pensada para sonar de fondo sin cansar:
  - **Piano eléctrico tipo Rhodes**: tres senos por nota (fundamental, octava que se apaga antes y una «púa» aguda muy breve), un paso bajo cálido a 2,1 kHz y un trémolo estéreo lento.
  - **Armonía**: acordes de jazz (maj9, m9, m11, 13, 9sus…) en voicings cerrados sin fundamental, con conducción de voces mínima entre acordes (menos de 3 semitonos por voz de media) y un arpegio humano de pocos milisegundos.
  - **Contrabajo** suave a dos tiempos (fundamental y quinta) con aproximaciones cromáticas ocasionales.
  - **Escobillas, platillo y bombo apenas rozado**, hechos con ruido blanco filtrado y un swing ligero.
  - **Tempo pausado** de 65 a 75 BPM. Cada zona tiene su tonalidad y su progresión de 8 compases: Callejón en re menor a 66 BPM, Salón en mi bemol a 72, Penthouse en la bemol a 68, Final en re bemol a 70 y Game Over en mi menor a 65.
  - **Mezcla de fondo**: unos 15–20 dB por debajo de fichas y cartas, con reverb de sala pequeña y un recorte suave de agudos. En las jugadas críticas la música se aparta para que se oiga el latido.
  - **Fundidos**: 3 s de entrada al encenderla y 1,6 s de salida al pausarla, en línea recta en decibelios. También se detiene con la pestaña oculta.
- **Efectos de juego** (`js/engine/audio.js`): reparto y barajeo de cartas, choque de fichas, bola y rueda de la ruleta, rodillos, avalanchas y campanas de premio, además de los efectos dramáticos (latido, riser, impacto, fanfarria).
- **Controles independientes en la cabecera**: «🎵 Música: ON/OFF» y «🔊 Efectos: ON/OFF». Cada uno se guarda en su propia clave de `localStorage` (`crd.bgm.v1` y `crd.sfx.v1`); los ajustes del panel de sonido antiguo se migran solos.
- **Tensión (0–1)**: abre el filtro y el volumen del drone. Por encima de 0,4 añade pulsos de contrabajo, por encima de 0,55 dobla el tic-tac del reloj y por encima de 0,6 mete golpes graves.
- **Efectos dramáticos sintetizados**: latido, riser, sting, impacto, doom, fanfarria, whoosh de transición, zumbido de neón y teclas de máquina de escribir.

## Blackjack multimano (Las Vegas Strip)

| Regla | Valor |
|---|---|
| Asientos | Hasta 3 (según la zona), con decisiones independientes por mano |
| Zapato | 6 barajas (312 cartas), Fisher-Yates, carta de corte al 75 % |
| Blackjack natural | Paga 3 a 2 |
| Crupier | Pide con 16 o menos, se planta con todos los 17 (S17) y revisa Blackjack (peek) |
| Seguro | Se ofrece asiento por asiento con As visible; cuesta media apuesta y paga 2 a 1 |
| Doblar / Dividir | Doblar con dos cartas (también tras dividir); dividir hasta 4 manos por asiento; ases divididos reciben una carta |
| Límites | Según la zona: ver la tabla de zonas |

**Apuestas laterales** (se resuelven con las dos primeras cartas y la carta visible del crupier). La ventaja de la casa es **exacta**, calculada enumerando el zapato completo con multiplicidades. Las pruebas también reproducen los valores publicados para 8 barajas: 4,10 % y 3,70 %.

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
- **Entrenador Hi-Lo**: etiqueta cada carta (2–6 = +1, 7–9 = 0, 10–As = −1) y muestra Running Count, True Count (RC ÷ mazos restantes) y mazos restantes. La carta oculta del crupier no cuenta hasta que se descubre. Con True Count ≥ +3 el coach recomienda el seguro.

## Ruleta Francesa

- 37 casillas en el orden físico real del plato europeo.
- Tapete con plenos, divididas, calles, cuadros, docenas, columnas y suertes sencillas, además de **divididas y tríos con el cero** (0/1, 0/2, 0/3, 0/1/2, 0/2/3).
- **Racetrack** (desde el Salón de Neón) con los números en el orden del plato:

| Apuesta anunciada | Fichas | Números | Reparto |
|---|---|---|---|
| Voisins du Zéro | 9 | 17 | 2 en trío 0/2/3, 4/7, 12/15, 18/21, 19/22, 2 en cuadro 25/29, 32/35 |
| Tiers du Cylindre | 6 | 12 | 5/8, 10/11, 13/16, 23/24, 27/30, 33/36 |
| Orphelins | 5 | 8 | pleno 1, 6/9, 14/17, 17/20, 31/34 |
| Jeu Zéro | 4 | 7 | 0/3, 12/15, pleno 26, 32/35 |
| Vecinos | 3, 5 o 7 | 3, 5 o 7 | pleno al número y ±1, ±2 o ±3 casillas del plato |

- **Todas** las apuestas, simples o anunciadas, tienen la misma ventaja de la casa: `1 − 36/37 = 2,7027 %` (verificado para cada casilla del tapete y cada apuesta anunciada).
- **Zoom balístico**: el número se sortea antes de lanzar la bola y la física se resuelve en forma cerrada (desaceleración en la pista más un oscilador amortiguado entre los trastes). Cuando la bola entra en la fase final, una cámara suavizada acerca el plato ×1,9 al sector donde cae, la sigue en los rebotes y se aleja tras mostrar el número. El rotor se renderiza a doble resolución para que el zoom sea nítido.
- Acciones rápidas: **Deshacer**, **Limpiar**, **Repetir**, **Repetir ×2** y **Doblar**.

## Slots Matrix 4×4 con avalancha

- 10 líneas (4 filas, 4 columnas y 2 diagonales): 3 o 4 iguales desde la primera celda (4 = **Súper Bono ×15**).
- **Avalancha**: los símbolos ganadores explotan, el resto cae y entran símbolos nuevos en el mismo giro. Cada combo sucesivo aplica **×1, ×2, ×3 y ×5** (se mantiene en ×5).
- **Giros gratis**: 10 (3 diamantes), 12 (4) o 15 (5+), con rodillos premium y un **multiplicador dorado** en cada giro (×2 40 %, ×3 25 %, ×5 18 %, ×10 10 %, ×25 5 %, ×50 1,5 %, ×100 0,5 %). 3+ diamantes durante el bono suman +5 giros.
- **Bonus Buy** (desde el Salón de Neón): 10 giros gratis por 100 × apuesta, con confirmación.
- **Auto-Spin**: 10–100 tiradas con **límite de pérdida obligatorio**, límite por premio y parada opcional al activarse el bono. Se detiene al cambiar de mesa o de pestaña y cuando la leyenda termina.
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

Los premios de línea se pagan sobre la apuesta de línea (apuesta ÷ 10). Con la avalancha las celdas dejan de ser independientes entre combos, así que el RTP se **mide** con el motor real y con reducción de varianza: líneas y scatter se miden directamente, y los giros gratis como frecuencia de activación × valor medio de la ronda.

| Componente | RTP |
|---|---|
| Líneas con avalancha | 60,02 % |
| Scatter | 0,95 % |
| Giros gratis | 35,33 % |
| **Total juego base** | **96,29 % (± 0,1)** |
| **Compra de bono** | **96,25 % (± 0,14)** |

Muestra: 60 millones de tiradas del juego base y 4,5 millones de rondas de bono. Frecuencia de premio 37,5 %; giros gratis 1 de cada 276 tiradas. Las pruebas vuelven a simular el motor con un PRNG con semilla y comprueban ambos valores.

## Arquitectura y seguridad

- **Núcleo de campaña sin DOM**: `js/story/campaign.js` es un `EventTarget`. Recibe de cada mesa el aviso previo de la ronda (`beginRound`) y su informe final (`report`), y emite eventos (`round`, `critical`, `zone`, `achievement`, `contract`, `title`, `favor`, `status`…). `js/ui/story-ui.js` los convierte en cinemáticas, bitácora y sonido, así que toda la lógica de la historia se prueba en Node.
- **State Store unidireccional**: cada mesa tiene un `Store` con estado inmutable (`deepFreeze`) y fases atómicas `IDLE → BETTING → DEALING → RESOLVING → PAYOUT`; una transición ilegal lanza un error.
- **Anti doble gasto**: al apostar, las fichas pasan del saldo a un **escrow** por mesa (`hold`). Se liquidan en cuanto se decide el azar (`settle`) y el premio se acredita al terminar la animación (`reveal`). Los controles se desactivan con el flag `busy`. «En juego» muestra solo lo apostado, sin revelar el resultado antes de tiempo.
- **Recargar no hace trampa**: el resultado se liquida antes de animarse. Al recargar se abonan los premios pendientes, se devuelven las apuestas de ruleta aún no sorteadas, la mano de blackjack se **reanuda** y los giros gratis pendientes se conservan. Los finales se comprueban solo con las mesas en reposo.
- **Protección XSS**: todo el DOM dinámico se crea con `createElement`/`createElementNS` y `textContent`; no se usa `innerHTML`. Una Content-Security-Policy bloquea scripts y estilos en línea.
- **Monedero**: 1 crédito inicial y denominaciones de 1 a 10.000, con persistencia en `localStorage`. Fuera de las mesas, solo el Sindicato (logros, encargos y favores) y el Club VIP (bono diario y rescates) ingresan créditos, y solo los tapetes de lujo los gastan.
- **Club VIP** (`js/engine/vip.js`): su estado (XP, tapetes, bono diario y rescates usados en la leyenda actual) vive en su propia clave de `localStorage`, que «Reiniciar la Leyenda» no borra. La campaña decide cuándo se puede usar cada ayuda.

## Accesibilidad y responsive

- Pestañas con roles ARIA y navegación con flechas, Inicio y Fin; regiones `aria-live` para mensajes, coach, resultados y bitácora; diálogos nativos `<dialog>`.
- Áreas de toque mínimas de 44×44 px en botones, fichas, círculos de apuesta, puertas de zona y controles. Las apuestas de borde del tapete, de 26 px, están sobre las líneas como en una mesa real.
- A partir de 1.180 px la bitácora ocupa una columna lateral; en móvil pasa al final de la página y un teletipo muestra la última entrada sobre la mesa. A 390 px de ancho no hay desplazamiento horizontal: el tapete y el racetrack se desplazan dentro de su contenedor.
- Respeta `prefers-reduced-motion`: sin zoom de cámara, menos partículas y animaciones reducidas al mínimo.

## Rendimiento

El juego está afinado para móviles de gama media. Las medidas se hicieron con Chrome, pantalla de móvil y la CPU ralentizada ×4, y cuentan el tiempo del hilo principal ocupado por cada segundo:

| Escenario | Antes | Ahora |
|---|---|---|
| Blackjack en reposo (Callejón) | 789 ms/s | 11 ms/s |
| Slots en reposo | 428 ms/s | 11 ms/s |
| Penthouse en reposo | 903 ms/s | 34 ms/s |
| Ruleta en reposo | 601–815 ms/s | 106–112 ms/s |
| Tirada de slots | 607 ms/s | 356 ms/s |
| Giro de ruleta | 726 ms/s | 380 ms/s |

- **Animaciones solo en el compositor**: los brillos que laten (aros de apuesta, botones, puertas, orbe dorado, celdas ganadoras, veladura crítica) se pintan una vez en un pseudo-elemento y solo se anima su opacidad. El neón parpadea con opacidad, el barrido dorado del Penthouse usa `transform` y las bombillas de las slots se encienden con una capa superpuesta. Así nada repinta la página en cada fotograma, y una prueba (`tests/site.test.js`) impide que vuelva a colarse una animación infinita que lo haga.
- **Puertas de zona**: el aviso de zona recién abierta se apaga al entrar en ella. Antes seguía latiendo durante toda la partida.
- **Rueda de ruleta**: gira a pleno ritmo solo durante el lanzamiento, el zoom y la frenada. En reposo se dibuja a unos 20 fotogramas por segundo, y nada si queda fuera de la pantalla.
- **Carga**: `index.html` precarga los 26 módulos con `<link rel="modulepreload">`, así que el navegador los pide todos a la vez en lugar de descubrirlos en 4 viajes de red encadenados. La misma prueba comprueba que la lista está completa.
- **Jugadas críticas** sin filtros de color sobre toda la pantalla.

## Estructura

```
index.html                  Estructura semántica, sprite SVG, cinemáticas, expediente, bitácora y CSP
css/main.css                Variables, layout con bitácora lateral, cabecera, HUD y pestañas
css/tables.css              Mesa multimano, racetrack, rueda y gabinete de slots con avalancha
css/components.css          Botones, fichas, cartas 3D, modales y controles de sonido
css/story.css               Paletas por zona, neón, ambiente, puertas, bitácora, cinemáticas y jugadas críticas
js/app.js                   Inicializador maestro, pestañas accesibles, desbloqueo y pausa del audio
js/story/zones.js           Las tres zonas: accesos, fichas, límites por mesa y crupier
js/story/campaign.js        Núcleo de la leyenda: rondas, jugadas críticas, zonas, favores y finales
js/story/contracts.js       Encargos del Sindicato (tablero de 3 y recompensas por esfuerzo)
js/story/achievements.js    Los 17 logros y sus recompensas
js/story/titles.js          Títulos dinámicos según el saldo
js/story/narrative.js       Prólogo, finales y frases de Moss, Vera, SIBILA, el Sindicato y el Narrador
js/engine/rng.js            Entropía criptográfica, Fisher-Yates, muestreo ponderado y probabilidad
js/engine/store.js          State Store unidireccional y máquina de estados atómica
js/engine/wallet.js         Monedero con escrow anti doble gasto, ingresos (Sindicato y Club VIP) y compras
js/engine/vip.js            Club VIP: XP, rangos, bono diario, rescates por leyenda y tapetes
js/engine/storage.js        Persistencia en localStorage tolerante a fallos
js/engine/audio.js          Efectos sintetizados, buses de música y efectos, preferencias independientes
js/engine/music.js          Música de fondo lounge/jazz procedural: Rhodes, contrabajo y escobillas
js/engine/particles.js      Confeti, chispas y lluvia de oro en Canvas
js/ui/svg.js                Cartas (índices jumbo), fichas y símbolos generados con createElementNS
js/ui/hud.js                Saldo, racks de fichas por zona, interruptores de música y efectos, avisos
js/ui/story-ui.js           Cinemáticas, transiciones de zona, bitácora, encargos, salvavidas, expediente y jugadas críticas
js/ui/vip-ui.js             Botón y diálogo del Club VIP: rango, bono diario, rescates y tienda de tapetes
js/ui/input.js              Clic derecho o pulsación larga para retirar fichas
js/games/blackjack-rules.js Reglas puras: liquidación, Perfect Pairs, 21+3, estrategia básica y Hi-Lo
js/games/blackjack.js       Mesa multimano: asientos por zona, seguro por asiento, coach, conteo y reanudación
js/games/roulette.js        Plato con zoom balístico, tapete, racetrack y apuestas anunciadas
js/games/slots-engine.js    Motor matemático: líneas, avalancha, giros gratis y multiplicador dorado
js/games/slots.js           Rodillos, animación de avalancha, Bonus Buy y Auto-Spin
tests/math.test.js          22 pruebas de RNG, reglas, ventajas exactas, RTP y economía
tests/story.test.js         16 pruebas de zonas, encargos, logros, jugadas críticas, Club VIP, salvavidas y finales
tests/audio.test.js         6 pruebas de sonido: preferencias, migración, mezcla, tempo y armonía
tests/site.test.js          4 pruebas del sitio: precarga de módulos, sin voz, CSP y animaciones baratas
tools/simulate-economy.mjs  Simulación de leyendas completas (tabla de equilibrio)
```
