// Раньше здесь был ручной «режим для слабых устройств». Теперь качеством графики управляет движок плавности (quality.js):
// он сам подбирает уровень под телефон. Эти функции оставлены для старых мест в коде.
import { quality, qualityMode, setQualityMode, initQuality } from './quality.js';

export const lowPower = () => quality() === 0;
export function setLowPower(v) { setQualityMode(v ? '0' : 'auto'); }
export function apply() { /* классы на <html> ставит quality.js */ }
export function initPerf() { initQuality(); }
export { qualityMode };
