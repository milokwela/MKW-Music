// Каталог треков: iTunes Search API (бесплатно, без ключа, есть превью 30 сек).
import { ITUNES_COUNTRIES } from './config.js?v=0.10.2';

export function mapItunes(r) {
  return {
    id: String(r.trackId),
    title: r.trackName || '',
    artist: r.artistName || '',
    album: r.collectionName || '',
    artwork: r.artworkUrl100 || '',
    previewUrl: r.previewUrl || '',
    duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
    genre: r.primaryGenreName || '',
  };
}

export async function searchTracks(term, signal) {
  const q = String(term).trim();
  if (!q) return [];
  let lastError = null;
  for (const country of ITUNES_COUNTRIES) {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=30&country=${country}`;
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`iTunes ${res.status}`);
      const data = await res.json();
      const seen = new Set();
      const out = [];
      for (const r of data.results || []) {
        if (r.wrapperType && r.wrapperType !== 'track') continue;
        if (!r.trackId) continue;
        const t = mapItunes(r);
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        out.push(t);
      }
      if (out.length) return out;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  return [];
}
