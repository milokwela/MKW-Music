// «Сообщить об ошибке» и «Оценить оптимизацию» (О MKW). Всё уходит создателю MKW: он видит это в Настройки → «Сообщения».
//
// Где хранится: reports/{id} — сам отзыв (текст, оценка, данные о телефоне, маленькие превью вложений);
// reports/{id}/parts/{i-nnn} — вложения кусками по ~900 КБ (в один документ Firestore больше 1 МБ не влезает).
// Порядок записи: сначала отзыв с пометкой up:true («загружается»), потом куски, потом up:false —
// так создатель видит даже недогруженное сообщение и может его удалить вместе с кусками.
import { db, auth } from './firebase.js';
import { doc, setDoc, updateDoc, collection } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { h, toast, openSheet, closeSheet } from './ui.js';
import { mi } from './icons2.js';
import { appVersion } from './apk.js';
import { VERSION } from './changelog.js';
import { device, quality, qualityMode } from './quality.js';
import { pushTo, myNick } from './push.js';
import { OWNER_UID } from './auth.js';

export const RATE_VER = '1.5'; // какую версию оцениваем: при следующей большой оптимизации — поменять
const PART = 900000;            // символов base64 в одном куске
const MAX_VIDEO = 20 * 1024 * 1024;
const MAX_ATT = 4;
const LAST_SENT = 'mkw.fb.last';
const MY_RATE = `mkw.fb.rate.${RATE_VER}`;

export const RATE_TEXT = [
  'Стало хуже',
  'Ничего не изменилось',
  'Почти то же самое',
  'Чуть-чуть лучше',
  'Немного лучше, но всё ещё тормозит',
  'Заметно лучше, но бывают подвисания',
  'Лучше, иногда подтормаживает',
  'Хорошо, почти не тормозит',
  'Плавно, телефон почти не греется',
  'Очень плавно',
  'Отлично, приложение летает',
];

const me = () => (auth.currentUser && auth.currentUser.uid) || '';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Модель телефона из строки браузера: «TECNO KG5k», «Pixel 7» (в браузере Chrome её может не быть). */
export function phoneModel() {
  const m = /Android [\d.]+; (?:[a-z]{2}[-_][a-z]{2}; )?([^;)]+?)(?: Build\/[^;)]*)?[;)]/i.exec(navigator.userAgent);
  const v = m ? m[1].trim() : '';
  return v && v !== 'K' && v !== 'wv' ? v.slice(0, 40) : '';
}

/** Что за телефон и как работает MKW — прикладывается к каждому сообщению, чтобы ошибку было легче повторить. */
export function envInfo() {
  const d = device() || {};
  const wv = (/Chrome\/(\d+)/.exec(navigator.userAgent) || [])[1] || '';
  return {
    app: appVersion() || '', site: VERSION,
    model: phoneModel(), brand: String(d.brand || '').slice(0, 20),
    os: ((/Android ([\d.]+)/.exec(navigator.userAgent) || [])[1] || (/(iPhone|Windows|Mac OS X|Linux)/.exec(navigator.userAgent) || [])[1] || '').slice(0, 20),
    ram: Number(d.ram) || Math.round((Number(navigator.deviceMemory) || 0) * 1024), cores: Number(d.cores) || Number(navigator.hardwareConcurrency) || 0,
    hz: Number(d.hz) || 0, wv: Number(d.wv) || Number(wv) || 0, tier: typeof d.tier === 'number' ? d.tier : -1,
    q: quality(), qm: qualityMode(), scr: `${screen.width}x${screen.height}@${Math.round((window.devicePixelRatio || 1) * 100) / 100}`,
  };
}

// ---------- вложения ----------

function readData(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function scaleTo(src, w0, h0, max, q) {
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}

async function prepPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);
    return { type: 'img', mime: 'image/jpeg', data: scaleTo(img, img.naturalWidth, img.naturalHeight, 1600, 0.8), thumb: scaleTo(img, img.naturalWidth, img.naturalHeight, 260, 0.6), w: img.naturalWidth, h: img.naturalHeight, name: file.name };
  } finally { URL.revokeObjectURL(url); }
}

function videoThumb(file) {
  return new Promise((res) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const end = (out) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); res(out); };
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    v.onloadeddata = () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch { end({ dur: v.duration }); } };
    v.onseeked = () => { try { end({ thumb: scaleTo(v, v.videoWidth, v.videoHeight, 260, 0.6), dur: v.duration, w: v.videoWidth, h: v.videoHeight }); } catch { end({ dur: v.duration }); } };
    v.onerror = () => end({});
    setTimeout(() => end({ dur: v.duration || 0 }), 6000);
  });
}

async function prepVideo(file) {
  if (file.size > MAX_VIDEO) throw Object.assign(new Error('big'), { userText: `Видео больше ${MAX_VIDEO / 1048576} МБ — обрежьте его или запишите короче` });
  const [data, t] = await Promise.all([readData(file), videoThumb(file)]);
  return { type: 'video', mime: file.type || 'video/mp4', data, thumb: t.thumb || '', dur: Math.round(t.dur || 0), w: t.w || 0, h: t.h || 0, name: file.name };
}

