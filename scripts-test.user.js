// ==UserScript==
// @name         scripts-test
// @namespace    https://github.com/vladyslavbokovnia/openscript
// @version      1.0.0
// @description  Проверка возможностей браузера для скриптов (GM-функции, запросы, серверы Yandex для VOT, звук). Запуск: меню скриптов -> «Проверить скрипты». Другие скрипты не трогает
// @match        *://*/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @grant        GM_setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_notification
// @grant        unsafeWindow
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.getValues
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      translate.googleapis.com
// @connect      api.browser.yandex.ru
// @connect      vot-worker.vtrans.eu.cc
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window) return;

  let panel = null, lines = [];
  const log = s => { lines.push(s); if (panel) panel.firstChild.textContent = lines.join('\n'); };

  function showPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;left:6px;right:6px;top:6px;max-height:85vh;overflow:auto;z-index:2147483647;' +
      'background:#fff;color:#000;border:3px solid #000;padding:8px;font:13px/1.35 monospace;box-sizing:border-box';
    const pre = document.createElement('div');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-word';
    const b = document.createElement('button');
    b.textContent = 'Закрыть';
    b.style.cssText = 'display:block;margin-top:8px;padding:10px 18px;font:16px sans-serif;background:#eee;color:#000;border:2px solid #000';
    b.onclick = () => { panel.remove(); panel = null; };
    panel.append(pre, b);
    (document.body || document.documentElement).appendChild(panel);
  }

  const short = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };

  // запрос через GM_xmlhttpRequest -> {kind:'load'|'error'|'timeout', status, resp, ms, err}
  function xhr(o) {
    return new Promise(res => {
      const t0 = performance.now();
      const done = (kind, r, extra) => res(Object.assign({ kind, ms: Math.round(performance.now() - t0), resp: r }, extra));
      try {
        GM_xmlhttpRequest(Object.assign({ method: 'GET', timeout: 20000 }, o, {
          onload: r => done('load', r, { status: r.status }),
          onerror: r => done('error', r, { err: (r && (r.error || r.statusText)) || '?' }),
          ontimeout: r => done('timeout', r, { err: 'таймаут' })
        }));
      } catch (e) { done('error', null, { err: 'исключение: ' + e }); }
    });
  }

  // один пункт проверки: fn возвращает строку-итог или бросает ошибку
  async function step(name, fn) {
    try {
      const r = await fn();
      log((r && r.startsWith('!') ? '✖ ' : '✔ ') + name + (r ? ': ' + (r.startsWith('!') ? r.slice(1) : r) : ''));
    } catch (e) { log('✖ ' + name + ': ' + (e && e.message || e)); }
  }

  const RAW = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/README.md';
  const handler = (typeof GM_info !== 'undefined' && GM_info && GM_info.scriptHandler) || '?';

  async function run() {
    lines = [];
    showPanel();
    log('ПРОВЕРКА СКРИПТОВ (scripts-test ' + GM_info.script.version + ')');
    log('Страница: ' + location.hostname + ';  менеджер: ' + handler);
    log('✔ = работает, ✖ = не работает\n');

    log('— GM-функции —');
    await step('unsafeWindow совпадает с window', () => (typeof unsafeWindow !== 'undefined' && unsafeWindow === window) ? 'да' : '!нет (' + typeof unsafeWindow + ')');
    await step('GM_setValue / GM_getValue', () => { GM_setValue('st_k', { a: 1, b: 'x' }); const v = GM_getValue('st_k'); return v && v.a === 1 && v.b === 'x' ? 'ok' : '!вернулось ' + JSON.stringify(v); });
    await step('GM_listValues видит ключ', () => { const l = GM_listValues(); return Array.isArray(l) && l.includes('st_k') ? 'ok' : '!список: ' + JSON.stringify(l); });
    await step('GM.setValue / GM.getValue (промисы)', async () => { await GM.setValue('st_p', 42); const v = await GM.getValue('st_p'); return v === 42 ? 'ok' : '!вернулось ' + v; });
    await step('GM.getValues', async () => { const o = await GM.getValues({ st_p: 0, st_nope: 'def' }); return o && o.st_p === 42 && o.st_nope === 'def' ? 'ok' : '!' + JSON.stringify(o); });
    await step('GM_addValueChangeListener', async () => {
      let fired = false;
      GM_addValueChangeListener('st_l', () => { fired = true; });
      GM_setValue('st_l', Date.now());
      await new Promise(r => setTimeout(r, 300));
      return fired ? 'сработал' : 'не сработал на собственную запись (в Tampermonkey срабатывает)';
    });
    await step('GM_deleteValue', () => { GM_deleteValue('st_k'); GM_deleteValue('st_l'); GM.deleteValue('st_p'); return GM_getValue('st_k', 'нет') === 'нет' ? 'ok' : '!значение осталось'; });
    await step('GM_addStyle меняет вид', () => {
      GM_addStyle('#st_probe{width:37px!important;height:5px!important;display:block!important}');
      const d = document.createElement('div'); d.id = 'st_probe'; document.body.appendChild(d);
      const w = d.getBoundingClientRect().width; d.remove();
      return Math.round(w) === 37 ? 'ok' : '!ширина ' + w;
    });
    await step('GM_setClipboard', () => { GM_setClipboard('scripts-test'); return 'вызван без ошибки'; });
    await step('GM_notification', () => { GM_notification({ title: 'scripts-test', text: 'проверка уведомления' }); return 'вызван, посмотрите, появилась ли подсказка'; });

    log('\n— Запросы GM_xmlhttpRequest —');
    await step('текст (raw.githubusercontent.com)', async () => { const r = await xhr({ url: RAW + '?t=' + Date.now() }); return r.kind === 'load' && r.status === 200 ? r.resp.responseText.length + ' симв. за ' + r.ms + ' мс' : '!' + r.kind + ' ' + (r.status || '') + ' ' + (r.err || ''); });
    await step('responseType: json', async () => { const r = await xhr({ url: 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=hi', responseType: 'json' }); return r.kind === 'load' && Array.isArray(r.resp.response) ? 'массив, перевод: ' + short(JSON.stringify(r.resp.response[0]), 40) : '!' + r.kind + ' ' + (r.err || typeof (r.resp && r.resp.response)); });
    await step('responseType: arraybuffer', async () => { const r = await xhr({ url: RAW + '?t=' + Date.now(), responseType: 'arraybuffer' }); const ab = r.resp && r.resp.response; return r.kind === 'load' && ab instanceof ArrayBuffer && ab.byteLength > 100 ? ab.byteLength + ' байт, первые: ' + Array.from(new Uint8Array(ab, 0, 4)).join(',') : '!' + r.kind + ' ' + (r.err || Object.prototype.toString.call(ab)); });
    await step('responseType: blob', async () => { const r = await xhr({ url: RAW + '?t=' + Date.now(), responseType: 'blob' }); const b = r.resp && r.resp.response; return r.kind === 'load' && b instanceof Blob && b.size > 100 ? b.size + ' байт' : '!' + r.kind + ' ' + (r.err || Object.prototype.toString.call(b)); });
    await step('GM.xmlHttpRequest (промис)', async () => { const r = await GM.xmlHttpRequest({ method: 'GET', url: RAW + '?t=' + Date.now() }); return r && r.status === 200 ? 'ok' : '!статус ' + (r && r.status); });
    await step('редирект (github.com → raw)', async () => { const r = await xhr({ url: 'https://github.com/vladyslavbokovnia/openscript/raw/main/README.md' }); return r.kind === 'load' && r.status === 200 ? 'финальный адрес: ' + short(r.resp.finalUrl, 60) : '!' + r.kind + ' ' + (r.status || '') + ' ' + (r.err || ''); });
    if (handler === 'UniversalBrowser') {
      await step('запрет хоста вне @connect (ожидается отказ)', async () => { const r = await xhr({ url: 'https://example.org/' }); return r.kind === 'error' ? 'отказ получен: ' + short(r.err, 60) : '!запрос прошёл (' + r.kind + ' ' + r.status + '), а должен быть отказ'; });
    }

    log('\n— Серверы VOT (Yandex) —');
    await step('api.browser.yandex.ru, двоичное тело POST (protobuf)', async () => {
      const r = await xhr({ method: 'POST', url: 'https://api.browser.yandex.ru/video-translation/translate', headers: { 'Content-Type': 'application/x-protobuf' }, data: new Uint8Array([8, 1, 16, 2]), responseType: 'arraybuffer' });
      return r.kind === 'load' ? 'сервер ответил HTTP ' + r.status + ' за ' + r.ms + ' мс (любой код 2xx–4xx значит, что связь есть)' : '!' + r.kind + ' ' + r.err;
    });
    await step('vot-worker.vtrans.eu.cc', async () => { const r = await xhr({ url: 'https://vot-worker.vtrans.eu.cc/' }); return r.kind === 'load' ? 'HTTP ' + r.status + ' за ' + r.ms + ' мс' : '!' + r.kind + ' ' + r.err; });

    log('\n— Возможности WebView (нужны VOT) —');
    await step('crypto.subtle: SHA-256 и HMAC', async () => {
      const enc = new TextEncoder();
      const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('abc')))).map(x => x.toString(16).padStart(2, '0')).join('');
      const k = await crypto.subtle.importKey('raw', enc.encode('key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const s = await crypto.subtle.sign('HMAC', k, enc.encode('data'));
      return h.startsWith('ba7816bf') && s.byteLength === 32 ? 'ok' : '!SHA-256 ' + h.slice(0, 8);
    });
    await step('AudioContext', async () => { const A = window.AudioContext || window.webkitAudioContext; if (!A) return '!нет AudioContext'; const c = new A(); const g = c.createGain(); g.connect(c.destination); const st = c.state; c.close(); return 'создан, состояние: ' + st; });
    await step('воспроизведение mp3 / aac', () => { const a = document.createElement('audio'); return 'mp3: ' + (a.canPlayType('audio/mpeg') || 'нет') + ', aac: ' + (a.canPlayType('audio/mp4; codecs="mp4a.40.2"') || 'нет'); });
    await step('MediaSource', () => typeof MediaSource === 'undefined' ? '!нет' : 'mp3: ' + MediaSource.isTypeSupported('audio/mpeg') + ', aac: ' + MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'));
    await step('речь (speechSynthesis)', () => { const n = (speechSynthesis.getVoices() || []).length; return n ? 'голосов: ' + n : 'голосов пока 0 (на Android список может появиться позже)'; });
    await step('mediaSession', () => 'mediaSession' in navigator ? 'есть' : '!нет');
    await step('прочее (structuredClone, Object.hasOwn, at, ResizeObserver, IntersectionObserver)', () => {
      const m = [['structuredClone', typeof structuredClone], ['Object.hasOwn', typeof Object.hasOwn], ['Array.at', typeof [].at], ['ResizeObserver', typeof ResizeObserver], ['IntersectionObserver', typeof IntersectionObserver]].filter(x => x[1] === 'undefined').map(x => x[0]);
      return m.length ? '!нет: ' + m.join(', ') : 'всё есть';
    });

    log('\n— VOT на этой странице —');
    await step('виден ли интерфейс VOT', () => {
      const el = document.querySelector('[class*="vot-"],[id*="vot-"],[class*="vot_"]');
      return el ? 'да, найден элемент ' + short(el.className || el.id, 50) : 'нет (откройте страницу видео YouTube и запустите проверку там, подождав, пока видео загрузится)';
    });

    log('\n=== конец проверки ===');
    try { GM_setClipboard(lines.join('\n')); log('(отчёт скопирован в буфер обмена)'); } catch (e) {}
  }

  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('🧪 Проверить скрипты', run);
})();
