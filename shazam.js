// «Шазам»: слушаем микрофон (или берём аудио/видео файл) и узнаём песню через Cloudflare Worker.
import { RECOGNIZE_URL } from './shazam-config.js';
import { $, h, toast, openSheet, closeSheet, icon } from './ui.js';

const REC_SECONDS = 9;
let busy = false;

async function ask(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'clip');
  const res = await fetch(RECOGNIZE_URL, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`worker ${res.status}`);
  const data = await res.json();
  if (data.status !== 'success') throw new Error(data.error?.error_message || 'audd');
  return data.result;   // null, если не узнали
}

function done(result, onFound) {
  closeSheet();
  if (!result || !result.title) { toast('Не узнал песню. Поднесите ближе и попробуйте ещё'); return; }
  toast(`Найдено: ${result.artist} — ${result.title}`);
  onFound(`${result.artist} ${result.title}`);
}

function panel(text) {
  const ring = h('div', { class: 'listen-ring' }, h('i'), h('i'), h('i'), icon('mic'));
  const label = h('div', { class: 'listen-text', text });
  const cancel = h('button', { class: 'btn tonal', type: 'button' }, 'Отмена');
  openSheet('', h('div', { class: 'listen' }, ring, label, cancel));
  return { label, cancel };
}

export async function listenMic(onFound) {
  if (busy) return;
  if (!RECOGNIZE_URL) { toast('Распознавание не настроено: вставьте адрес в shazam-config.js'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Браузер не даёт доступ к микрофону'); return; }
  busy = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
  } catch { toast('Нет доступа к микрофону. Разрешите его в настройках сайта'); busy = false; return; }
  const ui = panel(`Слушаю… ${REC_SECONDS}`);
  let cancelled = false;
  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  let left = REC_SECONDS;
  const tick = setInterval(() => { left -= 1; if (left >= 0) ui.label.textContent = `Слушаю… ${left}`; }, 1000);
  const stop = () => { clearInterval(tick); try { rec.stop(); } catch { /* ignore */ } stream.getTracks().forEach((t) => t.stop()); };
  ui.cancel.addEventListener('click', () => { cancelled = true; stop(); closeSheet(); busy = false; });
  rec.onstop = async () => {
    if (cancelled) return;
    ui.label.textContent = 'Узнаю…';
    try {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      done(await ask(blob), onFound);
    } catch (e) {
      console.error(e);
      closeSheet();
      toast('Не получилось распознать. Проверьте интернет и настройки');
    }
    busy = false;
  };
  rec.start();
  setTimeout(stop, REC_SECONDS * 1000);
}

export function pickFile(onFound) {
  if (!RECOGNIZE_URL) { toast('Распознавание не настроено: вставьте адрес в shazam-config.js'); return; }
  const input = h('input', { type: 'file', accept: 'audio/*,video/*' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 7 * 1024 * 1024) { toast('Файл слишком большой (до 7 МБ). Возьмите короткий кусок'); return; }
    const ui = panel('Узнаю…');
    ui.cancel.addEventListener('click', () => closeSheet());
    try { done(await ask(f), onFound); } catch (e) { console.error(e); closeSheet(); toast('Не получилось распознать'); }
  });
  input.click();
}

export function initShazam(onFound) {
  const b = $('#mic-btn');
  if (b) b.addEventListener('click', () => {
    openSheet('Распознать песню', h('div', { class: 'listen-menu' },
      h('button', { class: 'btn', type: 'button', onclick: () => { closeSheet(); listenMic(onFound); } }, icon('mic'), ' Послушать микрофоном'),
      h('button', { class: 'btn tonal', type: 'button', onclick: () => { closeSheet(); pickFile(onFound); } }, 'Файл или видео (до 7 МБ)'),
      h('p', { class: 'sheet-note', text: 'Для видео из TikTok: сохраните ролик или запишите экран и выберите файл. Или включите видео рядом и слушайте микрофоном.' })));
  });
}