// ---------- отправка ----------

async function send(kind, payload, atts, onProgress) {
  const uid = me();
  if (!uid) throw Object.assign(new Error('auth'), { userText: 'Войдите в аккаунт' });
  const ref = doc(collection(db, 'reports'));
  const id = kind === 'rate' ? `rate-${RATE_VER.replace('.', '')}-${uid}` : ref.id;
  const target = doc(db, 'reports', id);
  const att = atts.map((a, i) => ({ i, type: a.type, mime: a.mime, parts: Math.ceil(a.data.length / PART), size: Math.round(a.data.length * 0.75), thumb: a.thumb || '', w: a.w || 0, h: a.h || 0, dur: a.dur || 0 }));
  const base = { kind, uid, nick: myNick().slice(0, 32), text: String(payload.text || '').slice(0, 2000), env: envInfo(), at: Date.now(), read: false, up: att.length > 0, att };
  if (kind === 'rate') { base.score = payload.score; base.ver = RATE_VER; }
  await setDoc(target, base);
  const total = att.reduce((s, a) => s + a.parts, 0);
  let sent = 0;
  for (const a of atts) {
    const i = atts.indexOf(a);
    for (let j = 0; j * PART < a.data.length; j++) {
      await setDoc(doc(db, 'reports', id, 'parts', `${i}-${String(j).padStart(3, '0')}`), { d: a.data.slice(j * PART, (j + 1) * PART) });
      sent += 1; if (onProgress) onProgress(sent / total);
    }
  }
  if (att.length) await updateDoc(target, { up: false });
  put(LAST_SENT, String(Date.now()));
  // создателю — уведомление на телефон (если у него включены уведомления)
  if (uid !== OWNER_UID) {
    const title = kind === 'rate' ? `Оценка оптимизации: ${payload.score}/10` : 'Сообщение об ошибке';
    const body = `${myNick()}: ${base.text || (kind === 'rate' ? RATE_TEXT[payload.score] : 'без текста')}${att.length ? ` · вложений: ${att.length}` : ''}`.slice(0, 180);
    pushTo(OWNER_UID, 'msg', title, body, `report-${id}`, './#reports');
  }
  return id;
}

function tooOften() {
  const last = Number(get(LAST_SENT)) || 0;
  return Date.now() - last < 30000;
}

const errText = (e) => (e && e.userText) || (e && e.code === 'permission-denied' ? 'Сервер пока не принимает сообщения — попробуйте позже' : 'Не получилось отправить. Проверьте интернет');

// ---------- окно «Сообщить об ошибке» ----------

