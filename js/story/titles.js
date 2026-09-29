// Títulos dinámicos: cambian con el saldo, hacia arriba y hacia abajo.

export const TITLES = Object.freeze([
  Object.freeze({ min: 0, name: 'Alma en Pena' }),
  Object.freeze({ min: 1, name: 'Rata del Callejón' }),
  Object.freeze({ min: 10, name: 'Buscavidas' }),
  Object.freeze({ min: 100, name: 'Tahúr de Barrio' }),
  Object.freeze({ min: 500, name: 'Lobo de Neón' }),
  Object.freeze({ min: 5000, name: 'High-Roller' }),
  Object.freeze({ min: 25000, name: 'Tiburón del Sindicato' }),
  Object.freeze({ min: 100000, name: 'Dueño del Destino' }),
]);

export function titleIndexFor(balance) {
  let index = 0;
  TITLES.forEach((title, i) => {
    if (balance >= title.min) index = i;
  });
  return index;
}

export const titleFor = (balance) => TITLES[titleIndexFor(balance)];
