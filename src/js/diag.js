// «Проверка устройства» (О MKW): 10 минут, 5 этапов по 2 минуты. Ищет, ЧТО именно греет телефон и вызывает фризы:
//   1) покой — MKW открыт, музыка не играет;
//   2) музыка — играет трек, экран не трогаем;
//   3) музыка + лёгкая графика — то же, но без эффектов;
//   4) музыка + прокрутка — приложение само листает экран, как при обычном использовании;
//   5) остывание — без музыки, без эффектов.
// Каждые 5 секунд: температура батареи и процессора, частоты процессора (их сброс = троттлинг), сила процессора
// (короткий замер скорости), кадры в секунду, фризы (страница «замерла» дольше 0,7 с), свободная память.
// Сравнивая этапы, проверка понимает: греет музыка, графика, прокрутка или телефон греется сам по себе.
// Итог показывается человеку и уходит разработчику в «Сообщения» (как сообщение об ошибке с таблицей этапов).
import { h, toast, openSheet, closeSheet } from './ui.js';
import { mi } from './icons2.js';
import * as player from './player.js';
import { quality, qualityMode, setQualityMode } from './quality.js';
import { sendDiag, envInfo } from './feedback.js';

const PHASES = [
  { id: 'idle', name: 'Покой', hint: 'MKW открыт, музыка не играет. Просто держите телефон как обычно.' },
  { id: 'music', name: 'Музыка', hint: 'Играет музыка, экран не трогайте.' },
  { id: 'lite', name: 'Музыка + лёгкая графика', hint: 'Играет музыка, эффекты выключены.' },
  { id: 'scroll', name: 'Музыка + прокрутка', hint: 'MKW сам листает экран, как будто вы им пользуетесь.' },
  { id: 'cool', name: 'Остывание', hint: 'Музыка выключена, эффектов нет.' },
];
const PHASE_MS = (() => { try { return Number(localStorage.getItem('mkw.dg.ms')) || 120000; } catch { return 120000; } })(); // для отладки можно укоротить
const STEP_MS = 5000;
const app = () => /MKWApp\//.test(navigator.userAgent) && window.MKWNative;

// ---------- замеры ----------

let nativeWait = null;
function nativeSnap() {
  const n = app();
  if (!n || !n.diag) return Promise.resolve(null);
  return new Promise((res) => {
    const t = setTimeout(() => { nativeWait = null; res(null); }, 1500);
    nativeWait = (o) => { clearTimeout(t); nativeWait = null; res(o); };
    try { n.diag(); } catch { clearTimeout(t); res(null); }
  });
}
window.__mkwDiag = (o) => { if (nativeWait) nativeWait(o); };

/** Сколько «работы» процессор успевает за 40 мс. Если число падает — телефон сбросил частоты из-за нагрева. */
function cpuScore() {
  const t0 = performance.now();
  let n = 0, x = 0;
  while (performance.now() - t0 < 40) { for (let i = 0; i < 2000; i++) x += Math.sqrt(i * n + 1); n++; }
  return x === -1 ? 0 : n; // x нужен, чтобы браузер не выбросил цикл
}
/** Кадров в секунду за 1 секунду (меряем коротко, чтобы сам замер не грел телефон). */
function fps() {
  return new Promise((res) => {
    let f = 0; const t0 = performance.now();
    const step = (t) => { f++; if (t - t0 < 1000) requestAnimationFrame(step); else res(Math.round((f * 1000) / (t - t0))); };
    requestAnimationFrame(step);
  });
}

// ---------- прокрутка для этапа 4 ----------

function scroller() {
  const cands = [document.scrollingElement, ...document.querySelectorAll('#app .view:not([hidden]), #app main, #app [data-scroll]')];
  return cands.find((e) => e && e.scrollHeight > e.clientHeight + 200) || document.scrollingElement;
}
let scrollRaf = 0, scrollDir = 1;
function startScroll() {
  const el = scroller();
  let last = performance.now();
  const tick = (t) => {
    const dt = Math.min(50, t - last); last = t;
    el.scrollTop += scrollDir * dt * 0.9;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) scrollDir = -1;
    else if (el.scrollTop <= 0) scrollDir = 1;
    scrollRaf = requestAnimationFrame(tick);
  };
  scrollRaf = requestAnimationFrame(tick);
}
function stopScroll() { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }

