// Настройки приложения.
// Этот файл публичный (он уезжает на сайт), поэтому секретные ключи сюда класть нельзя.

export const APP_VERSION = '0.1.0';

// Ключ YouTube Data API v3. Нужен, чтобы играть ПОЛНЫЕ треки через YouTube.
// Пока строка пустая, приложение играет 30-секундные фрагменты из iTunes.
//
// Как получить ключ (делаете вы сами в браузере):
//   1. console.cloud.google.com -> выбрать проект mkw-music
//   2. APIs & Services -> Library -> найти "YouTube Data API v3" -> Enable
//   3. APIs & Services -> Credentials -> Create credentials -> API key
//   4. В настройках ключа: Application restrictions = Websites, добавить:
//        https://xn--18-8kctprpfitl4j.xn--p1ai/*
//        http://localhost:8000/*
//      API restrictions = только YouTube Data API v3
//   5. Вставить ключ между кавычками ниже.
export const YOUTUBE_API_KEY = 'AIzaSyCJUuwIoMgDlo03wRN_04iv29a5sjJ5Rms';

// Регионы каталога iTunes: пробуем по очереди, пока не найдутся результаты.
export const ITUNES_COUNTRIES = ['RU', 'US'];
