// Рингтон звонка — любая песня: в меню трека «Поставить на звонок».
// Играет 30-секундный фрагмент (iTunes) по кругу, пока звонят. Нет фрагмента — обычные гудки.
import { searchTracks } from './catalog.js?v=0.29.0';
import { toast } from './ui.js?v=0.29.0';

const KEY = 'mkw.ringtone';
export function getRingtone() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
export function clearRingtone() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } toast('Рингтон: обычные гудки'); }

const okUrl = (u) => /^https:\/\//.test(String(u || ''));
export async function setRingtone(track) {
  if (!track) return;
  let url = okUrl(track.previewUrl) ? track.previewUrl : '';
  if (!url) {
    // у трека из YouTube нет фрагмента — ищем такой же в iTunes
    try {
      const found = await searchTracks(`${track.artist} ${track.title}`);
      const t = found.find((x) => okUrl(x.previewUrl) && x.title.toLowerCase().includes(String(track.title).toLowerCase().slice(0, 12))) || found.find((x) => okUrl(x.previewUrl));
      if (t) url = t.previewUrl;
    } catch { /* ignore */ }
  }
  if (!url) { toast('У этой песни нет фрагмента для звонка — выберите другую'); return; }
  try { localStorage.setItem(KEY, JSON.stringify({ title: track.title, artist: track.artist, url })); } catch { /* ignore */ }
  toast(`Рингтон: ${track.artist} — ${track.title}`);
  // проба 3 секунды
  try { const a = new Audio(url); a.volume = 0.8; await a.play(); setTimeout(() => a.pause(), 3000); } catch { /* ignore */ }
}
