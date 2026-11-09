// Режим для слабых устройств: выключает размытие, тяжёлые анимации и фоновые эффекты. По умолчанию выключен.
const KEY = 'mkw.lowpower';
export const lowPower = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export function setLowPower(v) {
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  apply();
}
export function apply() { document.documentElement.classList.toggle('lowpower', lowPower()); }
export function initPerf() { apply(); }
