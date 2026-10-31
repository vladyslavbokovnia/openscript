// ==UserScript==
// @name         translate-test
// @namespace    https://github.com/vladyslavbokovnia/openscript
// @version      1.0.0
// @description  Проверка перевода страницы: запросы к Google Переводчику и подмена текста. Запуск: меню скриптов -> «Тест перевода». Другие скрипты не трогает
// @match        *://*/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @grant        GM_setClipboard
// @connect      translate.googleapis.com
// @connect      raw.githubusercontent.com
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window) return;

  const URL_T = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=';
  let panel = null, lines = [];

  const log = s => { lines.push(s); if (panel) panel.firstChild.textContent = lines.join('\n'); };

  function showPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:6px;right:6px;top:6px;max-height:85vh;overflow:auto;z-index:2147483647;' +
      'background:#fff;color:#000;border:3px solid #000;padding:8px;font:14px/1.35 monospace;box-sizing:border-box';
    const pre = document.createElement('div');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word';
    const b = document.createElement('button');
    b.textContent = 'Закрыть';
    b.style.cssText = 'display:block;margin-top:8px;padding:10px 18px;font:16px sans-serif;background:#eee;color:#000;border:2px solid #000';
    b.onclick = () => { panel.remove(); panel = null; };
    panel.append(pre, b);
    (document.body || document.documentElement).appendChild(panel);
  }

  // один запрос: возвращает {ok, ms, status, text, lang, err}
  function req(q, timeout) {
    return new Promise(res => {
      const t0 = performance.now();
      const done = o => { o.ms = Math.round(performance.now() - t0); res(o); };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: URL_T + encodeURIComponent(q),
          timeout: timeout || 20000,
          onload(r) {
            try {
              const o = { status: r.status, len: (r.responseText || '').length };
              if (r.status !== 200) { o.ok = false; o.err = 'HTTP ' + r.status + ' ' + String(r.responseText || '').slice(0, 120); return done(o); }
              const d = JSON.parse(r.responseText);
              o.ok = true;
              o.text = d[0].map(x => (x && x[0]) || '').join('');
              o.lang = d[2];
              done(o);
            } catch (e) { done({ ok: false, err: 'разбор ответа: ' + e }); }
          },
          onerror(r) { done({ ok: false, err: 'onerror: ' + (r && (r.error || r.statusText) || '?') }); },
          ontimeout() { done({ ok: false, err: 'таймаут' }); }
        });
      } catch (e) { done({ ok: false, err: 'исключение: ' + e }); }
    });
  }

  const short = (s, n) => { s = String(s == null ? '' : s).replace(/\n/g, '⏎'); return s.length > n ? s.slice(0, n) + '…' : s; };

  async function run() {
    lines = [];
    showPanel();
    log('ТЕСТ ПЕРЕВОДА  (translate-test ' + GM_info.script.version + ')');
    log('Страница: ' + location.hostname);

    // 1. окружение
    const ua = navigator.userAgent;
    const chrome = (/Chrome\/(\d+)/.exec(ua) || [])[1] || '?';
    let uni = false; try { new RegExp('\\p{L}', 'u'); uni = true; } catch (e) {}
    log('\n[1] Окружение');
    log('Chrome/WebView: ' + chrome + ';  lang страницы: ' + (document.documentElement.lang || '—'));
    log('GM_xmlhttpRequest: ' + typeof GM_xmlhttpRequest + ';  менеджер: ' + ((GM_info && (GM_info.scriptHandler || GM_info.version)) || '?'));
    log('checkVisibility: ' + (typeof Element.prototype.checkVisibility) + ';  \\p{L}: ' + uni +
        ';  toWellFormed: ' + (typeof ''.toWellFormed) + ';  MutationObserver: ' + (typeof MutationObserver));

    // 2. любой разрешённый хост: работает ли GM_xmlhttpRequest вообще
    log('\n[2] Запрос к raw.githubusercontent.com');
    await new Promise(r => {
      GM_xmlhttpRequest({
        method: 'GET', url: 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js?t=' + Date.now(), timeout: 20000,
        onload(x) { const m = /@version\s+(\S+)/.exec(x.responseText || ''); log('HTTP ' + x.status + ', версия menu.user.js в репозитории: ' + (m ? m[1] : 'не найдена')); r(); },
        onerror(x) { log('ОШИБКА: ' + (x && (x.error || x.statusText) || '?')); r(); },
        ontimeout() { log('ОШИБКА: таймаут'); r(); }
      });
    });

    // 3. простой перевод
    log('\n[3] Перевод одной фразы');
    const a = await req('Hello world, this is a test.');
    log(a.ok ? 'OK за ' + a.ms + ' мс: «' + a.text + '» (язык: ' + a.lang + ')' : 'ОШИБКА за ' + a.ms + ' мс: ' + a.err);
    if (!a.ok) { log('\nДальше идти нет смысла: запрос к Google не проходит.'); return finish(); }

    // 4. пакет строк через \n
    log('\n[4] Пакет из 3 строк (как в скрипте)');
    const b = await req('Good morning\nHow are you?\nThank you very much');
    if (b.ok) { const p = b.text.split('\n'); log('OK за ' + b.ms + ' мс, строк в ответе: ' + p.length + ' (нужно 3)'); log(short(b.text, 200)); }
    else log('ОШИБКА: ' + b.err);

    // 5. длинный запрос
    log('\n[5] Длинный запрос (~1500 символов в адресе)');
    const long = 'The quick brown fox jumps over the lazy dog. '.repeat(30).slice(0, 1300);
    const c = await req(long);
    log(c.ok ? 'OK за ' + c.ms + ' мс, получено символов: ' + (c.text || '').length : 'ОШИБКА: ' + c.err);

    // 6. подмена текста на самой странице: первые 5 текстовых узлов
    log('\n[6] Подмена текста на странице');
    try {
      const nodes = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while (nodes.length < 5 && (n = w.nextNode())) {
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/i.test(p.tagName) || (panel && panel.contains(n))) continue;   // свою же панель не переводим
        if (n.data.trim().length < 3 || !/[A-Za-zА-Яа-я]/.test(n.data)) continue;
        nodes.push(n);
      }
      if (!nodes.length) log('на странице не нашлось текста для проверки');
      else {
        const src = nodes.map(x => x.data.replace(/\s+/g, ' ').trim());
        const r = await req(src.join('\n'));
        if (!r.ok) log('ОШИБКА: ' + r.err);
        else {
          const parts = r.text.split('\n');
          log('узлов: ' + nodes.length + ', строк в ответе: ' + parts.length + (parts.length === nodes.length ? '  (совпало)' : '  (НЕ совпало)'));
          if (parts.length === nodes.length) {
            const old = nodes.map(x => x.data);
            nodes.forEach((x, i) => { x.data = parts[i].trim(); });
            log('текст на странице заменён (вернётся через 6 с):');
            nodes.forEach((x, i) => log('  ' + short(src[i], 40) + '  →  ' + short(x.data, 40)));
            setTimeout(() => { nodes.forEach((x, i) => { x.data = old[i]; }); log('\nтекст возвращён'); }, 6000);
          }
        }
      }
    } catch (e) { log('ИСКЛЮЧЕНИЕ: ' + e); }

    finish();
  }

  function finish() {
    log('\n=== конец теста ===');
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(lines.join('\n')); log('(отчёт скопирован в буфер обмена)'); } } catch (e) {}
  }

  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('🧪 Тест перевода', run);
})();
