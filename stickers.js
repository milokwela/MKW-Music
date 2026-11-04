// Стикеры-котики MKW и эмодзи: для реакций и для сообщений.
// Стикер в сообщении хранится как img: 'mkw:N' (а в тексте — «🐾 Стикер» для старых версий приложения),
// в реакции — как 'mkw:N'.
import { h } from './ui.js?v=0.35.1';

export const CATS = [
  'Многоточие', 'Люблю', 'Слушаю', 'Что?', 'Круто', 'Злюсь', 'Загрузка…', 'Плачу',
  'В телефоне', 'I ♥ MKW', 'Сплю', 'Подглядываю', 'Ну-ну', 'Ааа!', 'Король',
].map((name, i) => ({ n: i + 1, name }));
// большие стикеры (отдельно от эмодзи: только для отправки, не для реакций)
export const STICKERS = [
  'Музыка в ушах', 'MKW', 'Обнимашки', 'Хм?', 'Бесит', 'Bye…', 'MKW!', 'Крутой', 'Сплю', 'Люблю', 'Кто там?', 'Злюка',
  'Спокойной ночи', 'Сюрприз', 'Люблю музыку', 'Стесняюсь', '…', 'Король', 'Подарок', 'Снеговик', 'Ёлочка', 'Какао', 'Зимний', 'Новогодний сон',
  'Какао со звёздочкой', 'Сладкий сон', 'В костюме снеговика', 'Король', 'Обнимаю пингвина', 'Чего?', 'Слушаю музыку', 'Подарок для тебя', 'Холодно', 'Зимняя ночь', 'Держи звезду', 'Олень',
].map((name, i) => ({ n: i + 1, name }));
export const stSrc = (n) => `mkw-st${n}.webp`;
export const STICKER_TXT = '🐾 Стикер';
export const catSrc = (n) => `mkw-cat${n}.webp`;
export const catOf = (v) => { const m = /^mkw:(\d{1,2})$/.exec(String(v || '')); const n = m ? Number(m[1]) : 0; return n >= 1 && n <= CATS.length ? n : 0; };
export const catName = (n) => (CATS[n - 1] ? CATS[n - 1].name : 'Стикер');
// что за картинка в сообщении: котик 'mkw:N' или стикер 'st:N'
export function stickerOf(v) {
  const c = catOf(v);
  if (c) return { src: catSrc(c), name: catName(c) };
  const m = /^st:(\d{1,2})$/.exec(String(v || '')); const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= STICKERS.length ? { src: stSrc(n), name: STICKERS[n - 1].name, big: true } : null;
}
// эмодзи MKW у ника: 'c3' — котик, 's12' — стикер
export function nickEmoSrc(v) {
  const m = /^([cs])(\d{1,2})$/.exec(String(v || '')); if (!m) return '';
  const n = Number(m[2]);
  if (m[1] === 'c') return n >= 1 && n <= CATS.length ? catSrc(n) : '';
  return n >= 1 && n <= STICKERS.length ? stSrc(n) : '';
}
export function nickEmo(v, cls = 'nick-emo') {
  const src = nickEmoSrc(v);
  return src ? h('img', { class: cls, src, alt: '', draggable: 'false', loading: 'lazy' }) : null;
}

// реакция: эмодзи текстом или котик картинкой
export function rxNode(v, cls = 'rx-cat') {
  const n = catOf(v);
  return n ? h('img', { class: cls, src: catSrc(n), alt: catName(n), title: catName(n), draggable: 'false' }) : h('span', { text: v });
}

export const EMOJI = {
  'Смайлы': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 🤡 👻 👽 🤖 💩',
  'Жесты': '👍 👎 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 👏 🙌 👐 🤲 🤝 🙏 💪 🫶 🫡 🫠 🫣 🫢',
  'Сердечки': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 ⚡',
  'Музыка': '🎧 🎵 🎶 🎤 🎹 🎸 🥁 🎷 🎺 🎻 📻 💿 📀 🔊 🎙️ 🪩 🕺 💃 🎉 🎊 🏆 👑 💎',
  'Разное': '🐱 🐈‍⬛ 🐾 🦊 🐻 🐼 🐸 🦋 🌙 🌈 ☀️ ☁️ ❄️ 🌊 🌹 🌸 🍀 🍕 🍔 🍟 🍿 🍩 🍪 ☕ 🧃 🍷 🎮 📱 💻 📸 🚗 ✈️ 🏠 💤 💬 👀 🗿',
};
export const QUICK_RX = ['❤️', '🔥', '😂', '👍', '😮', '😢', 'mkw:2', 'mkw:10'];

// панель «стикеры / эмодзи». onCat(n) — котик, onEmoji(e) — эмодзи
export function emojiPicker({ onCat, onEmoji, onSticker, tab = 'cats', compact = false, only = '' }) {
  if (only) tab = only;
  if (tab === 'stickers' && !onSticker) tab = 'cats';
  const body = h('div', { class: 'emo-body' });
  const tabs = h('div', { class: 'emo-tabs', role: 'tablist' });
  const show = (t) => {
    tab = t;
    [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'stickers') {
      body.replaceChildren(h('div', { class: 'emo-cats emo-st' }, ...STICKERS.map((c) => h('button', { type: 'button', class: 'emo-cat', title: c.name, 'aria-label': c.name, onclick: (e) => { e.stopPropagation(); onSticker(c.n); } },
        h('img', { src: stSrc(c.n), alt: '', loading: 'lazy', draggable: 'false' })))));
    } else if (t === 'cats') {
      body.replaceChildren(h('div', { class: 'emo-cats' }, ...CATS.map((c) => h('button', { type: 'button', class: 'emo-cat', title: c.name, 'aria-label': c.name, onclick: (e) => { e.stopPropagation(); onCat(c.n); } },
        h('img', { src: catSrc(c.n), alt: '', loading: 'lazy', draggable: 'false' })))));
    } else {
      body.replaceChildren(...Object.entries(EMOJI).map(([name, list]) => h('div', { class: 'emo-sec' }, h('small', { text: name }),
        h('div', { class: 'emo-grid' }, ...list.split(' ').filter(Boolean).map((e) => h('button', { type: 'button', class: 'emo-e', onclick: (ev) => { ev.stopPropagation(); onEmoji(e); } }, e))))));
    }
    body.scrollTop = 0;
  };
  tabs.append(...[
    onSticker ? h('button', { type: 'button', class: 'emo-tab', 'data-t': 'stickers', onclick: (e) => { e.stopPropagation(); show('stickers'); } }, h('img', { src: stSrc(2), alt: '' }), h('span', { text: 'Стикеры' })) : null,
    h('button', { type: 'button', class: 'emo-tab', 'data-t': 'cats', onclick: (e) => { e.stopPropagation(); show('cats'); } }, h('img', { src: catSrc(10), alt: '' }), h('span', { text: 'Эмодзи MKW' })),
    h('button', { type: 'button', class: 'emo-tab', 'data-t': 'emoji', onclick: (e) => { e.stopPropagation(); show('emoji'); } }, h('span', { class: 'emo-tab-e', text: '😀' }), h('span', { text: 'Эмодзи' }))].filter(Boolean));
  const el = h('div', { class: `emo-pick${compact ? ' compact' : ''}${only ? ' only' : ''}` }, only ? h('div', { class: 'emo-title', text: only === 'stickers' ? 'Стикеры MKW' : '' }) : tabs, body);
  show(tab);
  return el;
}
