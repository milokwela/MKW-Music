// Android-приложение: «Подключить устройство» — куда идёт звук, громкость телефона, заряд наушников,
// поиск и подключение Bluetooth. Работает только внутри приложения (window.MKWNative); на сайте кнопки нет.
import { h, openSheet, isSheetOpen, toast } from './ui.js';
import { mi } from './icons2.js';

const KIND = { bt: 'Bluetooth', wired: 'Проводные наушники', phone: 'Динамик телефона' };
export const hasOutput = () => Boolean(window.MKWNative);

// уровень сигнала (дБм) → 1–4 полоски
const bars = (rssi) => { const n = rssi > -60 ? 4 : rssi > -70 ? 3 : rssi > -82 ? 2 : 1; return h('span', { class: 'out-sig', title: 'Уровень сигнала', 'aria-label': `Сигнал ${n} из 4` }, [1, 2, 3, 4].map((k) => h('i', { class: k <= n ? 'on' : '' }))); };
const batPill = (v) => h('span', { class: `out-bat${v <= 20 ? ' low' : ''}`, title: 'Заряд устройства' }, h('i', { style: `--v:${v}%` }), `${v}%`);

export function openOutput() {
  const n = window.MKWNative;
  if (!n) return;
  const canBt = typeof n.btScan === 'function';
  const name = h('b', { text: 'Этот телефон' });
  const sub = h('small', { text: KIND.phone });
  const side = h('div', { class: 'out-side' });
  const pct = h('span', { text: '' });
  // Свой тонкий ползунок (как полоса в плеере): линия и метка двигаются вместе с пальцем, без рывков и отставания.
  const range = h('div', { class: 'out-sl', role: 'slider', tabindex: '0', 'aria-label': 'Громкость телефона', 'aria-valuemin': '0', 'aria-valuemax': '100' },
    h('i', { class: 'out-sl-fill' }), h('b', { class: 'out-sl-th' }));
  let val = 50, dragging = 0, down = false, sentAt = 0, sendT = 0;
  const fill = () => { range.style.setProperty('--v', String(val / 100)); range.setAttribute('aria-valuenow', String(val)); pct.textContent = `${val}%`; };
  const push = () => { sentAt = Date.now(); n.setVolume(val / 100, false); };
  const send = (now) => { clearTimeout(sendT); if (now || Date.now() - sentAt > 70) push(); else sendT = setTimeout(push, 70); }; // телефону хватает ~14 команд в секунду
  const fromX = (x) => { const r = range.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left - 2) / Math.max(1, r.width - 4))) * 100); };
  const move = (e) => { const v = fromX(e.clientX); dragging = Date.now(); if (v === val) return; val = v; fill(); send(false); };
  range.addEventListener('pointerdown', (e) => { down = true; range.classList.add('drag'); try { range.setPointerCapture(e.pointerId); } catch { /* ignore */ } move(e); e.preventDefault(); });
  range.addEventListener('pointermove', (e) => { if (down) move(e); });
  const up = () => { if (!down) return; down = false; range.classList.remove('drag'); dragging = Date.now(); send(true); };
  range.addEventListener('pointerup', up); range.addEventListener('pointercancel', up);
  for (const ev of ['touchstart', 'touchmove']) range.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }); // шторка не должна ехать вместе с ползунком
  range.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0; if (!d) return; e.preventDefault(); val = Math.max(0, Math.min(100, val + d)); dragging = Date.now(); fill(); send(true); });
  const ico = h('span', { class: 'out-ico' }, h('i'), mi('headphones'));
  const hero = h('div', { class: 'out-hero' },
    h('div', { class: 'out-top' }, ico, h('div', { class: 'out-name' }, name, sub), side),
    h('div', { class: 'out-vol' }, h('span', { text: 'Громкость телефона' }), pct),
    range);
  const swBtn = h('button', { class: 'btn tonal block', type: 'button' }, 'Сменить или отключить устройство');
  swBtn.addEventListener('click', () => (n.outputSwitch ? n.outputSwitch() : n.bluetooth()));

  const list = h('div', { class: 'out-list' });
  const rows = new Map(); // адрес устройства → его строка
  const scanBtn = h('button', { class: 'btn block', type: 'button' }, 'Найти устройства рядом');
  const hint = h('p', { class: 'profile-note out-hint', text: 'Чтобы найти наушники, колонку или машину, Android спросит разрешение «Устройства поблизости». Оно нужно только для поиска, подключения и показа заряда. Геолокация не используется.' });
  const sysBtn = h('button', { class: 'btn tonal block', type: 'button' }, 'Настройки Bluetooth телефона');
  sysBtn.addEventListener('click', () => n.bluetooth());
  scanBtn.addEventListener('click', () => { scanBtn.disabled = true; scanBtn.textContent = 'Ищем…'; n.btScan(); });

  const onAudio = (e) => {
    const s = e.detail || {};
    const bt = s.kind === 'bt';
    name.textContent = s.kind !== 'phone' && s.name ? s.name : (s.kind === 'wired' ? 'Наушники' : 'Этот телефон');
    sub.textContent = KIND[s.kind] || KIND.phone;
    ico.classList.toggle('live', bt || s.kind === 'wired');
    side.replaceChildren(...(bt && typeof s.bat === 'number' && s.bat >= 0 ? [batPill(s.bat)] : []));
    swBtn.hidden = s.kind === 'phone';
    if (!down && Date.now() - dragging > 1600 && typeof s.vol === 'number') { const v = Math.round(s.vol * 100); if (v !== val) { val = v; fill(); } }
  };
  const onBt = (e) => {
    const s = e.detail || {};
    const scanning = Boolean(s.scanning);
    scanBtn.disabled = scanning;
    scanBtn.textContent = scanning ? 'Ищем…' : 'Найти устройства рядом';
    scanBtn.classList.toggle('busy', scanning);
    scanBtn.hidden = !s.supported || !s.has;
    hint.hidden = Boolean(s.perm) || !s.supported;
    if (s.perm && s.has && s.on === false) { list.replaceChildren(h('p', { class: 'profile-note', text: 'Bluetooth выключен. Включите его в шторке телефона и нажмите «Найти устройства рядом».' })); return; }
    const devs = (s.devices || []).filter((d) => d.n).sort((a, b) => (b.connected - a.connected) || (b.audio - a.audio) || (b.bonded - a.bonded) || ((b.rssi || -200) - (a.rssi || -200)));
    // Строки не пересоздаём при каждом ответе телефона: иначе во время поиска весь список мигает и «прыгает».
    // Появляется с анимацией только новое устройство, остальные просто обновляют подпись, заряд и сигнал.
    let fresh = 0;
    const rowsNow = devs.map((d) => {
      const st = d.connected ? 'Подключено' : d.bonding ? 'Подключаем…' : d.bonded ? 'Знакомое устройство' : 'Новое — нажмите, чтобы подключить';
      let r = rows.get(d.a);
      if (!r) {
        const el = h('button', { class: 'out-dev new', type: 'button', style: `--i:${fresh++}` });
        r = { el, d, ico: h('span', { class: 'out-dico' }), nm: h('b'), st: h('small'), extra: h('span', { class: 'out-dx' }), sig: '' };
        el.append(r.ico, h('span', { class: 'out-dname' }, r.nm, r.st), r.extra);
        el.addEventListener('animationend', () => el.classList.remove('new'), { once: true });
        el.addEventListener('click', () => { if (r.d.connected) { toast('Уже подключено'); return; } el.classList.add('wait'); n.btPair(r.d.a); });
        rows.set(d.a, r);
      }
      r.d = d;
      r.el.classList.toggle('on', Boolean(d.connected));
      if (d.connected || !d.bonding) r.el.classList.remove('wait');
      if (r.nm.textContent !== d.n) r.nm.textContent = d.n;
      if (r.st.textContent !== st) r.st.textContent = st;
      const icon = d.audio ? 'headphones' : 'phone';
      if (r.icon !== icon) { r.icon = icon; r.ico.replaceChildren(mi(icon)); }
      const sig = `${d.connected && d.bat >= 0 ? d.bat : ''}|${typeof d.rssi === 'number' ? (d.rssi > -60 ? 4 : d.rssi > -70 ? 3 : d.rssi > -82 ? 2 : 1) : ''}`;
      if (r.sig !== sig) { r.sig = sig; r.extra.replaceChildren(...[d.connected && d.bat >= 0 ? batPill(d.bat) : null, typeof d.rssi === 'number' ? bars(d.rssi) : null].filter(Boolean)); }
      return r.el;
    });
    for (const [a, r] of rows) if (!rowsNow.includes(r.el)) { r.el.remove(); rows.delete(a); }
    rowsNow.forEach((el, k) => { if (list.children[k] !== el) list.insertBefore(el, list.children[k] || null); });
    for (const c of [...list.children]) if (!rowsNow.includes(c)) c.remove();
  };
  const onFail = () => toast('Отсюда подключить не получилось — откройте «Настройки Bluetooth телефона»');
  window.addEventListener('mkw-audio', onAudio);
  window.addEventListener('mkw-bt', onBt);
  window.addEventListener('mkw-bt-fail', onFail);

  const body = h('div', { class: 'pw-form out' }, hero, swBtn,
    ...(canBt ? [h('div', { class: 'out-h', text: 'Bluetooth' }), list, scanBtn, hint] : [h('p', { class: 'profile-note', text: 'Новые наушники, колонку или машину подключите в настройках Bluetooth телефона — звук MKW сразу пойдёт туда.' })]),
    sysBtn);
  openSheet('Подключить устройство', body);
  fill();
  n.audio();
  if (canBt) n.btState();
  // пока окно открыто, следим за громкостью, зарядом и подключением
  const t = setInterval(() => {
    if (!isSheetOpen() || !body.isConnected) {
      clearInterval(t);
      window.removeEventListener('mkw-audio', onAudio); window.removeEventListener('mkw-bt', onBt); window.removeEventListener('mkw-bt-fail', onFail);
      if (canBt) n.btStop();
      return;
    }
    n.audio();
  }, 1500);
}
