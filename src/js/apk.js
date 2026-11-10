// «О MKW»: Android-приложение (APK, beta) — кнопка скачивания, контрольная сумма и инструкция по безопасной установке.
// Файл собирает GitHub Actions (папка android/ в репозитории) и кладёт в релиз «android-beta».
import { h, toast } from './ui.js';
import { mi } from './icons2.js';

const REPO = 'milokwela/MKW-Music';
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/MKW-Music-beta.apk`;
const REL_URL = `https://github.com/${REPO}/releases/tag/android-beta`;
const CODE_URL = `https://github.com/${REPO}/tree/main/android`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/tags/android-beta`;

let relP = null;
const loadRelease = () => {
  if (!relP) relP = fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return relP;
};

const link = (text, href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

const STEPS = () => [
  ['Скачивайте только здесь, по кнопке выше, или со страницы ', link('релизов проекта на GitHub', REL_URL), '. Файлы из пересланных сообщений, чатов и сайтов «бесплатных APK» не устанавливайте: под видом MKW может прийти вирус.'],
  ['Откройте скачанный файл MKW-Music-beta.apk — из уведомления о загрузке или из «Файлы» → «Загрузки». Android спросит разрешение «Установка неизвестных приложений»: включите его только для того приложения, из которого открываете файл (браузер или «Файлы»).'],
  ['Если Google Play Protect напишет про неизвестного разработчика — это нормально для приложения не из Google Play. Нажмите «Подробнее» → «Всё равно установить» (или «Проверить приложение», пусть Play Protect посмотрит файл).'],
  ['После установки снова запретите «Установку неизвестных приложений» для браузера: Настройки → Приложения → ваш браузер → Установка неизвестных приложений. Так посторонний файл случайно не поставится.'],
  ['Хотите убедиться, что файл не подменили? Сравните контрольную сумму SHA-256 выше с суммой скачанного файла (подойдёт любое приложение-«хеш-калькулятор»): совпасть должны все 64 символа. Если хоть один отличается — не устанавливайте.'],
  ['Что нужно приложению: интернет; уведомления и работа в фоне — чтобы музыка играла при выключенном экране, а сообщения и звонки не пропадали (спросит при первом запуске); камера и микрофон — только когда вы сами включаете жесты, голос, распознавание песни или звонок. Контакты, SMS, геолокация и память телефона ему недоступны, фото для профиля вы выбираете сами.'],
  ['Не хотите вводить пароль? Если вы уже вошли на сайте mkwmusic.ru в этом телефоне, на экране входа в приложении нажмите «Продолжить с сайта»: откроется браузер, подтвердите вход — и приложение войдёт в тот же аккаунт. Не входили на сайте — просто введите ник и пароль.'],
  ['Обновления: приложение само проверяет, не вышла ли новая версия, и предложит скачать. Новая ставится поверх старой, вход и данные сохраняются.'],
];

export function apkCard() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const inApp = /MKWApp\//.test(ua);
  const top = (sub) => h('div', { class: 'apk-top' },
    h('span', { class: 'apk-ic' }, mi('install')),
    h('div', {}, h('b', { text: 'Android-приложение' }), h('small', { text: sub })),
    h('span', { class: 'apk-tag', text: '1.0' }));

  if (inApp) {
    const v = (ua.match(/MKWApp\/([\w.]+)/) || [])[1];
    return h('div', { class: 'apk-card' },
      top(v ? `Вы уже в приложении · v${v}` : 'Вы уже в приложении'),
      h('p', { class: 'apk-note' }, 'Музыка играет в фоне и при выключенном экране. Если выйдет новая версия приложения, она появится на ', link('странице релизов', REL_URL), '.'));
  }

  const meta = h('small', { class: 'apk-meta', text: 'Ищем свежую версию…' });
  const sum = h('code', { class: 'apk-sum' });
  const copy = h('button', { class: 'apk-copy', type: 'button', 'aria-label': 'Скопировать контрольную сумму', title: 'Скопировать', hidden: true }, mi('copy'));
  const sumRow = h('div', { class: 'apk-sumrow', hidden: true }, h('span', { text: 'SHA-256' }), sum, copy);

  loadRelease().then((rel) => {
    if (!rel) { meta.textContent = 'Версию и контрольную сумму смотрите на странице релиза.'; return; }
    const asset = (rel.assets || []).find((a) => a.name === 'MKW-Music-beta.apk');
    const body = rel.body || '';
    let sha = asset && asset.digest ? String(asset.digest).replace(/^sha256:/, '') : ((body.match(/SHA-256: `([0-9a-f]{64})`/) || [])[1] || '');
    if (!/^[0-9a-f]{64}$/.test(sha)) sha = '';
    const ver = (body.match(/Версия приложения: ([\w.]+)/) || [])[1];
    const parts = [];
    if (ver) parts.push(`v${ver}`);
    if (asset && asset.size) parts.push(`${(asset.size / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`);
    if (rel.published_at) { try { parts.push(new Date(rel.published_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })); } catch { /* ignore */ } }
    meta.textContent = parts.join(' · ') || 'Свежая версия готова';
    if (sha) {
      sum.textContent = sha;
      sumRow.hidden = false;
      copy.hidden = false;
      copy.onclick = () => { try { navigator.clipboard.writeText(sha).then(() => toast('Контрольная сумма скопирована'), () => toast('Не получилось скопировать')); } catch { toast('Не получилось скопировать'); } };
    }
  });

  return h('div', { class: 'apk-card' },
    top('Android 7.0 и новее'),
    h('p', { class: 'apk-note', text: 'В приложении музыка играет в фоне и при выключенном экране, управляется с экрана блокировки и с наушников. Нужен Android 7.0 или новее.' }),
    h('a', { class: 'apk-btn', href: APK_URL, target: '_blank', rel: 'noopener noreferrer' }, mi('install'), 'Скачать APK'),
    meta,
    sumRow,
    h('p', { class: 'apk-note' }, 'Файл собирает GitHub автоматически из открытого кода — можно посмотреть, что внутри: ', link('папка android', CODE_URL), '.'),
    h('details', { class: 'apk-how' },
      h('summary', {}, mi('shield'), 'Как скачать и установить безопасно'),
      h('ol', {}, STEPS().map((parts) => h('li', {}, ...parts)))));
}
