# .clinerules/01-main.md - строгие правила проекта MKW Music

## 1. Фронтенд
Сайт работает на чистом HTML, CSS и ES‑модулях без сборщиков. Никакие Vite/Webpack/Parcel и т.д. не используются.

## 2. Конфигурационные файлы
Не удалять, не перезаписывать и не коммитить файлы с ключами:
- `firebase-config.js`
- `keys.js`
- `config.js`
- `shazam-config.js`

## 3. Firebase Spark limits
Ограничения бесплатного тарифа Spark: 50 000 чтений и 20 000 записей в день. Правила базы находятся в `firestore.rules`.

## 4. Серверная часть
Cloudflare Worker находится в `docs/recognize-worker.js`.

## 5. Версионирование
При обновлении сайта менять версию в `version.json` и `sw.js`.

## 6. Публикация
Сайт публикуется через GitHub Pages при пуше в ветку `main`. Android APK собирается через GitHub Actions (`.github/workflows/android.yml`).

## 7. Android релизы
Релизы Android APK оформлять строго по стандарту из
`.claude-backup/mkw_release_latest.txt` (тег `android-beta`, счетчик сборок после `#51`, SHA‑256).

## 8. Информация о релизе
Для каждого релиза необходимо соблюдать шаблон, указанный в файле
`.claude-backup/mkw_release_latest.txt`:
* `tag: android-beta`
* `name: MKW Music для Android`
* `published: <ISO8601>`
* `Версия приложения, сборка, SHA‑256, подпись и обязательные обновления`.

## 9. Общая память (Memory Bank)
Все модели (Qwen, GPT‑OSS, Gemma) используют общую директорию `memory-bank/`.
Перед началом любой задачи обязательно прочитайте `memory-bank/activeContext.md` и `memory-bank/progress.md` – они содержат контекст и статус текущих задач.
После завершения задачи обновляйте эти файлы, чтобы остальные модели видели актуальное состояние.

## 10. Инструменты Firebase и Cloudflare Wrangler
Для удобства можно вызывать команды напрямую через `npx firebase` / `npx wrangler`.
Если текущая сессия терминала ещё не перезапущена, убедитесь, что путь
`C:\Users\User\AppData\Roaming\npm` добавлен в переменную окружения PATH:
```powershell
[Environment]::SetEnvironmentVariable(
    "PATH",
    ( [Environment]::GetEnvironmentVariable("PATH","User") + ";C:\\Users\\User\\AppData\\Roaming\\npm" ),
    "User"
)
```