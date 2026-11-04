// Распознавание речи через сервер MKW (Cloudflare Worker → Whisper).
// Нужен там, где у браузера нет своего распознавания: Яндекс Браузер, Opera, Brave, Firefox.
// Микрофон слушаем на устройстве и отправляем только короткие кусочки, когда человек что-то сказал (2–6 секунд).
import { RECOGNIZE_URL } from './shazam-config.js?v=0.35.2';

const W = () => String(RECOGNIZE_URL || '').replace(/\/$/, '');
const AC = window.AudioContext || window.webkitAudioContext;
export const cloudSttPossible = () => Boolean(W() && AC && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

let ctx = null, stream = null, src = null, proc = null, sink = null, cb = null, active = false, paused = () => false;
let floor = 0.006, inSpeech = false, loud = 0, quiet = 0, chunks = [], pre = [], lastSend = 0, busy = 0;
const PRE = 4, START_N = 2, END_N = 8, MAX_SEC = 6.5, MIN_SEC = 0.35;
const DAY_KEY = () => `mkw.stt.${new Date().toISOString().slice(0, 10)}`;
const DAY_MAX = 600; // запросов в день с одного устройства — чтобы не съесть бесплатный лимит сервера

function spent() { try { return Number(localStorage.getItem(DAY_KEY()) || 0); } catch { return 0; } }
function spend() { try { localStorage.setItem(DAY_KEY(), String(spent() + 1)); } catch { /* ignore */ } }

function rms(buf) { let s = 0; for (let i = 0; i < buf.length; i += 2) s += buf[i] * buf[i]; return Math.sqrt(s / (buf.length / 2)); }

// 48 кГц → 16 кГц моно и WAV 16 бит — так меньше трафика, а Whisper всё равно работает на 16 кГц
function toWav(parts, rate) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const all = new Float32Array(len); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const ratio = rate / 16000, n = Math.floor(all.length / ratio);
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off, s) => { for (let i = 0; i < s.length; i++) out.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, 16000, true);
  out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  let peak = 0.0001; for (let i = 0; i < all.length; i++) peak = Math.max(peak, Math.abs(all[i]));
  const gain = Math.min(4, 0.9 / peak); // тихий голос подтягиваем
  for (let i = 0; i < n; i++) {
    const a = i * ratio, j = Math.floor(a), f = a - j;
    const v = ((all[j] || 0) * (1 - f) + (all[j + 1] || 0) * f) * gain;
    out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

async function send(parts, rate) {
  if (!cb || spent() >= DAY_MAX) return;
  const now = Date.now();
  if (now - lastSend < 900 || busy > 2) return;
  lastSend = now; busy += 1; spend();
  try {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000);
    const r = await fetch(`${W()}/stt`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: toWav(parts, rate), signal: c.signal });
    clearTimeout(t);
    if (r.status === 501) { cb({ error: 'no-server' }); return; }
    if (!r.ok) { cb({ error: 'fail' }); return; }
    const j = await r.json();
    if (j && typeof j.text === 'string' && j.text.trim()) cb({ text: j.text.trim() });
  } catch { if (navigator.onLine === false) cb({ error: 'offline' }); }
  finally { busy -= 1; }
}

function onAudio(e) {
  if (!active) return;
  const buf = new Float32Array(e.inputBuffer.getChannelData(0));
  if (paused()) { inSpeech = false; chunks = []; pre = []; return; }
  const lv = rms(buf);
  const on = Math.max(floor * 2.6, 0.014), off = Math.max(floor * 1.6, 0.009);
  if (!inSpeech) {
    floor = floor * 0.96 + Math.min(lv, 0.2) * 0.04; // уровень фона подстраивается
    pre.push(buf); if (pre.length > PRE) pre.shift();
    loud = lv > on ? loud + 1 : 0;
    if (loud >= START_N) { inSpeech = true; chunks = [...pre]; pre = []; quiet = 0; }
    return;
  }
  chunks.push(buf);
  quiet = lv < off ? quiet + 1 : 0;
  const sec = chunks.reduce((a, p) => a + p.length, 0) / ctx.sampleRate;
  if (quiet >= END_N || sec >= MAX_SEC) {
    const parts = chunks; inSpeech = false; chunks = []; loud = 0;
    if (sec >= MAX_SEC) { floor = Math.max(floor, parts.reduce((a, p) => a + rms(p), 0) / parts.length * 0.8); return; } // долгий ровный звук — это музыка или шум
    if (sec - quiet * buf.length / ctx.sampleRate >= MIN_SEC) send(parts, ctx.sampleRate);
  }
}

export async function startCloud(onResult, isPaused) {
  cb = onResult; paused = isPaused || (() => false);
  if (active) return true;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  ctx = new AC();
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  src = ctx.createMediaStreamSource(stream);
  proc = ctx.createScriptProcessor(4096, 1, 1);
  sink = ctx.createGain(); sink.gain.value = 0; // процессору нужен выход, но слышать себя не надо
  proc.onaudioprocess = onAudio;
  src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
  active = true; floor = 0.006; inSpeech = false; chunks = []; pre = [];
  return true;
}

export function stopCloud() {
  active = false; cb = null;
  try { proc && (proc.onaudioprocess = null); src && src.disconnect(); proc && proc.disconnect(); sink && sink.disconnect(); } catch { /* ignore */ }
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (ctx) ctx.close().catch(() => {});
  ctx = stream = src = proc = sink = null;
}
export const cloudActive = () => active;
