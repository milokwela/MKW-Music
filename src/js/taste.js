// Вкусы: заблокированные исполнители и дизлайкнутые треки (хранятся на устройстве).
const AK = 'mkw.blockedartists';
const TK = 'mkw.dislikes';
export const norm = (s) => String(s || '').trim().toLowerCase();
function read(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } }
function write(k, s) { try { localStorage.setItem(k, JSON.stringify([...s].slice(-400))); } catch { /* ignore */ } }

export const blockedArtists = () => read(AK);
export const isArtistBlocked = (name) => read(AK).has(norm(name));
export function blockArtist(name) { const s = read(AK); s.add(norm(name)); write(AK, s); }
export function unblockArtist(name) { const s = read(AK); s.delete(norm(name)); write(AK, s); }
export const dislikedTracks = () => read(TK);
export function dislikeTrack(id) { const s = read(TK); s.add(id); write(TK, s); }

// «A & B, C feat. D» → ['A','B','C','D']
export function splitArtists(str) {
  return [...new Set(String(str || '').split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\/)\s*/i).map((s) => s.trim()).filter(Boolean))].slice(0, 4);
}
