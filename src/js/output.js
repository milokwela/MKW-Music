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
  const range = h('input', { class: 'out-range', type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': 'Громкость телефона' });
  let dragging = 0;
  const fill = () => { range.style.setProperty('--v', `${range.value}%`); pct.textContent = `${range.value}%`; };
  range.addEventListener('input', () => { dragging = Date.now(); fill(); n.setVolume(Number(range.value) / 100, false); });
  const ico = h('span', { class: 'out-ico' }, h('i'), mi('headphones'));
  const hero = h('div', { class: 'out-hero' },
    h('div', { class: 'out-top' }, ico, h('div', { class: 'out-name' }, name, sub), side),
    h('div', { class: 'out-vol' }, h('span', { text: 'Громкость телефона' }), pct),
    range);
  const swBtn = h('button', { class: 'btn tonal block', type: 'button' }, 'Сменить или отключить устройство');
  swBtn.addEventListener('click', () => (n.outputSwitch ? n.outputSwitch() : n.bluetooth()));

  const list = h('div', { class: 'out-list' });
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
    if (Date.now() - dragging > 1200 && typeof s.vol === 'number') { range.value = String(Math.round(s.vol * 100)); fill(); }
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
    list.replaceChildren(...devs.map((d, k) => {
      const st = d.connected ? 'Подключено' : d.bonding ? 'Подключаем…' : d.bonded ? 'Знакомое устройство' : 'Новое — нажмите, чтобы подключить';
      const row = h('button', { class: `out-dev${d.connected ? ' on' : ''}`, type: 'button', style: `--i:${k}` },
        h('span', { class: 'out-dico' }, mi(d.audio ? 'headphones' : 'phone')),
        h('span', { class: 'out-dname' }, h('b', { text: d.n }), h('small', { text: st })),
        d.connected && d.bat >= 0 ? batPill(d.bat) : null,
        typeof d.rssi === 'number' ? bars(d.rssi) : null);
      row.addEventListener('click', () => { if (d.connected) { toast('Уже подключено'); return; } row.classList.add('wait'); n.btPair(d.a); });
      return row;
    }));
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
