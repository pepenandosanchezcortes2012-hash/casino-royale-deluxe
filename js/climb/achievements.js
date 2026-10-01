// Logros de la escalada. Cada uno se desbloquea una sola vez por escalada y el Sindicato paga su
// recompensa en créditos (pensada para el piso donde suele conseguirse).

const item = (id, name, description, reward, floor = 1) => Object.freeze({ id, name, description, reward, floor });

export const ACHIEVEMENTS = Object.freeze([
  item('first-win', 'Primer Crédito', 'Gana tu primera ronda.', 5),
  item('all-in', 'Desde el Fondo', 'Gana una ronda apostando todo tu saldo.', 10),
  item('steel-nerves', 'Nervios de Acero', 'Gana justo después de perder 5 rondas seguidas.', 15),
  item('hot-hand', 'Mano Caliente', 'Encadena 5 victorias seguidas de ×2 o más.', 50),
  item('all-or-nothing', 'Todo o Nada', 'Gana una jugada crítica (la mitad o más de tu saldo).', 25),
  item('alms', 'Limosna', 'Pide tu primera limosna al Sindicato.', 0),
  item('comeback', 'Resurrección', 'Vuelve a reunir 1.000 créditos después de pedir limosna.', 100),
  item('sniper', 'Francotirador', 'Acierta una tirada de dados con un 2 % de probabilidad o menos.', 100),
  item('deminer', 'Artificiero', 'Retírate en Minas con ×10 o más.', 100),
  item('tower-top', 'Cima de la Torre', 'Corona la Torre de la Muerte.', 250),
  item('card-2', 'Tarjeta de Neón', 'Consigue la tarjeta de acceso a la Bahía Arcade (10.000 créditos).', 1000, 2),
  item('fish-shark', 'Cazador de Tiburones', 'Captura un Tiburón Martillo Blindado.', 2500, 2),
  item('fish-kraken', 'Leviatán', 'Derrota al Mega Kraken.', 10_000, 2),
  item('avalanche', 'Avalancha', 'Encadena 3 avalanchas en un solo giro de las slots.', 1000, 2),
  item('golden-rain', 'Lluvia Dorada', 'Activa los giros gratis de las slots.', 2000, 2),
  item('card-3', 'Invitación del Padrino', 'Entra en el círculo del Salón VIP (100.000 créditos).', 10_000, 3),
  item('moon', 'A la Luna', 'Retírate en Crash a ×20 o más.', 10_000, 3),
  item('straight', 'Pleno al Número', 'Acierta un pleno en la ruleta.', 10_000, 3),
  item('quads', 'Póker', 'Consigue un póker (cuatro iguales) o mejor en Video Póker.', 20_000, 3),
  item('card-4', 'Llave del Olimpo', 'Alcanza el Penthouse Cripto-Olympus (1.000.000 de créditos).', 100_000, 4),
  item('natural', 'Natural', 'Consigue un Blackjack natural en el Olimpo.', 25_000, 4),
  item('side-hustle', 'Apuesta Paralela', 'Cobra un Perfect Pairs o un 21+3.', 50_000, 4),
  item('skyline', 'Señor de los Rascacielos', 'Reúne 5.000.000 de créditos.', 250_000, 4),
  item('owner', 'Dueño Absoluto del Sindicato', 'Reúne 10.000.000 de créditos y toma el control del Sindicato.', 0, 4),
]);

export const achievementById = (id) => ACHIEVEMENTS.find((entry) => entry.id === id) ?? null;
