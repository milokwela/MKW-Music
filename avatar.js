// Аватар по умолчанию — силуэт человека (не логотип MKW).
export const DEF_AV = 'avatar.svg';
// старые карточки могли сохранить логотип как «фото» — считаем это отсутствием фото
export const isDefAv = (s) => !s || /mkw-logo|avatar\.svg|^assets\/|^[a-z0-9-]+\.(png|svg)$/i.test(s);
export const avSrc = (s) => (isDefAv(s) ? DEF_AV : s);
