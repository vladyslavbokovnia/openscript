// ==UserScript==
// @name 📢 YouTube TTS
// @namespace http://tampermonkey.net/
// @version 11.6
// @description Листает ленту YouTube по роликам, озвучивает название и дату; переводит названия на русский; управление с геймпада и медиакнопок
// @author Vlad
// @match https://m.youtube.com/*
// @match https://www.youtube.com/*
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_registerMenuCommand
// @grant GM_unregisterMenuCommand
// @grant GM_setClipboard
// @grant GM_openInTab
// @grant GM_xmlhttpRequest
// @connect translate.googleapis.com
// @updateURL https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtve-tts.user.js
// @downloadURL https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js
// @run-at document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Настройки ──────────────────────────────────────────────────────────────
  const DEFAULTS = {
    lang: 'ru-RU',
    rate: 1.05,
    afterDelay: 700,
    tiltEnabled: false,
    tiltThreshold: 40,
    tiltCooldown: 1500,
    shareOnTap: true,
    shareMenu: true,   // false → только первое меню, без системного «Поделиться» и без таймера 1,5 с
    flipBottom: false,
    hideBar: true,
    translate: true,   // переводить нерусские названия на русский сразу после загрузки
    media: true,       // медиакоманды (гарнитура, экран блок-ировки, мед-иаклавиши)
    gamepad: true,     // управление озвучкой с геймпада
  };

  function loadCFG() {
    // v10.7: жесты наклона по умолчанию выключены (разовый сброс старого значения)
    try { if (GM_getValue('cfgVer', 0) < 2) { GM_setValue('tiltEnabled', false); GM_setValue('cfgVer', 2); } } catch {}
    const cfg = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      try { cfg[k] = GM_getValue(k, v); } catch { cfg[k] = v; }
    }
    return cfg;
  }
  function saveCFG(cfg) {
    for (const [k, v] of Object.entries(cfg)) { try { GM_setValue(k, v); } catch {} }
  }
  let CFG = loadCFG();

  const VERSION = '11.6';
