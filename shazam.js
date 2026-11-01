// «Шазам»: слушаем микрофон (или берём аудио/видео файл) и узнаём песню через Cloudflare Worker.
import { RECOGNIZE_URL } from './shazam-config.js?v=0.22.1';
import { $, h, toast, openSheet, closeSheet, icon } from './ui.js?v=0.22.1';

const REC_SECONDS = 9;
let busy = false;

// Любой формат -> WAV 16 кГц моно (AudD надёжно понимает его, в отличие от webm/ogg с телефонов)
async function toWav(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const dec = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    const sec = Math.min(dec.duration, 12);
    const off = new OfflineAudioContext(1, Math.ceil(sec * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = dec; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const w = (o, s) => { for (let k = 0; k < s.length; k++) out.setUint8(o + k, s.charCodeAt(k)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
    w(36, 'data'); out.setUint32(40, pcm.length * 2, true);
    for (let k = 0; k < pcm.length; k++) out.setInt16(44 + k * 2, Math.max(-1, Math.min(1, pcm[k])) * 32767, true);
    return new Blob([out], { type: 'audio/wav' });
  } catch (e) { console.warn('wav convert failed', e); return blob; }
}

async function ask(blob) {
  const wav = await toWav(blob);
  const fd = new FormData();
  fd.append('file', wav, wav.type === 'audio/wav' ? 'clip.wav' : 'clip');
  let res;
  try { res = await fetch(RECOGNIZE_URL, { method: 'POST', body: fd }); }
  catch { throw new Error('Нет связи с сервером распознавания (проверьте адрес в shazam-config.js)'); }
  if (!res.ok) throw new Error(`Сервер распознавания ответил ${res.status}`);
  let data;
  try { data = await res.json(); } catch { throw new Error('Сервер вернул не JSON — проверьте Worker'); }
  if (data.status !== 'success') throw new Error(`AudD: ${data.error?.error_message || 'ошибка'}`);
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
      toast(e && e.message ? e.message : 'Не получилось распознать');
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
    try { done(await ask(f), onFound); } catch (e) { console.error(e); closeSheet(); toast(e && e.message ? e.message : 'Не получилось распознать'); }
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
