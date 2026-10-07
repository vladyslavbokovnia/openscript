# openscript

Userscripts для Tampermonkey (Android, Kiwi). Чтобы установить, откройте ссылку «Установить»
в браузере с Tampermonkey — он сам предложит установку. Нужна именно raw-ссылка (не страница
на github.com).

| Скрипт | Что делает | Установить |
|---|---|---|
| YouTube TTS | Листает ленту YouTube и озвучивает названия и даты | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js |
| SUBVOICE | Читает субтитры вслух с переводом на русский, перемотка наклонами | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subvoice.user.js |
| Субтитры → SUBVOICE | Кнопка 📝 на видео YouTube и Bilibili: берёт субтитры и открывает их в SUBVOICE (перевод и озвучка) | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subs-to-subvoice.user.js |
| te_phantom_opera | см. заголовок файла | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/te_phantom_opera.user.js |

## Схема ссылки

```
https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/ИМЯ_ФАЙЛА.user.js
```

Новый скрипт: положить файл `имя.user.js` в корень репозитория и подставить имя в схему.

## SUBVOICE как сайт (GitHub Pages)

Без Tampermonkey, просто страница по адресу:

https://vladyslavbokovnia.github.io/openscript/subvoice/

Файл страницы: `subvoice/index.html`. Субтитры страница сама не загружает: файл нужно выбрать
кнопкой «＋» при каждом запуске (или прислать скриптом «Субтитры → SUBVOICE»). Адрес https —
датчики наклона работают без обходных путей.
Включение: Settings → Pages → Source «Deploy from a branch» → ветка `main`, папка `/ (root)`.

## Субтитры с YouTube и Bilibili

Обычная страница не может забрать субтитры у этих сайтов (запрет браузера), поэтому их берёт
скрипт «Субтитры → SUBVOICE» прямо на странице видео. Кнопка 📝 появляется слева внизу на
страницах `/watch`, `/shorts` (YouTube) и `/video/` (Bilibili). Скрипт открывает страницу SUBVOICE
со ссылкой вида `…/subvoice/#n=Название&t=Текст`; SUBVOICE переводит текст на русский и читает.
Если у видео нет субтитров, скрипт напишет об этом; на Bilibili часть субтитров доступна только
после входа в аккаунт.

## SUBVOICE через Tampermonkey: как запустить

Открыть в браузере пустую страницу https://example.com/ — скрипт заменит её интерфейсом
SUBVOICE. С любой другой https-страницы: меню Tampermonkey → «Открыть SUBVOICE». Приём
субтитров из скрипта YouTube/Bilibili работает только на странице Pages.

## Обновления

В YouTube TTS, SUBVOICE и «Субтитры → SUBVOICE» прописаны `@updateURL` и `@downloadURL`, поэтому
Tampermonkey обновляет их сам при выходе новой версии (растёт номер `@version`). Вручную:
Tampermonkey → скрипт → проверить обновление. Страница на GitHub Pages обновляется сама после
каждого коммита (через минуту-две).
