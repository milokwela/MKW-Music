// Поиск по ссылке: вставьте ссылку на трек (YouTube, Spotify, SoundCloud, Apple Music) — найдём его без лишних запросов.
export const looksLikeUrl = (s) => /^https?:\/\/\S+$/i.test(String(s).trim());

function ytId(u) {
  const x = new URL(u);
  if (x.hostname === 'youtu.be') return x.pathname.slice(1, 12);
  if (/(^|\.)youtube\.com$/.test(x.hostname)) {
    if (x.searchParams.get('v')) return x.searchParams.get('v').slice(0, 11);
    const m = x.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    if (m) return m[2];
  }
  return null;
}

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Возвращает { track } (играть сразу) или { query } (искать по названию) или { error }.
export async function resolveLink(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return { error: 'Это не ссылка' }; }
  const host = u.hostname.replace(/^www\./, '');
  try {
    const id = ytId(raw.trim());
    if (id) {
      const o = await json(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
      return { track: {
        id: `yt_${id}`, ytId: id, title: o.title, artist: String(o.author_name || '').replace(/ - Topic$/, ''),
        album: '', artwork: o.thumbnail_url || '', previewUrl: '', duration: 0, genre: '',
      } };
    }
    if (host === 'open.spotify.com') {
      const o = await json(`https://open.spotify.com/oembed?url=${encodeURIComponent(raw.trim())}`);
      return { query: o.title };
    }
    if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
      const o = await json(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(raw.trim())}`);
      return { query: String(o.title || '').replace(/\s+by\s+/i, ' ') };
    }
    if (host === 'music.apple.com') {
      const tid = u.searchParams.get('i') || u.pathname.split('/').pop();
      if (/^\d+$/.test(tid)) {
        const d = await json(`https://itunes.apple.com/lookup?id=${tid}`);
        const r = d.results?.[0];
        if (r) return { query: `${r.artistName} ${r.trackName || r.collectionName}` };
      }
    }
    if (host.endsWith('yandex.ru') || host.endsWith('yandex.com') || host === 'vk.com' || host.endsWith('zvuk.com')) {
      return { error: 'Из ссылки этого сервиса название прочитать нельзя. Введите название трека' };
    }
  } catch (e) {
    return { error: 'Не получилось открыть ссылку. Проверьте её или введите название' };
  }
  return { error: 'Такую ссылку пока не умею. Работают YouTube, Spotify, SoundCloud, Apple Music' };
}
