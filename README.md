# openscript

Userscripts для Tampermonkey (Android, Kiwi). Чтобы установить, откройте ссылку «Установить»
в браузере с Tampermonkey — он сам предложит установку. Нужна именно raw-ссылка (не страница
на github.com).

| Скрипт | Что делает | Установить |
|---|---|---|
| YouTube TTS | Листает ленту YouTube и озвучивает названия и даты | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js |
| SUBVOICE | Читает субтитры вслух с переводом на русский, перемотка наклонами, субтитры по ссылке YouTube/Bilibili | https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subvoice.user.js |
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

## Необязательное

- `subvoice/index.html` — то же приложение как сайт на GitHub Pages
  (https://vladyslavbokovnia.github.io/openscript/subvoice/). Включение: Settings → Pages →
  Deploy from a branch → `main` / `/ (root)`. Для работы с телефоном не нужен.
- `subs-to-subvoice.user.js` — кнопка 📝 на странице видео YouTube/Bilibili, отправляет субтитры
  на страницу Pages. Нужен только вместе со страницей Pages.

## Обновления

В YouTube TTS и SUBVOICE прописаны `@updateURL` и `@downloadURL`, поэтому Tampermonkey
обновляет их сам при выходе новой версии (растёт номер `@version`). Вручную: Tampermonkey →
скрипт → проверить обновление.
