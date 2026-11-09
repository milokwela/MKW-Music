// Deezer не отдаёт CORS-заголовки, поэтому берём JSONP (так браузер разрешает)
let jp = 0;
export function jsonp(url, ms = 7000) {
  return new Promise((resolve) => {
    const cb = `__mkwdz${Date.now()}${jp++}`;
    const s = document.createElement('script');
    const done = (v) => { clearTimeout(t); window[cb] = () => {}; s.remove(); resolve(v); };
    const t = setTimeout(() => done(null), ms);
    window[cb] = (d) => done(d);
    s.onerror = () => done(null);
    s.src = `${url}${url.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
    document.head.appendChild(s);
  });
}

