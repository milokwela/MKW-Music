// Голосовые сообщения. Раньше каждый телефон записывал в своём формате (Android — webm/mp4-фрагменты,
// iPhone — m4a), и часть голосовых не играла на других телефонах. Теперь пишем звук сами
// и кодируем в MP3 — его понимают все телефоны, планшеты и компьютеры.
import { VERSION } from './changelog.js';

const AC = () => window.AudioContext || window.webkitAudioContext;
const OUT_RATE = 44100; // частота для прослушивания записи перед отправкой (WAV)
export const VOICE_BUDGET = 390000;      // байт MP3: под новые правила (до 560 000 символов в сообщении)
export const VOICE_BUDGET_SAFE = 286000; // байт MP3: старые правила (до 400 000 символов) — запасной вариант

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

// Один AudioContext на устройство. Его нужно создать/разбудить прямо в касании кнопки,
// иначе iPhone и часть Android-браузеров оставляют его «спящим», и звук вообще не записывается.
let primed = null;
export function primeAudio() {
  const C = AC();
  if (!C) return null;
  try {
    if (!primed || primed.state === 'closed') primed = new C();
  } catch { return null; }
  try { primed.resume(); } catch { /* ignore */ }
  return primed;
}

// Захват звука с микрофона. AudioWorklet не роняет кадры и не «булькает», как старый ScriptProcessor.
// Если Worklet недоступен — остаётся ScriptProcessor. В обоих случаях пишем сырой звук, без «телефонной» обработки.
const workletMod = new WeakMap(); // AudioContext → промис загрузки модуля: регистрировать «mkw-rec» дважды нельзя
export function pcmCapture(acIn) {
  const C = AC();
  if (!C) return null;
  let ac = acIn && acIn.state !== 'closed' ? acIn : null;
  if (!ac) {
    try { ac = new C(); } catch { return null; }
  }
  try { ac.resume(); } catch { /* ignore */ }
  const cap = { ac, chunks: [], len: 0, rate: ac.sampleRate, ok: false, own: !acIn, dead: false };
  const push = (d) => {
    if (cap.dead || !d || !d.length) return;
    cap.chunks.push(new Float32Array(d)); cap.len += d.length;
  };
  cap.attach = (stream) => {
    let src;
    try { src = ac.createMediaStreamSource(stream); } catch { return Promise.resolve(false); }
    cap.src = src;
    const mute = ac.createGain(); mute.gain.value = 0;
    cap.mute = mute;
    const script = () => {
      try {
        const node = ac.createScriptProcessor(4096, 1, 1);
        node.onaudioprocess = (e) => {
          push(e.inputBuffer.getChannelData(0));
          try { e.outputBuffer.getChannelData(0).fill(0); } catch { /* ignore */ }
        };
        src.connect(node); node.connect(mute); mute.connect(ac.destination);
        cap.node = node; cap.ok = true;
        return true;
      } catch { return false; }
    };
    const ready = (async () => {
      try {
        if (ac.audioWorklet && window.AudioWorkletNode) {
          // копим звук небольшими порциями (1024 сэмпла): меньше сообщений между потоками — меньше нагрузки на телефон.
          // Модуль грузим один раз на AudioContext: повторная регистрация имени роняла бы захват в ScriptProcessor.
          let mod = workletMod.get(ac);
          if (!mod) {
            const code = "class MkwRec extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(1024);this.n=0}process(i){const c=i[0];if(c&&c[0]){const d=c[0];let o=0;while(o<d.length){const k=Math.min(d.length-o,1024-this.n);this.b.set(d.subarray(o,o+k),this.n);this.n+=k;o+=k;if(this.n===1024){this.port.postMessage(this.b);this.b=new Float32Array(1024);this.n=0}}}return true}}registerProcessor('mkw-rec',MkwRec);";
            const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
            mod = ac.audioWorklet.addModule(url).finally(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } });
            workletMod.set(ac, mod);
          }
          await mod;
          const node = new AudioWorkletNode(ac, 'mkw-rec');
          node.port.onmessage = (e) => push(e.data);
          src.connect(node); node.connect(mute); mute.connect(ac.destination);
          cap.node = node; cap.port = node.port; cap.ok = true;
          if (ac.state === 'suspended') ac.resume().catch(() => {});
          return true;
        }
      } catch { /* ниже — запасной захват */ }
      return script();
    })();
    cap.ready = ready;
    return ready;
  };
  cap.stop = () => {
    cap.dead = true;
    try {
      if (cap.src) cap.src.disconnect();
      if (cap.node) {
        if ('onaudioprocess' in cap.node) cap.node.onaudioprocess = null;
        cap.node.disconnect();
      }
      if (cap.port) cap.port.close();
      if (cap.mute) cap.mute.disconnect();
    } catch { /* ignore */ }
    if (cap.own) { try { ac.close(); } catch { /* ignore */ } }
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

// Качество под длину записи. Короткие голосовые — 112 кбит/с и 44,1 кГц, дальше плавно снижаем,
// но даже длинные записи не проваливаются в «телефонную трубу» 22 кГц без нужды.
function quality(sec, budget) {
  const tiers = [[112, 44100], [96, 44100], [80, 44100], [64, 44100], [56, 32000], [48, 32000], [40, 24000], [32, 22050]];
  return tiers.find(([k]) => (k * 1000 / 8) * (sec + 0.25) <= budget) || tiers[tiers.length - 1];
}
// чистая обработка голоса: убираем гул ниже 70 Гц, чуть поднимаем разборчивость на 3 кГц,
// выравниваем громкость компрессором и мягким лимитером, а не грубым умножением на 6.
async function master(f32, rate, outRate) {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OC) return null;
  try {
    const n = Math.max(1, Math.ceil(f32.length * outRate / rate));
    const oc = new OC(1, n, outRate);
    const buf = oc.createBuffer(1, f32.length, rate);
    buf.getChannelData(0).set(f32);
    const src = oc.createBufferSource(); src.buffer = buf;
    const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70; hp.Q.value = 0.7;
    const eq = oc.createBiquadFilter(); eq.type = 'peaking'; eq.frequency.value = 3200; eq.Q.value = 0.9; eq.gain.value = 2.4;
    const cmp = oc.createDynamicsCompressor();
    cmp.threshold.value = -20; cmp.knee.value = 10; cmp.ratio.value = 3; cmp.attack.value = 0.004; cmp.release.value = 0.18;
    const lim = oc.createDynamicsCompressor();
    lim.threshold.value = -2; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.06;
    src.connect(hp); hp.connect(eq); eq.connect(cmp); cmp.connect(lim); lim.connect(oc.destination);
    src.start(0);
    const out = await oc.startRendering();
    return out.getChannelData(0);
  } catch { return null; }
}
function resampleTo(f32, rate, outRate) {
  if (Math.abs(rate - outRate) < 1) return f32;
  const ratio = rate / outRate;
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
export async function encodeMp3(f32, rate, budget = VOICE_BUDGET) {
  if (!f32 || !f32.length) return null;
  const [KB, RATE] = quality(f32.length / rate, budget);
  let pcm = await master(f32, rate, RATE);
  if (!pcm) pcm = resampleTo(f32, rate, RATE);
  else pcm = new Float32Array(pcm);
  // срезаем тишину в начале и конце, оставляя 60 мс воздуха — голос начинается сразу, без «мёртвой» секунды
  const th = 0.008;
  let a = 0, b = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]) < th) a += 1;
  while (b > a && Math.abs(pcm[b]) < th) b -= 1;
  if (b - a > RATE * 0.4) {
    const pad = Math.floor(RATE * 0.06);
    a = Math.max(0, a - pad); b = Math.min(pcm.length - 1, b + pad);
    pcm = pcm.subarray(a, b + 1);
  }
  // срезаем щелчок в начале и конце
  const edge = Math.min(Math.floor(RATE * 0.025), Math.floor(pcm.length / 10));
  for (let i = 0; i < edge; i += 1) { const k = i / edge; pcm[i] *= k; pcm[pcm.length - 1 - i] *= k; }
  let peak = 0, sum = 0;
  for (let i = 0; i < pcm.length; i += 1) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; sum += v * v; }
  if (peak < 0.003) return null;
  // выравниваем по средней громкости, но не даём пикам захрипеть и не раздуваем шум в тишине
  const rms = Math.sqrt(sum / pcm.length) || 0.0001;
  const g = Math.min(8, 0.14 / rms, 0.97 / peak);
  const s16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) s16[i] = Math.max(-32767, Math.min(32767, Math.round(pcm[i] * g * 32767)));
  const lame = await loadLame();
  const enc = new lame.Mp3Encoder(1, RATE, KB);
  const parts = [];
  const STEP = 1152;
  for (let i = 0; i < s16.length; i += STEP * 40) {
    const end = Math.min(s16.length, i + STEP * 40);
    for (let k = i; k < end; k += STEP) { const b2 = enc.encodeBuffer(s16.subarray(k, Math.min(end, k + STEP))); if (b2.length) parts.push(new Uint8Array(b2)); }
    await new Promise((r) => setTimeout(r, 0)); // не подвешиваем экран
  }
  const f = enc.flush();
  if (f.length) parts.push(new Uint8Array(f));
  return { blob: new Blob(parts, { type: 'audio/mpeg' }), dur: pcm.length / RATE };
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
