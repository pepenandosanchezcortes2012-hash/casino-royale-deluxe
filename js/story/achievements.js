// Logros de la leyenda. Cada uno se desbloquea una sola vez y el Sindicato paga su recompensa.

export const ACHIEVEMENTS = Object.freeze([
  Object.freeze({ id: 'first-win', name: 'Primer Crédito', description: 'Gana tu primera ronda.', reward: 2 }),
  Object.freeze({ id: 'all-in', name: 'Desde el Fondo', description: 'Gana una ronda apostando todo tu saldo.', reward: 5 }),
  Object.freeze({ id: 'natural', name: 'Natural', description: 'Consigue un Blackjack natural.', reward: 5 }),
  Object.freeze({ id: 'straight', name: 'Pleno al Número', description: 'Acierta un pleno en la ruleta.', reward: 10 }),
  Object.freeze({ id: 'avalanche', name: 'Avalancha', description: 'Encadena 3 avalanchas en un solo giro.', reward: 10 }),
  Object.freeze({ id: 'super-bonus', name: 'Súper Bono', description: 'Alinea 4 símbolos iguales en las slots.', reward: 15 }),
  Object.freeze({ id: 'golden-rain', name: 'Lluvia Dorada', description: 'Activa los giros gratis.', reward: 40 }),
  Object.freeze({ id: 'hot-hand', name: 'Mano Caliente', description: 'Gana 5 rondas seguidas.', reward: 25 }),
  Object.freeze({ id: 'steel-nerves', name: 'Nervios de Acero', description: 'Gana justo después de perder 5 rondas seguidas.', reward: 15 }),
  Object.freeze({ id: 'all-or-nothing', name: 'Todo o Nada', description: 'Gana una jugada crítica (la mitad o más de tu saldo).', reward: 20 }),
  Object.freeze({ id: 'strategist', name: 'Estratega', description: 'Toma 25 decisiones con el coach con un 90 % de acierto.', reward: 30 }),
  Object.freeze({ id: 'side-hustle', name: 'Apuesta Paralela', description: 'Cobra un Perfect Pairs o un 21+3.', reward: 50 }),
  Object.freeze({ id: 'announced', name: 'Apuesta Anunciada', description: 'Cobra una apuesta del racetrack francés.', reward: 50 }),
  Object.freeze({ id: 'neon-lights', name: 'Luces de Neón', description: 'Entra en el Salón de Neón.', reward: 100 }),
  Object.freeze({ id: 'thin-air', name: 'Aire Enrarecido', description: 'Entra en el Penthouse.', reward: 1000 }),
  Object.freeze({ id: 'shark', name: 'Tiburón', description: 'Alcanza 25.000 créditos.', reward: 2500 }),
  Object.freeze({ id: 'destiny', name: 'Dueño del Destino', description: 'Compra tu libertad con 100.000 créditos.', reward: 0 }),
]);

export const achievementById = (id) => ACHIEVEMENTS.find((item) => item.id === id);
