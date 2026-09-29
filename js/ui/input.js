// Gestos compartidos de las mesas: clic secundario o pulsación larga para retirar fichas.

const LONG_PRESS_MS = 550;

export function bindRemoveGesture(container, selector, onRemove) {
  container.addEventListener('contextmenu', (event) => {
    const target = event.target.closest(selector);
    if (!target) return;
    event.preventDefault();
    onRemove(target);
  });

  let timer = 0;
  container.addEventListener('touchstart', (event) => {
    const target = event.target.closest(selector);
    if (!target) return;
    timer = setTimeout(() => {
      timer = 0;
      target.dataset.longpress = '1';
      onRemove(target);
    }, LONG_PRESS_MS);
  }, { passive: true });
  const cancel = () => clearTimeout(timer);
  container.addEventListener('touchend', cancel, { passive: true });
  container.addEventListener('touchmove', cancel, { passive: true });
  container.addEventListener('touchcancel', cancel, { passive: true });

  // El clic que sigue a una pulsación larga no debe volver a apostar.
  container.addEventListener('click', (event) => {
    const target = event.target.closest('[data-longpress]');
    if (!target) return;
    delete target.dataset.longpress;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, { capture: true });
}