// ---------- музыка ----------

async function ensureMusic() {
  if (player.st.playing) return true;
  if (player.queue.current) { player.toggle(); }
  else { try { const w = await import('./wave.js'); await w.startWave(); } catch { /* ниже проверим */ } }
  await new Promise((r) => setTimeout(r, 6000));
  closePlayer();
  return player.st.playing;
}

// большой плеер закрываем: проверяем обычный экран приложения со списками
function closePlayer() {
  const f = document.querySelector('#full-player.open');
  if (f) { const b = document.getElementById('fp-close'); if (b) b.click(); }
}

// ---------- итог ----------

const r1 = (v) => Math.round(v * 10) / 10;
function summarize(phases, meta) {
  const out = [];
  const rise = (p, k) => (p.samples.length > 3 && p.samples[0][k] && p.samples[p.samples.length - 1][k] ? (p.samples[p.samples.length - 1][k] - p.samples[0][k]) / 10 / ((p.samples[p.samples.length - 1].t - p.samples[0].t) / 60000) : null);
  const stat = phases.map((p) => {
    const s = p.samples;
    const avg = (k) => { const v = s.map((x) => x[k]).filter((x) => typeof x === 'number' && x >= 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return {
      id: p.id, name: p.name, n: s.length,
      batt0: s[0] && s[0].batt ? s[0].batt / 10 : null, batt1: s.length && s[s.length - 1].batt ? s[s.length - 1].batt / 10 : null,
      cpuT: avg('cpu') !== null && avg('cpu') > 0 ? r1(avg('cpu') / 10) : null, cpuMax: s.reduce((m, x) => Math.max(m, x.cpu || 0), 0) / 10 || null,
      battRise: rise(p, 'batt') !== null ? r1(rise(p, 'batt')) : null, cpuRise: rise(p, 'cpu') !== null ? r1(rise(p, 'cpu')) : null,
      fps: avg('fps') !== null ? Math.round(avg('fps')) : null, score: avg('score'), freq: avg('freq') !== null ? Math.round(avg('freq')) : null, cap: avg('cap') !== null ? Math.round(avg('cap')) : null,
      hz: s.reduce((m, x) => Math.max(m, x.hz || 0), 0) || null,
      freezes: p.freezes, maxGap: Math.round(p.maxGap), paused: Math.round((p.paused || 0) / 1000), longMs: Math.round(p.longMs), free: avg('free') !== null ? Math.round(avg('free')) : null,
    };
  });
  const base = stat[0].score || 1;
  stat.forEach((x) => { x.power = x.score ? Math.round((x.score / base) * 100) : null; delete x.score; });
  const by = Object.fromEntries(stat.map((x) => [x.id, x]));
  const battFlat = stat.every((x) => !x.batt0 || (x.batt0 === stat[0].batt0 && x.batt1 === stat[0].batt0));
  const useCpu = battFlat && stat.some((x) => x.cpuMax);
  const K = useCpu ? 3 : 1;
  const R = (x) => (useCpu ? (x && x.cpuRise !== null ? r1(x.cpuRise / K) : null) : (x && x.battRise !== null ? x.battRise : null));
  const hasTemp = stat.some((x) => x.batt0);
  const verdict = [];
  let tip = null;
  if (meta.charging) verdict.push('Телефон заряжался во время проверки — зарядка сама сильно греет. Для точного результата повторите без зарядки.');
  if (!hasTemp) verdict.push('Температуру прочитать не удалось (нужно приложение 1.5.3 или новее) — итог только по плавности.');
  if (hasTemp) {
    const idle = R(by.idle), music = R(by.music), lite = R(by.lite), scroll = R(by.scroll), cool = R(by.cool);
    const n0 = verdict.length + 1;
    const maxT = Math.max(...stat.map((x) => Math.max(x.batt1 || 0, x.batt0 || 0)));
    verdict.push(`Батарея: от ${stat[0].batt0 ?? '?'} до ${maxT} °C${stat.some((x) => x.cpuMax) ? `, процессор до ${Math.max(...stat.map((x) => x.cpuMax || 0))} °C` : ''}.`);
    if (useCpu) verdict.push('Датчик батареи на этом телефоне не меняется — нагрев оцениваю по процессору.');
    // телефон был горячим ещё до проверки и остывал, пока работал MKW
    const c0 = stat[0].cpuT, cN = stat[stat.length - 1].cpuT;
    if (c0 && cN && c0 >= 65 && c0 - cN >= 5) verdict.push(`Телефон был горячим ещё до начала (процессор ${c0} °C) и за время проверки остыл до ${cN} °C, хотя MKW всё это время работал и играл музыку. Значит, в таком режиме MKW телефон не греет — нагрев был от того, что работало до проверки (игры, зарядка, другие приложения или MKW с более тяжёлой графикой).`);
    if (idle !== null && idle >= 0.8) verdict.push(`Телефон греется даже в покое (+${idle} °C/мин): нагрузку даёт не музыка, а сам MKW на экране или что-то в фоне.`);
    if (music !== null && idle !== null && music - idle >= 0.5) verdict.push(`Включение музыки добавляет нагрев (+${r1(music - idle)} °C/мин к покою) — греет воспроизведение.`);
    if (music !== null && lite !== null && music - lite >= 0.4) { verdict.push(`С лёгкой графикой нагрев заметно меньше (${lite} против ${music} °C/мин) — греют эффекты интерфейса.`); tip = 'lite'; }
    if (scroll !== null && music !== null && scroll - music >= 0.6) verdict.push(`Прокрутка сильно греет (+${scroll} °C/мин) — тяжело рисуются списки.`);
    if (cool !== null && cool > 0.3) verdict.push('Даже без музыки и эффектов телефон продолжал нагреваться — возможно, греет не MKW (зарядка, сеть, другие приложения).');
    if (verdict.length === n0 + (useCpu ? 1 : 0)) verdict.push('Сильного нагрева от MKW проверка не заметила.');
  }
  const pausedS = stat.reduce((s, x) => s + (x.paused || 0), 0);
  if (pausedS >= 10) verdict.push(`Во время проверки MKW сворачивали или гас экран (${pausedS} с) — эти паузы в фризы не засчитаны.`);
  const fr = stat.reduce((s, x) => s + x.freezes, 0);
  if (fr >= 3) {
    const worst = stat.slice().sort((a, b) => b.freezes - a.freezes)[0];
    verdict.push(`Фризы: ${fr} раз (больше всего на этапе «${worst.name}», самый долгий ${worst.maxGap} мс).`);
  } else verdict.push(fr ? `Фризов почти нет (${fr}).` : 'Фризов не было.');
  const minPow = Math.min(...stat.map((x) => x.power || 100));
  const hotEnd = stat.some((x) => (x.batt1 && x.batt1 >= 40) || (x.cpuMax && x.cpuMax >= 80));
  if (minPow < 65 && hotEnd) verdict.push(`Процессор к концу работал на ${minPow}% от начальной силы — телефон сбрасывал частоты из-за нагрева (отсюда и тормоза).`);
  // плавность прокрутки относительно частоты экрана (120 Гц экран должен давать около 120 кадров)
  const sc = stat.find((x) => x.id === 'scroll');
  if (sc && sc.fps && sc.hz && sc.fps < sc.hz * 0.85) verdict.push(`Прокрутка: ${sc.fps} кадров в секунду при экране ${sc.hz} Гц — не дотягивает до частоты экрана.`);
  else if (sc && sc.fps && sc.hz) verdict.push(`Прокрутка плавная: ${sc.fps} кадров при экране ${sc.hz} Гц.`);
  const lowFps = stat.filter((x) => x.fps && x.fps < 40);
  if (lowFps.length) verdict.push(`Мало кадров: ${lowFps.map((x) => `${x.name} — ${x.fps}`).join(', ')} в секунду.`);
  return { stat, verdict, tip };
}

// ---------- окно ----------

let running = null;

export function openDiag() {
  if (running) { toast('Проверка уже идёт'); return; }
  openSheet('Проверка устройства', h('div', { class: 'dg-intro' },
    h('p', { text: 'Проверка за 10 минут найдёт, что именно греет телефон или вызывает тормоза: музыка, эффекты, прокрутка или сам телефон. Итог увидите вы, и он уйдёт разработчику.' }),
    h('ul', {},
      h('li', { text: 'Не сворачивайте MKW и не выключайте экран — он не погаснет сам.' }),
      h('li', { text: 'Лучше без зарядки: она сама греет телефон.' }),
      h('li', { text: 'Можно положить телефон на стол. На втором этапе включится музыка.' })),
    h('button', { class: 'btn block', type: 'button', onclick: () => { closeSheet(); setTimeout(run, 300); } }, mi('play'), ' Начать проверку (10 минут)'),
    h('button', { class: 'btn tonal block', type: 'button', text: 'Не сейчас', onclick: closeSheet })));
}

async function run() {
  const phases = PHASES.map((p) => ({ ...p, samples: [], freezes: 0, maxGap: 0, longMs: 0 }));
  const prevMode = qualityMode();
  const wasPlaying = player.st.playing;
  let stop = false, cur = 0;
  const t0 = Date.now();
  // окошко поверх приложения (само приложение видно — оно и проверяется)
  const title = h('b'), hint = h('small'), live = h('div', { class: 'dg-live' }), bar = h('i');
  const panel = h('div', { class: 'dg-panel' },
    h('div', { class: 'dg-top' }, h('span', { class: 'dg-step' }), title, h('button', { type: 'button', class: 'dg-x', text: 'Остановить', onclick: () => { stop = true; } })),
    hint, h('div', { class: 'dg-bar' }, bar), live);
  document.body.appendChild(panel);
  running = { panel };
  try { const n = app(); if (n && n.keepOn) n.keepOn(true); } catch { /* старое приложение */ }

  // фризы: страница не отвечала дольше 0,7 с
  let lastBeat = performance.now();
  const beat = setInterval(() => {
    const now = performance.now(), gap = now - lastBeat - 250; lastBeat = now;
    const p = phases[cur];
    // приложение свернули или погас экран — это не фриз, а пауза системы
    if (document.hidden || window.__mkwFg === false || gap > 15000) { p.paused = (p.paused || 0) + Math.max(0, gap); return; }
    if (gap > 700) { p.freezes += 1; }
    p.maxGap = Math.max(p.maxGap, gap);
  }, 250);
  let po = null;
  try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) phases[cur].longMs += e.duration; }); po.observe({ type: 'longtask', buffered: false }); } catch { /* нет */ }
  const keepAwake = setInterval(() => { if (cur === 3) window.dispatchEvent(new Event('pointerdown')); }, 5000);

  let meta = { charging: false, nat: null };
  try {
    for (cur = 0; cur < phases.length && !stop; cur++) {
      const p = phases[cur];
      panel.querySelector('.dg-step').textContent = `${cur + 1}/5`;
      title.textContent = p.name; hint.textContent = p.hint;
      // подготовка этапа
      if (p.id === 'idle') { if (player.st.playing) player.pause(); }
      if (p.id === 'music') { const ok = await ensureMusic(); if (!ok) hint.textContent = 'Музыка не включилась — включите любой трек вручную, проверка продолжится.'; }
      if (p.id === 'lite') setQualityMode('1');
      if (p.id === 'scroll') { setQualityMode(prevMode); if (!player.st.playing) await ensureMusic(); closePlayer(); window.dispatchEvent(new Event('pointerdown')); startScroll(); }
      if (p.id === 'cool') { stopScroll(); if (player.st.playing) player.pause(); setQualityMode('0'); }
      const pStart = Date.now();
      while (Date.now() - pStart < PHASE_MS && !stop) {
        const nat = await nativeSnap();
        if (nat) { meta.nat = nat; if (nat.charging) meta.charging = true; }
        const s = { t: Date.now(), score: cpuScore(), fps: await fps(), q: quality(), playing: player.st.playing ? 1 : 0 };
        if (nat) Object.assign(s, { batt: nat.batt, cpu: nat.cpu, freq: nat.freq, cap: nat.cap, free: nat.free, th: nat.thermal, hz: nat.hzNow });
        p.samples.push(s);
        const total = PHASE_MS * PHASES.length, left = total - (Date.now() - t0);
        bar.style.width = `${Math.min(100, ((Date.now() - t0) / total) * 100)}%`;
        live.textContent = [nat && nat.batt ? `батарея ${nat.batt / 10} °C` : '', nat && nat.cpu ? `процессор ${nat.cpu / 10} °C` : '', `${s.fps} кадр/с`, `осталось ${Math.max(0, Math.ceil(left / 60000))} мин`].filter(Boolean).join(' · ');
        await new Promise((r) => setTimeout(r, Math.max(0, STEP_MS - 1100)));
      }
    }
  } finally {
    clearInterval(beat); clearInterval(keepAwake); stopScroll(); if (po) try { po.disconnect(); } catch { /* ignore */ }
    setQualityMode(prevMode);
    if (!wasPlaying && player.st.playing) player.pause();
    try { const n = app(); if (n && n.keepOn) n.keepOn(false); } catch { /* ignore */ }
    panel.remove(); running = null;
  }
  const done = phases.filter((p) => p.samples.length >= 3);
  if (done.length < 2) { toast('Проверка остановлена — слишком мало данных'); return; }
  const res = summarize(done, meta);
  const nat = meta.nat || {};
  const device = { model: nat.model || envInfo().model, maker: nat.maker || '', emui: nat.emui || '', harmony: nat.harmony || '', sdk: nat.sdk || '', gms: nat.gms, wv: nat.wvPkg ? `${nat.wvPkg} ${nat.wvVer}` : '', charging: meta.charging, full: !stop };
  showResult(res, device);
  const text = `Проверка устройства${stop ? ' (остановлена раньше)' : ''}\n${res.verdict.join('\n')}`.slice(0, 2000);
  sendDiag(text, { device, stat: res.stat }).then(() => toast('Итог отправлен разработчику')).catch(() => toast('Итог не отправился разработчику — проверьте интернет'));
}

