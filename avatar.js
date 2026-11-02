import { safeUrl } from './utils.js?v=0.29.1';
// Аватар по умолчанию — силуэт человека (не логотип MKW).
export const DEF_AV = 'avatar.svg';
// старые карточки могли сохранить логотип как «фото» — считаем это отсутствием фото
export const isDefAv = (s) => !s || /mkw-logo|avatar\.svg|^assets\/|^[a-z0-9-]+\.(png|svg)$/i.test(s);
// чужое фото показываем, только если это картинка (data:image или https)
export const avSrc = (s) => (isDefAv(s) || !safeUrl(s) ? DEF_AV : safeUrl(s));
