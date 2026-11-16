// Где искать музыку. Выбор источника убран (1.6): поиск сам берёт лучшее из каталога и YouTube.
export const SOURCE_MODES = [{ id: 'all', name: 'Везде' }];
export function getSourceMode() { return 'all'; }
export function setSourceMode() { /* выбора больше нет */ }