function showResult(res, device) {
  const row = (x) => h('div', { class: 'dg-tr' },
    h('span', { text: x.name }),
    h('span', { text: x.battRise !== null ? `${x.battRise > 0 ? '+' : ''}${x.battRise}°` : '—' }),
    h('span', { text: x.fps ? `${x.fps}` : '—' }),
    h('span', { class: x.freezes ? 'bad' : '', text: String(x.freezes) }));
  openSheet('Итог проверки', h('div', { class: 'dg-res' },
    h('ul', { class: 'dg-verdict' }, ...res.verdict.map((t) => h('li', { text: t }))),
    h('div', { class: 'dg-table' }, h('div', { class: 'dg-tr head' }, h('span', { text: 'Этап' }), h('span', { text: '°/мин' }), h('span', { text: 'Кадр/с' }), h('span', { text: 'Фризы' })), ...res.stat.map(row)),
    h('p', { class: 'fb-note', text: [device.model, device.emui || device.harmony, device.wv].filter(Boolean).join(' · ') }),
    res.tip === 'lite' ? h('button', { class: 'btn block', type: 'button', onclick: () => { setQualityMode('1'); closeSheet(); toast('Включена лёгкая графика'); } }, 'Включить лёгкую графику') : null,
    h('button', { class: 'btn tonal block', type: 'button', text: 'Готово', onclick: closeSheet })));
}