export function openBugReport() {
  const atts = [];
  const text = h('textarea', { class: 'fb-text', rows: '5', maxlength: '2000', placeholder: 'Что случилось? Где именно и что вы делали перед этим. Например: «В чате при отправке фото экран прыгает вверх»' });
  const list = h('div', { class: 'fb-atts' });
  const note = h('p', { class: 'fb-note' });
  const bar = h('div', { class: 'fb-progress', hidden: '' }, h('i'));
  const sendBtn = h('button', { class: 'btn block', type: 'button', text: 'Отправить' });
  const pick = (accept) => {
    const inp = h('input', { type: 'file', accept, multiple: accept.startsWith('image') ? '' : null, hidden: '' });
    inp.addEventListener('change', async () => {
      const files = [...(inp.files || [])];
      inp.remove();
      for (const f of files) {
        if (atts.length >= MAX_ATT) { toast(`Не больше ${MAX_ATT} вложений`); break; }
        if (f.type.startsWith('video') && atts.some((a) => a.type === 'video')) { toast('Одно видео на сообщение'); continue; }
        const slot = { busy: true, type: f.type.startsWith('video') ? 'video' : 'img' };
        atts.push(slot); paint();
        try { Object.assign(slot, f.type.startsWith('video') ? await prepVideo(f) : await prepPhoto(f), { busy: false }); }
        catch (e) { atts.splice(atts.indexOf(slot), 1); toast(e && e.userText ? e.userText : 'Не удалось открыть файл'); }
        paint();
      }
    });
    document.body.appendChild(inp); inp.click();
  };
  const paint = () => {
    list.replaceChildren(...[...atts.map((a) => h('div', { class: `fb-att${a.busy ? ' busy' : ''}` },
      a.thumb ? h('img', { src: a.thumb, alt: '' }) : h('span', { class: 'fb-ph' }, mi(a.type === 'video' ? 'play' : 'image')),
      a.type === 'video' ? h('span', { class: 'fb-dur', text: a.dur ? `${Math.floor(a.dur / 60)}:${String(a.dur % 60).padStart(2, '0')}` : 'видео' }) : null,
      a.busy ? null : h('button', { type: 'button', class: 'fb-x', 'aria-label': 'Убрать', onclick: () => { atts.splice(atts.indexOf(a), 1); paint(); } }, mi('close')))),
    atts.length < MAX_ATT ? h('button', { type: 'button', class: 'fb-add', onclick: () => pick('image/*') }, mi('image'), h('span', { text: 'Фото' })) : null,
    atts.length < MAX_ATT && !atts.some((a) => a.type === 'video') ? h('button', { type: 'button', class: 'fb-add', onclick: () => pick('video/*') }, mi('play'), h('span', { text: 'Видео' })) : null].filter(Boolean));
    const mb = atts.reduce((s, a) => s + (a.data ? a.data.length * 0.75 : 0), 0) / 1048576;
    note.textContent = mb > 0.05 ? `Вложения: ${mb.toFixed(1)} МБ. Видео — до ${MAX_VIDEO / 1048576} МБ, лучше короткое запись экрана.` : 'Можно приложить до 4 скриншотов или одну запись экрана. Модель телефона и версия MKW прикрепятся сами.';
  };
  sendBtn.addEventListener('click', async () => {
    const t = text.value.trim();
    if (!t && !atts.length) { toast('Опишите ошибку или приложите скриншот'); text.focus(); return; }
    if (atts.some((a) => a.busy)) { toast('Подождите, файл ещё готовится'); return; }
    if (tooOften()) { toast('Подождите полминуты перед следующим сообщением'); return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Отправляем…'; bar.hidden = false;
    try {
      await send('bug', { text: t }, atts.filter((a) => a.data), (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; sendBtn.textContent = `Отправляем… ${Math.round(p * 100)}%`; });
      closeSheet(); toast('Спасибо! Сообщение отправлено разработчику');
    } catch (e) {
      console.warn(e); toast(errText(e));
      sendBtn.disabled = false; sendBtn.textContent = 'Отправить'; bar.hidden = true;
    }
  });
  paint();
  openSheet('Сообщить об ошибке', h('div', { class: 'fb-box' }, text, list, note, bar, sendBtn));
  setTimeout(() => text.focus(), 350);
}

// ---------- окно «Оценить оптимизацию» ----------

export const myRate = () => { const v = get(MY_RATE); return v === null ? -1 : Number(v); };

export function openRate() {
  let score = myRate();
  const label = h('div', { class: 'fb-rate-label' });
  const nums = h('div', { class: 'fb-nums' });
  const text = h('textarea', { class: 'fb-text', rows: '3', maxlength: '2000', placeholder: 'Что стало лучше, а что ещё тормозит? (необязательно)' });
  const sendBtn = h('button', { class: 'btn block', type: 'button', text: score >= 0 ? 'Изменить оценку' : 'Отправить оценку' });
  const paint = () => {
    nums.replaceChildren(...RATE_TEXT.map((_, i) => h('button', { type: 'button', class: `fb-num${i === score ? ' on' : ''}`, style: `--k:${i / 10}`, text: String(i), onclick: () => { score = i; paint(); } })));
    label.replaceChildren(score >= 0 ? h('b', { text: `${score} — ${RATE_TEXT[score]}` }) : h('span', { text: 'Выберите от 0 до 10' }));
    sendBtn.disabled = score < 0;
  };
  sendBtn.addEventListener('click', async () => {
    if (score < 0) return;
    if (tooOften()) { toast('Подождите полминуты перед следующей отправкой'); return; }
    sendBtn.disabled = true; sendBtn.textContent = 'Отправляем…';
    try {
      await send('rate', { score, text: text.value.trim() }, []);
      put(MY_RATE, String(score));
      closeSheet(); toast('Спасибо за оценку!');
      window.dispatchEvent(new Event('mkw-rated'));
    } catch (e) { console.warn(e); toast(errText(e)); sendBtn.disabled = false; sendBtn.textContent = 'Отправить оценку'; }
  });
  paint();
  openSheet(`Оценить оптимизацию ${RATE_VER}`, h('div', { class: 'fb-box' },
    h('p', { class: 'fb-note', text: 'Насколько плавнее стало приложение на вашем телефоне после обновления? 0 — стало хуже, 10 — летает.' }),
    nums, label, text, sendBtn));
}

/** Карточка в «О MKW». */
export function feedbackCard() {
  const rateSub = h('small');
  const syncRate = () => { const r = myRate(); rateSub.textContent = r >= 0 ? `Ваша оценка: ${r}/10 — ${RATE_TEXT[r]}. Можно изменить` : 'Стало ли плавнее после 1.5? Оцените от 0 до 10'; };
  syncRate();
  window.addEventListener('mkw-rated', syncRate);
  const item = (ic, title, sub, fn) => h('button', { type: 'button', class: 'fb-item', onclick: fn },
    h('span', { class: 'set-ic' }, mi(ic)), h('span', { class: 'fb-item-t' }, h('b', { text: title }), sub), h('span', { class: 'chev', text: '›' }));
  return h('div', { class: 'fb-card' },
    item('rocket', `Оценить оптимизацию ${RATE_VER}`, rateSub, openRate),
    item('chat', 'Сообщить об ошибке', h('small', { text: 'Опишите, что не так, приложите скриншот или видео' }), openBugReport));
}
