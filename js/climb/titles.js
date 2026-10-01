// Títulos dinámicos de la escalada: cambian con el saldo, hacia arriba y hacia abajo.

export const TITLES = Object.freeze([
  Object.freeze({ min: 0, name: 'Alma en Pena' }),
  Object.freeze({ min: 1, name: 'Rata del Subsuelo' }),
  Object.freeze({ min: 100, name: 'Buscavidas' }),
  Object.freeze({ min: 1000, name: 'Tahúr de Barrio' }),
  Object.freeze({ min: 10_000, name: 'Lobo de Neón' }),
  Object.freeze({ min: 50_000, name: 'Cazador Arcade' }),
  Object.freeze({ min: 100_000, name: 'Ahijado del Padrino' }),
  Object.freeze({ min: 500_000, name: 'Capo del Salón' }),
  Object.freeze({ min: 1_000_000, name: 'Millonario del Olimpo' }),
  Object.freeze({ min: 5_000_000, name: 'Señor de los Rascacielos' }),
  Object.freeze({ min: 10_000_000, name: 'Dueño Absoluto del Sindicato' }),
]);

export function titleIndexFor(balance) {
  let index = 0;
  TITLES.forEach((title, i) => {
    if (balance >= title.min) index = i;
  });
  return index;
}

export const titleFor = (balance) => TITLES[titleIndexFor(balance)];
