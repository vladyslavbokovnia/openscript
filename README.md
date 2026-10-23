# openscript

<!-- AUTO-INSTALL-LINKS:START -->
- [Прятать панели при прокрутке](https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/hide-panels.user.js)
- [menu](https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js)
- [SUBVOICE](https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subvoice.user.js)
- [Phantom Opera](https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/te_phantom_opera.user.js)
- [📢 YouTube TTS](https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js)
<!-- AUTO-INSTALL-LINKS:END -->
Userscripts для Tampermonkey (Android, Kiwi). Чтобы установить, откройте ссылку «Установить»
в браузере с Tampermonkey — он сам предложит установку. Нужна именно raw-ссылка (не страница
на github.com).

| Скрипт | Что делает | Установить |
|---|---|---|
| YouTube TTS | Листает ленту YouTube и озвучивает названия и даты | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js |
| SUBVOICE | Читает субтитры вслух с переводом на русский, перемотка наклонами, субтитры по ссылке YouTube/Bilibili | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subvoice.user.js |
| Прятать панели при прокрутке | На любых сайтах прячет закреплённые шапки и нижние меню при прокрутке вниз, возвращает при прокрутке вверх; настройки в меню Tampermonkey | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/hide-panels.user.js |
| te_phantom_opera | см. заголовок файла | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/te_phantom_opera.user.js |

## Схема ссылки

```
https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/ИМЯ_ФАЙЛА.user.js
```

Новый скрипт: положить файл `имя.user.js` в корень репозитория и подставить имя в схему.

## SUBVOICE: как запустить

Открыть в браузере пустую страницу https://example.com/ — скрипт заменит её интерфейсом
SUBVOICE. С любой другой https-страницы: меню Tampermonkey → «Открыть SUBVOICE».

Субтитры можно загрузить двумя способами:
- «＋» — выбрать файл (.srt, .vtt, .ass, .txt);
- «🔗» — скопировать ссылку на видео YouTube или Bilibili и нажать кнопку: скрипт сам берёт
  субтитры по ссылке (страницу видео и сам ролик не открывает), переводит на русский и читает.
  Если буфер обмена недоступен или в нём не ссылка, спросит ссылку вручную.

## Обновления

В YouTube TTS, SUBVOICE и «Прятать панели» прописаны `@updateURL` и `@downloadURL`, поэтому Tampermonkey
обновляет их сам при выходе новой версии (растёт номер `@version`). Вручную: Tampermonkey →
скрипт → проверить обновление.
