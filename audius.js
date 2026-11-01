// Audius: бесплатные полные треки без квоты YouTube. Играют через обычный аудио-элемент, поэтому работают и при выключенном экране.
import { AUDIUS_API_KEY } from './keys.js?v=0.17.0';

const BASE = 'https://api.audius.co/v1';
export const audiusEnabled = () => Boolean(AUDIUS_API_KEY);
const q = () => `app_name=MKW&api_key=${encodeURIComponent(AUDIUS_API_KEY)}`;
export const audiusStreamUrl = (id) => `${BASE}/tracks/${encodeURIComponent(id)}/stream?${q()}`;

export async function searchAudius(term, signal) {
  if (!AUDIUS_API_KEY) return [];
  const res = await fetch(`${BASE}/tracks/search?query=${encodeURIComponent(term)}&limit=12&${q()}`, { signal });
  if (!res.ok) throw new Error(`Audius ${res.status}`);
  const data = await res.json();
  return (data.data || []).filter((t) => t.id && t.is_streamable !== false).map((t) => ({
    id: `au_${t.id}`,
    auId: String(t.id),
    title: String(t.title || ''),
    artist: String(t.user?.name || t.user?.handle || ''),
    album: '',
    artwork: t.artwork?.['480x480'] || t.artwork?.['150x150'] || '',
    previewUrl: '',
    duration: Number(t.duration) || 0,
    genre: String(t.genre || ''),
    ytId: '',
    noYt: true,
  }));
}
