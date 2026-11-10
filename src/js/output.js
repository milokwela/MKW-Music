// Android-приложение: «Подключить устройство» — куда сейчас идёт звук, громкость телефона и переход к Bluetooth.
// Работает только внутри приложения (window.MKWNative); на сайте кнопка не показывается.
import { h, openSheet, isSheetOpen } from './ui.js';
import { mi } from './icons2.js';

const KIND = { bt: 'Bluetooth', wired: 'Проводные наушники', phone: 'Динамик телефона' };

export const hasOutput = () => Boolean(window.MKWNative);

export function openOutput() {
  const n = window.MKWNative;
  if (!n) return;
  const name = h('b', { text: 'Этот телефон', style: 'font-size:18px;display:block' });
  const sub = h('small', { text: 'Динамик телефона', style: 'opacity:.75' });
  const pct = h('span', { text: '', style: 'font-variant-numeric:tabular-nums' });
  const range = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '50', 'aria-label': 'Громкость телефона', style: 'width:100%;accent-color:var(--accent,#f7a8d0);height:28px' });
  let dragging = 0;
  range.addEventListener('input', () => { dragging = Date.now(); pct.textContent = `${range.value}%`; n.setVolume(Number(range.value) / 100, false); });
  const bt = h('button', { class: 'btn tonal block', type: 'button' }, 'Bluetooth: найти и подключить');
  bt.addEventListener('click', () => n.bluetooth());
  const card = h('div', { class: 'set-card', style: 'padding:16px;display:grid;gap:12px;transition:background .3s' },
    h('div', { style: 'display:flex;gap:14px;align-items:center' },
      h('span', { class: 'apk-ic' }, mi('headphones')), h('div', {}, name, sub)),
    h('div', { style: 'display:flex;justify-content:space-between;font-size:13px;opacity:.8' }, h('span', { text: 'Громкость телефона' }), pct),
    range);
  const onState = (e) => {
    const s = e.detail || {};
    name.textContent = s.kind !== 'phone' && s.name ? s.name : (s.kind === 'wired' ? 'Наушники' : 'Этот телефон');
    sub.textContent = KIND[s.kind] || KIND.phone;
    if (Date.now() - dragging > 1200 && typeof s.vol === 'number') { range.value = String(Math.round(s.vol * 100)); pct.textContent = `${range.value}%`; }
  };
  window.addEventListener('mkw-audio', onState);
  openSheet('Подключить устройство', h('div', { class: 'pw-form' }, card,
    h('p', { class: 'profile-note', text: 'Новые наушники, колонку или машину подключите в настройках Bluetooth телефона — звук MKW сразу пойдёт туда, а кнопки на наушниках и в машине будут переключать треки.' }),
    bt));
  n.audio();
  // пока окно открыто, следим за громкостью и подключением
  const t = setInterval(() => { if (!isSheetOpen() || !card.isConnected) { clearInterval(t); window.removeEventListener('mkw-audio', onState); return; } n.audio(); }, 1500);
}
