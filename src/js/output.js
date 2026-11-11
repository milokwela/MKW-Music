// Android-приложение: «Подключить устройство» — куда идёт звук, громкость телефона, заряд наушников,
// поиск и подключение Bluetooth. Работает только внутри приложения (window.MKWNative); на сайте кнопки нет.
import { $, h, icon, openSheet, isSheetOpen, toast } from './ui.js';
import { showOutPanel, hideOutPanel } from './player2.js';
import { mi } from './icons2.js';

const KIND = { bt: 'Bluetooth', wired: 'Проводные наушники', phone: 'Динамик телефона' };
export const hasOutput = () => Boolean(window.MKWNative);

// уровень сигнала (дБм) → 1–4 полоски
const bars = (rssi) => { const n = rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -82 ? 2 : 1; return h('span', { class: 'out-sig', title: 'Уровень сигнала', 'aria-label': `Сигнал ${n} из 4` }, [1, 2, 3, 4].map((k) => h('i', { class: k <= n ? 'on' : '' }))); };
const batPill = (v) => h('span', { class: `out-bat${v <= 20 ? ' low' : ''}`, title: 'Заряд устройства' }, h('i', { style: `--v:${v}%` }), `${v}%`);

// панель живёт в большом плеере на месте обложки (см. player2.js); вне плеера — обычная шторка
let closeCur = null;
export function openOutput() {
  const n = window.MKWNative;
  if (!n) return;
  const fp = $('#full-player');
  const inStage = Boolean(fp && fp.classList.contains('open') && document.getElementById('fp-stage'));
  if (inStage && fp.classList.contains('out-on')) { hideOutPanel(); return; }
  if (closeCur) closeCur();
  const canBt = typeof n.btScan === 'function';
  const name = h('b', { text: 'Этот телефон' });
  const sub = h('small', { text: KIND.phone });
  const side = h('div', { class: 'out-side' });
  const pct = h('span', { class: 'out-pct', text: '' });

  // Ползунок громкости: линия и кружок двигаются вместе с пальцем, без рывков и отставания.
  const range = h('div', { class: 'out-sl', role: 'slider', tabindex: '0', 'aria-label': 'Громкость телефона', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    h('i', { class: 'out-sl-fill' }), h('b', { class: 'out-sl-th' }));
  let val = 50, dragging = 0, down = false, sentAt = 0, sendT = 0;
  const fill = () => { range.style.setProperty('--v', String(val / 100)); range.setAttribute('aria-valuenow', String(val)); pct.textContent = `${val}%`; volIc.classList.toggle('mute', val === 0); };
  const push = () => { sentAt = Date.now(); n.setVolume(val / 100, false); };
  const send = (now) => { clearTimeout(sendT); if (now || Date.now() - sentAt > 70) push(); else sendT = setTimeout(push, 70); }; // телефону хватает ~14 команд в секунду
  const fromX = (x) => { const r = range.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left - 9) / Math.max(1, r.width - 18))) * 100); };
  const move = (e) => { const v = fromX(e.clientX); dragging = Date.now(); if (v === val) return; val = v; fill(); send(false); };
  range.addEventListener('pointerdown', (e) => { down = true; range.classList.add('drag'); try { range.setPointerCapture(e.pointerId); } catch { /* ignore */ } move(e); e.preventDefault(); });
  range.addEventListener('pointermove', (e) => { if (down) move(e); });
  const up = () => { if (!down) return; down = false; range.classList.remove('drag'); dragging = Date.now(); send(true); };
  range.addEventListener('pointerup', up); range.addEventListener('pointercancel', up);
  for (const ev of ['touchstart', 'touchmove']) range.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }); // плеер и шторка не должны ехать вместе с ползунком
  range.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0; if (!d) return; e.preventDefault(); val = Math.max(0, Math.min(100, val + d)); dragging = Date.now(); fill(); send(true); });
  const volIc = h('span', { class: 'out-vic' }, mi('volume'));
  volIc.addEventListener('click', () => { val = val ? 0 : 40; dragging = Date.now(); fill(); send(true); });

  const ico = h('span', { class: 'out-ico' }, h('i'), mi('headphones'));
  const x = inStage ? h('button', { class: 'out-x', type: 'button', 'aria-label': 'Закрыть', onclick: () => hideOutPanel() }, icon('close')) : null;
  const hero = h('div', { class: 'out-hero' },
    h('div', { class: 'out-top' }, ico, h('div', { class: 'out-name' }, name, sub), side, x),
    h('div', { class: 'out-vl' }, h('span', { text: 'Громкость' }), pct),
    h('div', { class: 'out-volrow' }, volIc, range));
  const swBtn = h('button', { class: 'out-btn', type: 'button', hidden: '' }, mi('swap'), h('span', { text: 'Сменить или отключить' }));
  swBtn.addEventListener('click', () => (n.outputSwitch ? n.outputSwitch() : n.bluetooth()));

  const list = h('div', { class: 'out-list' });
  const rows = new Map(); // адрес устройства → его строка
  const known = h('div', { class: 'out-list' });
  const knownBox = h('details', { class: 'out-known', hidden: '' }, h('summary', {}, h('span', { text: 'Знакомые устройства' }), h('em')), known);
  const note = h('p', { class: 'out-note', hidden: '' });
  const scanBtn = h('button', { class: 'out-scan', type: 'button', 'aria-label': 'Искать снова' }, mi('refresh'));
  const state = h('span', { class: 'out-state', text: '' });
  const head = h('div', { class: 'out-h' }, h('span', { text: 'Рядом сейчас' }), state, scanBtn);
  const act = h('button', { class: 'out-btn hi', type: 'button', hidden: '' });
  const sysBtn = h('button', { class: 'out-link', type: 'button' }, 'Настройки Bluetooth телефона');
  sysBtn.addEventListener('click', () => n.bluetooth());
  scanBtn.addEventListener('click', () => { scanBtn.classList.add('spin'); n.btScan(); });
  let actFn = null, autoScan = false, connRssi = null, lastAudio = {};
  act.addEventListener('click', () => { if (actFn) actFn(); });

  const paintSide = () => {
    const s = lastAudio, bt = s.kind === 'bt';
    side.replaceChildren(...[bt && typeof s.bat === 'number' && s.bat >= 0 ? batPill(s.bat) : null, bt && typeof connRssi === 'number' ? bars(connRssi) : null].filter(Boolean));
  };
  const onAudio = (e) => {
    const s = e.detail || {}; lastAudio = s;
    const bt = s.kind === 'bt';
    name.textContent = s.kind !== 'phone' && s.name ? s.name : (s.kind === 'wired' ? 'Наушники' : 'Этот телефон');
    // заряд наушников или колонки — прямо под названием (если устройство его сообщает)
    sub.textContent = `${KIND[s.kind] || KIND.phone}${bt && typeof s.bat === 'number' && s.bat >= 0 ? ` · заряд ${s.bat}%` : bt ? ' · заряд не сообщает' : ''}`;
    ico.classList.toggle('live', bt || s.kind === 'wired');
    paintSide();
    swBtn.hidden = s.kind === 'phone';
    if (!down && Date.now() - dragging > 1600 && typeof s.vol === 'number') { const v = Math.round(s.vol * 100); if (v !== val) { val = v; fill(); } }
  };
  const mkRow = (d) => {
    const el = h('button', { class: 'out-dev new', type: 'button' });
    const r = { el, d, ico: h('span', { class: 'out-dico' }), nm: h('b'), st: h('small'), extra: h('span', { class: 'out-dx' }), sig: '' };
    el.append(r.ico, h('span', { class: 'out-dname' }, r.nm, r.st), r.extra);
    el.addEventListener('animationend', () => el.classList.remove('new'), { once: true });
    el.addEventListener('click', () => { if (r.d.connected) { toast('Уже подключено'); return; } el.classList.add('wait'); r.st.textContent = 'Подключаем…'; n.btPair(r.d.a); });
    rows.set(d.a, r);
    return r;
  };
  const place = (box, els) => { els.forEach((el, k) => { if (box.children[k] !== el) box.insertBefore(el, box.children[k] || null); }); for (const c of [...box.children]) if (!els.includes(c)) c.remove(); };
  const onBt = (e) => {
    const s = e.detail || {};
    const scanning = Boolean(s.scanning);
    scanBtn.classList.toggle('spin', scanning);
    scanBtn.hidden = !s.supported || !s.has || !s.perm || s.on === false;
    state.textContent = scanning ? 'ищем…' : '';
    // чего не хватает, чтобы искать: разрешения или самого Bluetooth
    if (!s.has) { act.hidden = true; note.hidden = false; note.textContent = 'В этом телефоне нет Bluetooth.'; }
    else if (s.supported && !s.perm) { act.hidden = false; act.replaceChildren(mi('bluetooth'), h('span', { text: 'Разрешить и найти устройства' })); actFn = () => n.btScan(); note.hidden = false; note.textContent = 'Android спросит разрешение «Устройства поблизости». Оно нужно только для поиска, подключения и показа заряда. Геолокация не используется.'; }
    else if (s.on === false) { act.hidden = false; act.replaceChildren(mi('bluetooth'), h('span', { text: 'Включить Bluetooth' })); actFn = () => (n.btEnable ? n.btEnable() : n.bluetooth()); note.hidden = false; note.textContent = 'Bluetooth выключен. Нажмите — телефон спросит и включит его.'; autoScan = false; }
    else { act.hidden = true; note.hidden = true; if (!autoScan && s.supported) { autoScan = true; n.btScan(); } }
    const devs = (s.devices || []).filter((d) => d.n);
    const conn = devs.find((d) => d.connected);
    connRssi = conn && typeof conn.rssi === 'number' ? conn.rssi : null; paintSide();
    // «рядом» — то, что подключено или прямо сейчас отвечает на поиск; остальные знакомые — отдельным списком
    const near = devs.filter((d) => d.connected || typeof d.rssi === 'number').sort((a, b) => (b.connected - a.connected) || ((b.rssi || -200) - (a.rssi || -200)));
    const old = devs.filter((d) => !near.includes(d) && d.bonded);
    const paint = (d) => {
      const st = d.connected ? 'Подключено' : d.bonding ? 'Подключаем…' : d.bonded ? (typeof d.rssi === 'number' ? 'Рядом · нажмите, чтобы подключить' : 'Нажмите, чтобы подключить') : 'Новое · нажмите, чтобы подключить';
      const r = rows.get(d.a) || mkRow(d);
      r.d = d;
      r.el.classList.toggle('on', Boolean(d.connected));
      if (d.connected || !d.bonding) r.el.classList.remove('wait');
      if (r.nm.textContent !== d.n) r.nm.textContent = d.n;
      if (!r.el.classList.contains('wait') && r.st.textContent !== st) r.st.textContent = st;
      const ic = d.audio ? 'headphones' : 'bluetooth';
      if (r.icon !== ic) { r.icon = ic; r.ico.replaceChildren(mi(ic)); }
      const sig = `${d.connected && d.bat >= 0 ? d.bat : ''}|${typeof d.rssi === 'number' ? (d.rssi > -60 ? 4 : d.rssi > -70 ? 3 : d.rssi > -82 ? 2 : 1) : ''}`;
      if (r.sig !== sig) { r.sig = sig; r.extra.replaceChildren(...[d.connected && d.bat >= 0 ? batPill(d.bat) : null, typeof d.rssi === 'number' ? bars(d.rssi) : null].filter(Boolean)); }
      return r.el;
    };
    const nearEls = near.map(paint), oldEls = old.map(paint);
    for (const [a, r] of rows) if (!nearEls.includes(r.el) && !oldEls.includes(r.el)) { r.el.remove(); rows.delete(a); }
    place(list, nearEls); place(known, oldEls);
    knownBox.hidden = !old.length; knownBox.querySelector('em').textContent = String(old.length);
    head.hidden = !canBt || !s.has;
    if (s.has && s.perm && s.on !== false && !near.length) { note.hidden = false; note.textContent = scanning ? 'Ищем наушники, колонки и машины рядом…' : 'Рядом никого не видно. Включите на устройстве режим подключения и нажмите «обновить».'; }
  };
  const onFail = () => toast('Отсюда подключить не получилось — откройте «Настройки Bluetooth телефона»');
  window.addEventListener('mkw-audio', onAudio);
  window.addEventListener('mkw-bt', onBt);
  window.addEventListener('mkw-bt-fail', onFail);

  const body = h('div', { class: `pw-form out${inStage ? ' in-stage' : ''}` }, hero, swBtn,
    ...(canBt ? [head, act, list, note, knownBox] : [h('p', { class: 'out-note', text: 'Новые наушники, колонку или машину подключите в настройках Bluetooth телефона — звук MKW сразу пойдёт туда.' })]),
    sysBtn);
  if (inStage) showOutPanel(body); else openSheet('Подключить устройство', body);
  fill();
  n.audio();
  if (canBt) n.btState();
  // пока панель открыта, следим за громкостью, зарядом и подключением
  const alive = () => body.isConnected && (inStage ? fp.classList.contains('out-on') && fp.classList.contains('open') : isSheetOpen());
  let k = 0;
  const stop = () => {
    clearInterval(t); closeCur = null;
    window.removeEventListener('mkw-audio', onAudio); window.removeEventListener('mkw-bt', onBt); window.removeEventListener('mkw-bt-fail', onFail);
    if (canBt) n.btStop();
  };
  const t = setInterval(() => {
    if (!alive()) { stop(); return; }
    n.audio();
    if (canBt && (k++ % 2 === 1)) n.btState();
  }, 1500);
  closeCur = stop;
}
