// Офлайн-музыка: карточка в «Лайках», окно с настройками и списком скачанного, режим «нет интернета».
import { $, h, icon, openSheet, isSheetOpen, toast, trackRow } from './ui.js';
import * as store from './store.js';
import * as player from './player.js';
import { mi } from './icons2.js';
import { plural } from './utils.js';
import { offlineSupported, onOffline, offState, offSettings, setOffSettings, wanted, prog, syncOffline, stopSync,
  downloadedTracks, removeDownload, clearDownloads, isDownloaded } from './offline.js';

const mb = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} ГБ` : `${Math.max(0, Math.round(b / 1048576))} МБ`);

function counts() {
  const w = wanted();
  const got = w.filter((t) => isDownloaded(t.id)).length;
  return { w: w.length, got };
}

function statusText() {
  const s = offSettings(), c = counts();
  if (prog.running && prog.cur) return `Скачиваю «${prog.cur.title}» · ${prog.done + 1} из ${prog.total}`;
  if (prog.wait === 'ждём Wi-Fi') return 'Ждём Wi-Fi — на мобильном интернете не качаем';
  if (prog.wait === 'нет интернета') return 'Нет интернета — играет то, что уже скачано';
  if (!s.auto) return c.got ? `Скачано ${c.got} · автоскачивание выключено` : 'Включите — и лайки будут играть без интернета';
  if (c.w && c.got >= c.w) return 'Всё скачано — можно слушать без интернета';
  if (prog.fail) return `Скачано ${c.got} из ${c.w}. ${prog.fail} ${plural(prog.fail, 'трек', 'трека', 'треков')} не нашлось — попробую позже`;
  return `Скачано ${c.got} из ${c.w}`;
}

// карточка вверху «Лайков»
export function offlineCard() {
  if (!offlineSupported()) return null;
  const sub = h('small');
  const ring = h('span', { class: 'off-ring' }, mi('download'));
  const card = h('button', { type: 'button', class: 'off-card', onclick: openOffline }, ring,
    h('span', { class: 'off-txt' }, h('b', { text: 'Офлайн-музыка' }), sub), h('span', { class: 'chev', text: '›' }));
  const paint = () => {
    const c = counts(), k = c.w ? c.got / c.w : 0;
    sub.textContent = statusText();
    ring.style.setProperty('--k', String(k));
    card.classList.toggle('busy', prog.running);
    card.classList.toggle('full', offSettings().auto && c.w > 0 && c.got >= c.w);
  };
  paint();
  const off = onOffline(() => { if (!card.isConnected) { off(); return; } paint(); });
  return card;
}

// окно «Офлайн-музыка»
export function openOffline() {
  if (!offlineSupported()) return;
  const body = h('div', { class: 'off-sheet' });
  let ask = 0;
  const paint = () => {
    const s = offSettings(), o = offState(), c = counts(), list = downloadedTracks();
    const k = c.w ? c.got / c.w : 0;
    const sw = (on, fn) => h('button', { type: 'button', class: `switch${on ? ' active' : ''}`, role: 'switch', 'aria-checked': String(on), onclick: fn }, h('i'));
    const row = (ic, title, desc, ctrl) => h('div', { class: 'off-row' }, h('span', { class: 'off-ic' }, mi(ic)), h('span', { class: 'off-rt' }, h('b', { text: title }), desc ? h('small', { text: desc }) : null), ctrl);
    const seg = h('div', { class: 'off-seg', style: `--i:${s.net === 'any' ? 1 : 0}` }, h('i'),
      h('button', { type: 'button', class: s.net !== 'any' ? 'on' : '', onclick: () => setOffSettings({ net: 'wifi' }) }, mi('wifi'), 'Только Wi-Fi'),
      h('button', { type: 'button', class: s.net === 'any' ? 'on' : '', onclick: () => setOffSettings({ net: 'any' }) }, mi('signal'), 'Wi-Fi и мобильный'));
    body.replaceChildren(
      h('div', { class: 'off-hero' },
        h('div', { class: 'off-big', style: `--k:${k}` }, h('b', { text: String(c.got) }), h('small', { text: `из ${c.w}` })),
        h('div', { class: 'off-hi' },
          h('b', { text: 'Музыка без интернета' }),
          h('small', { class: `off-st${prog.running ? ' run' : ''}`, text: statusText() }),
          h('div', { class: 'off-bar' }, h('i', { style: `width:${Math.round(k * 100)}%` })),
          h('small', { text: `Занято ${mb(o.total || 0)}${o.free ? ` · свободно ${mb(o.free)}` : ''}` }))),
      h('div', { class: 'off-card2' },
        row('heart', 'Скачивать лайки автоматически', 'Лайкнули — трек скачается сам. Убрали лайк — удалится', sw(s.auto, () => setOffSettings({ auto: !s.auto }))),
        row('playlist', 'И треки из плейлистов', 'Ваши плейлисты тоже будут играть без сети', sw(s.pl, () => setOffSettings({ pl: !s.pl })))),
      h('div', { class: 'off-lbl', text: 'Скачивать через' }), seg,
      h('small', { class: 'off-note', text: s.net === 'any' ? 'Песня — примерно 3–6 МБ. На мобильном интернете это расходует трафик' : 'На мобильном интернете ничего не качается — только когда телефон в Wi-Fi' }),
      h('div', { class: 'off-btns' },
        prog.running
          ? h('button', { type: 'button', class: 'btn tonal', onclick: () => { stopSync(); toast('Остановлю после текущего трека'); } }, mi('pause'), ' Остановить')
          : h('button', { type: 'button', class: 'btn', onclick: () => { syncOffline(true); toast('Начинаю скачивать'); } }, mi('download'), ' Скачать сейчас'),
        list.length ? h('button', { type: 'button', class: 'btn tonal', onclick: () => {
          if (Date.now() - ask > 3000) { ask = Date.now(); toast('Нажмите ещё раз, чтобы удалить всё скачанное'); return; }
          ask = 0; clearDownloads(); toast('Скачанное удалено');
        } }, icon('trash'), ' Удалить всё') : null),
      list.length ? h('div', { class: 'section-title', text: `Скачано · ${list.length}` }) : null,
      list.length ? h('div', { class: 'list off-list' }, list.map((t, i) => {
        const r = trackRow(t, { onPlay: () => player.playTracks(list, i), onMore: () => { removeDownload(t.id); toast('Удалено с телефона'); }, current: player.queue.current?.id === t.id, sub: `${t.artist} · ${mb(t.size)}` });
        const more = r.querySelector('.more, [aria-label*="еню"]'); if (more) { more.replaceChildren(icon('trash')); more.setAttribute('aria-label', 'Удалить с телефона'); }
        return r;
      })) : h('p', { class: 'off-empty', text: 'Пока ничего не скачано. Включите автоскачивание или нажмите «Скачать сейчас»' }));
  };
  paint();
  openSheet('Офлайн-музыка', body);
  const off = onOffline(() => { if (!body.isConnected || !isSheetOpen()) { off(); return; } const y = body.parentElement ? body.parentElement.scrollTop : 0; paint(); if (body.parentElement) body.parentElement.scrollTop = y; });
}

// запуск без интернета: сразу показываем, что можно послушать
export function offlineStart() {
  if (!offlineSupported() || navigator.onLine) return;
  setTimeout(() => {
    toast('Нет интернета — играет скачанная музыка');
    const lib = document.querySelector('#bottom-nav .nav-btn[data-view="library"]');
    if (lib) lib.click();
    if (!store.state.likes.length && downloadedTracks().length) setTimeout(openOffline, 600);
  }, 1800);
}
