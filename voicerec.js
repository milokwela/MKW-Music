// Голосовые сообщения. Раньше каждый телефон записывал в своём формате (Android — webm/mp4-фрагменты,
// iPhone — m4a), и часть голосовых не играла на других телефонах. Теперь пишем звук сами
// и кодируем в MP3 — его понимают все телефоны, планшеты и компьютеры.
import { VERSION } from './changelog.js?v=0.35.5';

const AC = () => window.AudioContext || window.webkitAudioContext;
const OUT_RATE = 22050; // звук чище, а минута голосового всё ещё помещается в одно сообщение
const KBPS = 36;

let lameP = null;
export function loadLame() {
  if (window.lamejs && window.lamejs.Mp3Encoder) return Promise.resolve(window.lamejs);
  if (!lameP) {
    lameP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL(`lame.min.js?v=${VERSION}`, document.baseURI).href;
      s.async = true;
      s.onload = () => (window.lamejs && window.lamejs.Mp3Encoder ? res(window.lamejs) : rej(new Error('lame')));
      s.onerror = () => { lameP = null; rej(new Error('lame')); };
      document.head.appendChild(s);
    });
  }
  return lameP;
}

// Захват звука с микрофона. AudioContext создаём прямо в нажатии на кнопку — иначе iPhone его не запустит.
export function pcmCapture() {
  const C = AC();
  if (!C) return null;
  let ac;
  try { ac = new C(); } catch { return null; }
  try { ac.resume(); } catch { /* ignore */ }
  const cap = { ac, chunks: [], len: 0, rate: ac.sampleRate, ok: false };
  cap.attach = (stream) => {
    try {
      const src = ac.createMediaStreamSource(stream);
      const node = ac.createScriptProcessor(4096, 1, 1);
      const mute = ac.createGain(); mute.gain.value = 0;
      node.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        cap.chunks.push(new Float32Array(d)); cap.len += d.length;
        try { e.outputBuffer.getChannelData(0).fill(0); } catch { /* ignore */ }
      };
      src.connect(node); node.connect(mute); mute.connect(ac.destination);
      cap.src = src; cap.node = node; cap.mute = mute; cap.ok = true;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return true;
    } catch { return false; }
  };
  cap.stop = () => {
    try { if (cap.src) cap.src.disconnect(); if (cap.node) { cap.node.onaudioprocess = null; cap.node.disconnect(); } if (cap.mute) cap.mute.disconnect(); } catch { /* ignore */ }
    try { ac.close(); } catch { /* ignore */ }
  };
  cap.samples = () => { const out = new Float32Array(cap.len); let o = 0; for (const c of cap.chunks) { out.set(c, o); o += c.length; } return out; };
  return cap;
}

// запись другого формата → звук (на том же телефоне, где записали, он всегда раскодируется)
export async function decodeBlob(blob) {
  const C = AC();
  if (!C || !blob) return null;
  const ac = new C();
  try {
    const buf = await blob.arrayBuffer();
    const ab = await new Promise((res, rej) => { const p = ac.decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
    return { f32: ab.getChannelData(0), rate: ab.sampleRate };
  } catch { return null; } finally { try { ac.close(); } catch { /* ignore */ } }
}

function resample(f32, rate) {
  if (Math.abs(rate - OUT_RATE) < 1) return f32;
  const ratio = rate / OUT_RATE;
  const n = Math.floor(f32.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j += 1) sum += f32[j];
    out[i] = b > a ? sum / (b - a) : (f32[a] || 0);
  }
  return out;
}

// звук → MP3. null — если записалась тишина (значит, захват не сработал)
export async function encodeMp3(f32, rate) {
  if (!f32 || !f32.length) return null;
  const pcm = resample(f32, rate);
  // срезаем щелчок в начале и конце
  const edge = Math.min(Math.floor(OUT_RATE * 0.04), Math.floor(pcm.length / 10));
  for (let i = 0; i < edge; i += 1) { const k = i / edge; pcm[i] *= k; pcm[pcm.length - 1 - i] *= k; }
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 1) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
  if (peak < 0.003) return null;
  const g = Math.max(1, Math.min(3, 0.85 / peak)); // тихую запись делаем громче
  const s16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) s16[i] = Math.max(-32767, Math.min(32767, Math.round(pcm[i] * g * 32767)));
  const lame = await loadLame();
  const enc = new lame.Mp3Encoder(1, OUT_RATE, KBPS);
  const parts = [];
  const STEP = 1152;
  for (let i = 0; i < s16.length; i += STEP * 40) {
    const end = Math.min(s16.length, i + STEP * 40);
    for (let k = i; k < end; k += STEP) { const b = enc.encodeBuffer(s16.subarray(k, Math.min(end, k + STEP))); if (b.length) parts.push(new Uint8Array(b)); }
    await new Promise((r) => setTimeout(r, 0)); // не подвешиваем экран
  }
  const f = enc.flush();
  if (f.length) parts.push(new Uint8Array(f));
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), dur: pcm.length / OUT_RATE };
}

// старое голосовое, которое этот телефон не открывает: раскодировать и переложить в WAV
export async function toWavUrl(src) {
  try {
    const blob = await (await fetch(src)).blob();
    const d = await decodeBlob(blob);
    if (!d) return '';
    return wavUrl(d.f32, d.rate);
  } catch { return ''; }
}
// звук → WAV-ссылка (для прослушивания записи перед отправкой)
export function wavUrl(f32, rate) {
  try {
    const pcm = resample(f32, rate);
    const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, OUT_RATE, true); v.setUint32(28, OUT_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i += 1) v.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(pcm[i] * 32767))), true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  } catch { return ''; }
}

export const blobToDataUrl = (blob) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(''); fr.readAsDataURL(blob); });
