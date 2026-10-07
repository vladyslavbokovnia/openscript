# openscript

Userscripts для Tampermonkey (Android, Kiwi). Чтобы установить, откройте ссылку «Установить»
в браузере с Tampermonkey — он сам предложит установку. Нужна именно raw-ссылка (не страница
на github.com).

| Скрипт | Что делает | Установить |
|---|---|---|
| YouTube TTS | Листает ленту YouTube и озвучивает названия и даты | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js |
| SUBVOICE | Читает субтитры вслух с переводом на русский, перемотка наклонами | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subvoice.user.js |
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
кнопкой «＋» при каждом запуске. Адрес https — датчики наклона работают без обходных путей.
Включение: Settings → Pages → Source «Deploy from a branch» → ветка `main`, папка `/ (root)`.

## SUBVOICE через Tampermonkey: как запустить

Открыть в браузере пустую страницу https://example.com/ — скрипт заменит её интерфейсом
SUBVOICE. С любой другой https-страницы: меню Tampermonkey → «Открыть SUBVOICE».

## Обновления

В YouTube TTS и SUBVOICE прописаны `@updateURL` и `@downloadURL`, поэтому Tampermonkey
обновляет их сам при выходе новой версии (растёт номер `@version`). Вручную: Tampermonkey →
скрипт → проверить обновление. Страница на GitHub Pages обновляется сама после каждого коммита
(через минуту-две).
