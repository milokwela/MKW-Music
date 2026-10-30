// Где искать музыку: везде / только iTunes / только YouTube / только Audius.
const KEY = 'mkw.srcmode';
export const SOURCE_MODES = [
  { id: 'all', name: 'Везде' },
  { id: 'itunes', name: 'iTunes' },
  { id: 'youtube', name: 'YouTube' },
  { id: 'audius', name: 'Audius' },
];
export function getSourceMode() {
  try { const v = localStorage.getItem(KEY); return SOURCE_MODES.some((m) => m.id === v) ? v : 'all'; } catch { return 'all'; }
}
export function setSourceMode(id) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }
