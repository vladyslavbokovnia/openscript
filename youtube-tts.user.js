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
// @updateURL https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js
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
    media: true,       // медиакоманды (гарнитура, экран блокировки, медиаклавиши)
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

  // ── TTS ───────────────────────────────────────────────────────────────────
  const synth = window.speechSynthesis;

  let wd1 = null, wd2 = null, dbg = '';
  function clearWD() { clearTimeout(wd1); clearTimeout(wd2); wd1 = wd2 = null; }

  function speak(text, onDone) {
    clearWD(); synth.cancel();
    let cur = null, fin = false, started = false;
    const done = () => { if (fin) return; fin = true; clearWD(); onDone && onDone(); };
    const mk = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = CFG.lang; u.rate = CFG.rate; u.pitch = 1.0; u.volume = 1.0;
      u.onstart = () => { if (cur === u) started = true; };
      u.onend = u.onerror = () => { if (cur === u) done(); };
      return u;
    };
    cur = mk(); synth.speak(cur);
    // Страховка от зависаний: не стартовало — повтор один раз; не закончилось — идём дальше
    wd1 = setTimeout(() => { if (!fin && !started) { synth.cancel(); cur = mk(); synth.speak(cur); } }, 2500);
    wd2 = setTimeout(() => { if (!fin) { dbg = 'таймаут озвучки'; synth.cancel(); done(); } }, 5000 + text.length * 120 / CFG.rate);
  }

  // ── Состояние ─────────────────────────────────────────────────────────────
  let enabled = false, paused = false, cardIndex = 0, autoTimer = null, speakGen = 0;
  let tiltCooling = false, tiltBaseline = null;
  // Отслеживаем последний озвученный элемент по DOM-ссылке, а не индексу
  let lastSpokenEl = null;

  // ── Карточки ──────────────────────────────────────────────────────────────
  const CARD_SELECTORS = [
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer',
    'ytm-media-lockup-view-model',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
    'shorts-lockup-view-model',
    'ytm-rich-item-renderer',
    'ytm-reel-item-renderer',
    'ytd-reel-item-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'yt-lockup-view-model',
  ];
  const CARD_SEL = CARD_SELECTORS.join(',');

  // Все типы карточек одним списком в порядке на странице (раньше брался только первый
  // найденный тип, поэтому Shorts в смешанной ленте пропускались). Вложенные дубли убираем.
  function findCards() {
    const all = [...document.querySelectorAll(CARD_SEL)];
    if (!all.length) {
      return [...document.querySelectorAll('*')].filter(el => {
        const tag = el.tagName.toLowerCase();
        return (tag.startsWith('ytm-') || tag.startsWith('ytd-'))
          && el.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
      });
    }
    const set = new Set(all);
    return all.filter(el => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  function waitForCards(cb) {
    if (findCards().length > 0) { cb(); return; }
    const obs = new MutationObserver(() => {
      if (findCards().length > 0) { obs.disconnect(); cb(); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); cb(); }, 8000);
  }

  // Ждём пока карточек станет больше чем currentCount (лента дозагрузилась).
  // Прокручиваем страницу вниз сами — это триггер ленивой загрузки YouTube.
  function waitForMoreCards(currentCount, myGen, cb) {
    const POLL_INTERVAL = 900;
    const MAX_WAIT = 25000;
    let elapsed = 0;

    // Скролл вниз — инициируем подгрузку
    window.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });

    function check() {
      if (!enabled || speakGen !== myGen) return;
      const now = findCards().length;
      if (now > currentCount) { cb(); return; }
      elapsed += POLL_INTERVAL;
      if (elapsed >= MAX_WAIT) {
        showToast('⚠️ Лента не загрузилась. Прокрутите вниз вручную.');
        updatePlayBtn('pause');
        return;
      }
      // Каждые ~5 сек подталкиваем скролл ещё раз
      if (elapsed % 4500 < POLL_INTERVAL) {
        window.scrollBy({ top: window.innerHeight * 0.5, behavior: 'smooth' });
      }
      autoTimer = setTimeout(check, POLL_INTERVAL);
    }
    autoTimer = setTimeout(check, POLL_INTERVAL);
  }

  // ── Перевод названий на русский ───────────────────────────────────────────
  // Работает сразу после загрузки ленты, независимо от того, включена ли озвучка.
  // Переводятся карточки около экрана; результат кэшируется (в том числе между сессиями).
  const trCache = new Map();               // оригинал -> перевод (или оригинал, если уже русский)
  try { const o = JSON.parse(GM_getValue('trCache', '{}')); for (const k in o) trCache.set(k, o[k]); } catch {}
  const trPending = new Map();             // оригинал -> Promise
  const trFailed = new Map();              // оригинал -> время неудачи (повтор через 30 с)
  const trApplied = new WeakMap();         // элемент названия -> { orig, tr }
  let trSaveT = null, trActive = 0;
  const trQ = [];

  function trSave() {
    clearTimeout(trSaveT);
    trSaveT = setTimeout(() => {
      try { GM_setValue('trCache', JSON.stringify(Object.fromEntries([...trCache.entries()].slice(-600)))); } catch {}
    }, 2000);
  }
  function needsTr(s) {
    s = (s || '').trim();
    const letters = s.match(/\p{L}/gu) || [];
    if (letters.length < 2) return false;
    if (/[іїєґІЇЄҐ]/.test(s)) return true;                       // украинский — тоже переводим
    const cyr = (s.match(/[Ѐ-ӿ]/g) || []).length;
    return cyr / letters.length < 0.5;
  }
  function gmGet(url) {
    return new Promise((res, rej) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method: 'GET', url, timeout: 15000,
          onload: r => (r.status >= 200 && r.status < 300) ? res(r.responseText) : rej(new Error('HTTP ' + r.status)),
          onerror: () => rej(new Error('net')), ontimeout: () => rej(new Error('timeout')) });
      } else {
        fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))).then(res, rej);
      }
    });
  }
  async function gtTranslate(q) {
    const txt = await gmGet('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=ru&q=' + encodeURIComponent(q));
    const d = JSON.parse(txt);
    return { out: d[0].map(x => x[0] || '').join(''), lang: d[2] || '' };
  }
  function trPump() {
    while (trActive < 3 && trQ.length) {
      const job = trQ.shift(); trActive++;
      job().finally(() => { trActive--; trPump(); });
    }
  }
  function trEnqueue(fn, urgent) {
    return new Promise(res => {
      const job = () => fn().then(res);
      if (urgent) trQ.unshift(job); else trQ.push(job);
      trPump();
    });
  }
  function translateTitle(orig, urgent) {
    if (trCache.has(orig)) return Promise.resolve(trCache.get(orig));
    if (trPending.has(orig)) return trPending.get(orig);
    const t = trFailed.get(orig);
    if (t && Date.now() - t < 30000) return Promise.resolve(orig);
    const p = trEnqueue(async () => {
      try {
        const { out, lang } = await gtTranslate(orig);
        const res = (lang === 'ru' || !out.trim()) ? orig : out.trim();
        trCache.set(orig, res); trSave();
        return res;
      } catch { trFailed.set(orig, Date.now()); return orig; }
    }, urgent).finally(() => trPending.delete(orig));
    trPending.set(orig, p);
    return p;
  }
  function titleEl(card) {
    for (const sel of TITLE_SELECTORS) {
      const el = card.querySelector(sel);
      if (el) { const t = el.textContent?.trim(); if (t && t.length > 1) return el; }
    }
    return null;
  }
  // Меняем только текст внутри существующего узла — разметку YouTube не ломаем
  function setElText(el, text) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let first = null, n;
    while ((n = w.nextNode())) {
      if (!first) { if (!n.nodeValue.trim()) continue; first = n; n.nodeValue = text; }
      else n.nodeValue = '';
    }
    if (!first) el.textContent = text;
  }
  function trCard(card, urgent) {
    if (!CFG.translate) return Promise.resolve();
    const el = titleEl(card);
    if (!el) return Promise.resolve();
    const cur = el.textContent.trim();
    const ap = trApplied.get(el);
    if ((ap && ap.tr === cur) || !needsTr(cur)) return Promise.resolve();
    return translateTitle(cur, urgent).then(res => {
      if (res && res !== cur && el.textContent.trim() === cur) {
        setElText(el, res); trApplied.set(el, { orig: cur, tr: res });
      }
    });
  }
  let scanT = null;
  function scanTitles() {
    if (!CFG.translate) return;
    const H = window.innerHeight; let n = 0;
    for (const card of document.querySelectorAll(CARD_SEL)) {
      const r = card.getBoundingClientRect();
      if (r.bottom < -H * 1.5 || r.top > H * 2.5) continue;
      trCard(card, false);
      if (++n > 40) break;
    }
  }
  function scheduleScan() {
    if (scanT) return;
    scanT = setTimeout(() => { scanT = null; scanTitles(); }, 500);
  }

  // ── Заголовок / дата ──────────────────────────────────────────────────────
  const TITLE_SELECTORS = [
    '.shortsLockupViewModelHostMetadataTitle',
    '.shortsLockupViewModelHostOutsideMetadataTitle',
    '#video-title',
    '.compact-media-item-headline',
    'h3', 'h4',
    '[class*="video-title"]',
    '.media-item-headline',
    'yt-formatted-string',
    'span[class*="title"]',
    '.ytm-media-lockup-view-model-wiz__text-container span',
  ];
  const DATE_PAT = /назад|час|день|дней|дня|мес|год|лет|мин|сек|нед|week|month|year|hour|day|ago|вчера|сегодня|yesterday|today/i;

  function clean(s) {
    s = (s || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
    return /[\p{L}\p{N}]/u.test(s) ? s.slice(0, 220) : '';
  }

  function extractInfo(card) {
    let title = '';
    for (const sel of TITLE_SELECTORS) {
      const el = card.querySelector(sel);
      if (el) { const t = el.textContent?.trim(); if (t && t.length > 1) { title = t; break; } }
    }
    if (!title) {
      for (const el of card.querySelectorAll('span,a,p')) {
        const t = el.textContent?.trim();
        if (t && t.length > 10 && t.length < 200 && !DATE_PAT.test(t)) { title = t; break; }
      }
    }
    if (!title) {
      const al = card.querySelector('a[aria-label]')?.getAttribute('aria-label') || '';
      title = al.replace(/,\s*[\d.,\s]+\S*\s*(views|просмотр\S*|тыс\S*|млн\S*).*$/i, '').trim();
    }
    let rawDate = '';
    for (const el of card.querySelectorAll('span,p,div')) {
      const t = el.textContent?.trim() || '';
      if (DATE_PAT.test(t) && t.length < 40) { rawDate = t; break; }
    }
    const date = rawDate.replace(/\s+назад\s*$/i, '').replace(/\s+ago\s*$/i, '').trim();
    return { title, date };
  }

  // Карточка — не видео? (баннер, полка, опрос, реклама...)
  function isSkippable(card) {
    if (!card.querySelector('a[href*="/watch"], a[href*="/shorts/"]')) { dbg = 'нет ссылки на видео'; return true; }
    if (!card.getClientRects().length) return true;
    if (card.querySelector('ytm-promoted-sparkles-web-renderer,ytm-promoted-video-renderer,ytm-ad-slot-renderer,ytd-ad-slot-renderer,ad-slot-renderer,[class*="ad-badge"],[class*="promoted"]')) { dbg = 'реклама'; return true; }
    const tag = card.tagName.toLowerCase();
    const skipTags = ['ytm-statement-banner-renderer','ytm-survey-renderer',
      'ytm-recognition-shelf-renderer','ytm-horizontal-card-list-renderer',
      'ytm-shelf-renderer','ytm-promoted-sparkles-web-renderer',
      'ytm-promoted-video-renderer','ytd-statement-banner-renderer',
      'ytd-survey-renderer','ytd-shelf-renderer','ytd-horizontal-card-list-renderer'];
    return skipTags.includes(tag);
  }

  function findCenterIndex() {
    const cards = findCards(), mid = window.innerHeight / 2;
    let best = 0, bestDist = Infinity;
    cards.forEach((card, i) => {
      const r = card.getBoundingClientRect();
      const d = Math.hypot(r.top + r.height / 2 - mid, r.left + r.width / 2 - window.innerWidth / 2);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  // ── Навигация ──────────────────────────────────────────────────────────────
  function goTo(index) {
    if (!enabled) return;
    paused = false;
    clearTimeout(autoTimer); autoTimer = null; clearWD();
    const myGen = ++speakGen;
    synth.cancel();

    const cards = findCards();

    // Дошли до конца — ждём молча новых карточек
    if (cards.length > 0 && index >= cards.length) {
      updatePlayBtn('pause');
      showToast('⏳ Ждём загрузки ленты…', 2500);
      waitForMoreCards(cards.length, myGen, () => {
        if (speakGen !== myGen || !enabled) return;
        goTo(index);
      });
      return;
    }

    // Карточки вообще не найдены
    if (!cards.length) {
      showToast('⚠️ Карточки ещё не загружены...');
      autoTimer = setTimeout(() => { autoTimer = null; goTo(index); }, 1500);
      return;
    }

    index = Math.max(0, Math.min(index, cards.length - 1));
    cardIndex = index;
    const card = cards[cardIndex];

    // Пропустить не-видео элемент
    if (isSkippable(card)) {
      autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, 150);
      return;
    }

    // Защита от повтора: сравниваем по DOM-ссылке, а не индексу.
    // Это работает корректно даже при перестройке DOM YouTube-ом.
    if (card === lastSpokenEl) {
      // Элемент тот же — значит мы застряли. Переходим вперёд.
      autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, CFG.afterDelay);
      return;
    }
    lastSpokenEl = card;

    card.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

    const speakCard = () => {
      if (!enabled || speakGen !== myGen) return;
      let { title, date } = extractInfo(card);
      title = clean(title); date = clean(date);
      dbg = card.tagName.toLowerCase() + ': ' + (title || 'без заголовка').slice(0, 40);
      if (!title) {
        // Заголовок не найден — пропускаем молча
        autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, 200);
        return;
      }

      updatePlayBtn('speaking');
      mediaMeta(title);
      const phrase = date ? `${title}. ${date}` : title;

      setTimeout(() => {
        if (!enabled || speakGen !== myGen) return;
        speak(phrase, () => {
          if (speakGen !== myGen || !enabled) return;
          updatePlayBtn('pause');
          autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, CFG.afterDelay);
        });
      }, 80);
    };

    // Название ещё не переведено — ждём перевод (не дольше 2,5 с), чтобы озвучить уже по-русски
    if (CFG.translate && needsTr(extractInfo(card).title)) {
      Promise.race([trCard(card, true), new Promise(r => setTimeout(r, 2500))]).then(speakCard);
    } else {
      speakCard();
    }
  }

  // ── Пауза / продолжить (без полного выключения озвучки) ────────────────────
  function pauseTTS() {
    if (!enabled || paused) return;
    paused = true; speakGen++;
    clearTimeout(autoTimer); autoTimer = null; clearWD();
    synth.cancel();
    updatePlayBtn('paused'); mediaState('paused');
  }
  function resumeTTS() {
    if (!enabled || !paused) return;
    paused = false; lastSpokenEl = null;
    mediaState('playing');
    goTo(findCenterIndex());
  }
  function playPause() {
    if (!enabled) toggle();
    else if (paused) resumeTTS();
    else pauseTTS();
  }
  function stepCard(d) { if (enabled) goTo(findCenterIndex() + d); }
  function repeatCard() { if (enabled) { lastSpokenEl = null; goTo(findCenterIndex()); } }
  function changeRate(d) {
    CFG.rate = Math.max(0.5, Math.min(2.0, Math.round((CFG.rate + d) * 100) / 100));
    saveCFG(CFG); showToast(`🔊 Скорость: ${CFG.rate.toFixed(2)}×`, 1200);
  }

  // ── Медиакоманды (гарнитура, экран блокировки, медиаклавиши) ───────────────
  // Чтобы система слала кнопки странице, нужна «играющая» медиасессия: держим тихий
  // аудиоэлемент, пока озвучка включена. Обработчики снимаются при выключении,
  // чтобы не мешать обычному воспроизведению YouTube.
  let mediaAudio = null;
  function silentWavUrl(asData) {
    const n = 8000, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    w(36, 'data'); dv.setUint32(40, n, true); buf.fill(128, 44);
    if (asData) { let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return 'data:audio/wav;base64,' + btoa(s); }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function mediaStart() {
    if (!CFG.media || !('mediaSession' in navigator)) return;
    try {
      if (!mediaAudio) {
        mediaAudio = new Audio();
        mediaAudio.loop = true; mediaAudio.volume = 0.02;
        mediaAudio.addEventListener('error', () => { if (!mediaAudio._d) { mediaAudio._d = 1; mediaAudio.src = silentWavUrl(true); mediaAudio.play().catch(() => {}); } });
        mediaAudio.src = silentWavUrl(false);
      }
      mediaAudio.play().catch(() => {});
      const ms = navigator.mediaSession;
      ms.metadata = new MediaMetadata({ title: 'YouTube TTS', artist: 'Озвучка ленты' });
      ms.playbackState = 'playing';
      const set = (a, f) => { try { ms.setActionHandler(a, f); } catch {} };
      set('play', resumeTTS);
      set('pause', pauseTTS);
      set('stop', () => { if (enabled) toggle(); });
      set('nexttrack', () => stepCard(1));
      set('previoustrack', () => stepCard(-1));
      set('seekforward', () => stepCard(1));
      set('seekbackward', () => stepCard(-1));
    } catch {}
  }
  function mediaStop() {
    try {
      if (mediaAudio) mediaAudio.pause();
      if (!('mediaSession' in navigator)) return;
      const ms = navigator.mediaSession;
      ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward']
        .forEach(a => { try { ms.setActionHandler(a, null); } catch {} });
      ms.playbackState = 'none'; ms.metadata = null;
    } catch {}
  }
  function mediaMeta(title) {
    if (!CFG.media || !('mediaSession' in navigator) || !enabled) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'YouTube TTS' });
      navigator.mediaSession.playbackState = 'playing';
    } catch {}
  }
  function mediaState(st) {
    if (!CFG.media || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = st;
      if (mediaAudio) { if (st === 'playing') mediaAudio.play().catch(() => {}); else mediaAudio.pause(); }
    } catch {}
  }
  // Медиаклавиши Bluetooth-клавиатур/пультов, когда страница в фокусе
  window.addEventListener('keydown', e => {
    if (!CFG.media) return;
    const k = e.key;
    if (k === 'MediaPlayPause') playPause();
    else if (k === 'MediaPlay') { if (!enabled) toggle(); else resumeTTS(); }
    else if (k === 'MediaPause') pauseTTS();
    else if (k === 'MediaTrackNext') stepCard(1);
    else if (k === 'MediaTrackPrevious') stepCard(-1);
    else if (k === 'MediaStop') { if (enabled) toggle(); }
    else return;
    e.preventDefault();
  }, true);

  // ── Геймпад ────────────────────────────────────────────────────────────────
  // A — пауза/продолжить (если выключено — включить) · B — стоп · X — повторить
  // LB/RB и ↑/↓ — предыдущее/следующее · ←/→ — скорость речи −/+
  // Работает независимо от наклонов; удержание LB/RB/↑/↓ повторяет шаг.
  const GP_REPEAT = new Set([4, 5, 12, 13]);
  let gpTimer = null; const gpState = {};
  function gpAct(i) {
    switch (i) {
      case 0: playPause(); break;
      case 1: if (enabled) toggle(); break;
      case 2: repeatCard(); break;
      case 4: case 12: stepCard(-1); break;
      case 5: case 13: stepCard(1); break;
      case 14: changeRate(-0.1); break;
      case 15: changeRate(0.1); break;
    }
  }
  function gpPoll() {
    if (!CFG.gamepad || !navigator.getGamepads) return;
    const now = Date.now();
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      const st = gpState[gp.index] || (gpState[gp.index] = {});
      gp.buttons.forEach((b, i) => {
        const down = b.pressed || b.value > 0.6, s = st[i];
        if (down) {
          if (!s) { st[i] = { t: now, last: now }; gpAct(i); }
          else if (GP_REPEAT.has(i) && now - s.t > 450 && now - s.last > 220) { s.last = now; gpAct(i); }
        } else if (s) st[i] = null;
      });
    }
  }
  function gpAny() { return !!navigator.getGamepads && [...navigator.getGamepads()].some(g => g && g.connected); }
  function gpStart() { if (!gpTimer) gpTimer = setInterval(gpPoll, 70); }
  window.addEventListener('gamepadconnected', () => { gpStart(); if (CFG.gamepad) showToast('🎮 Геймпад подключён', 1500); });
  window.addEventListener('gamepaddisconnected', () => {
    if (!gpAny()) { clearInterval(gpTimer); gpTimer = null; for (const k in gpState) delete gpState[k]; }
  });
  if (gpAny()) gpStart();

  // ── Наклон ─────────────────────────────────────────────────────────────────
  function onDeviceOrientation(e) {
    if (!enabled || !CFG.tiltEnabled || tiltCooling) return;
    if (tiltBaseline === null) { tiltBaseline = e.gamma; return; }
    const delta = e.gamma - tiltBaseline;
    if (Math.abs(delta) < CFG.tiltThreshold) return;
    tiltCooling = true;
    setTimeout(() => { tiltCooling = false; }, CFG.tiltCooldown);
    goTo(findCenterIndex() + (delta > 0 ? 1 : -1));
  }
  function enableTilt() {
    tiltBaseline = null; tiltCooling = false;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(s => { if (s === 'granted') window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true }); })
        .catch(() => {});
    } else {
      window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
    }
  }
  function disableTilt() {
    window.removeEventListener('deviceorientation', onDeviceOrientation);
    tiltBaseline = null;
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  let playBtn, prevBtn, nextBtn;

  function showToast(msg, duration = 3000) {
    const el = Object.assign(document.createElement('div'), { textContent: msg });
    Object.assign(el.style, {
      position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.88)', color: '#fff', padding: '9px 16px',
      borderRadius: '20px', fontSize: '13px', zIndex: '99999',
      pointerEvents: 'none', maxWidth: '90vw', whiteSpace: 'pre-wrap',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function updatePlayBtn(state) {
    if (!playBtn) return;
    if (state === 'off')           { playBtn.textContent = '📢'; playBtn.style.fontSize = '28px'; }
    else if (state === 'speaking') { playBtn.textContent = '🔊'; playBtn.style.fontSize = '30px'; }
    else if (state === 'paused')   { playBtn.textContent = '⏸️'; playBtn.style.fontSize = '28px'; }
    else                           { playBtn.textContent = '🗣️'; playBtn.style.fontSize = '30px'; }
  }

  function btnBase(styles) {
    const b = document.createElement('button');
    const bgDefault = styles.background || 'rgba(20,20,20,0.72)';
    Object.assign(b.style, {
      position: 'fixed', zIndex: '2147483647',
      border: '1.5px solid rgba(255,255,255,0.22)',
      background: bgDefault, color: '#fff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      WebkitTapHighlightColor: 'transparent', userSelect: 'none',
      boxShadow: '0 2px 12px rgba(0,0,0,0.55)', pointerEvents: 'all',
      ...styles,
    });
    b.addEventListener('pointerdown',   () => b.style.background = 'rgba(60,60,60,0.9)');
    b.addEventListener('pointerup',     () => b.style.background = bgDefault);
    b.addEventListener('pointercancel', () => b.style.background = bgDefault);
    b.addEventListener('pointerleave',  () => b.style.background = bgDefault);
    return b;
  }

  function createUI() {
    playBtn = btnBase({ bottom: '14px', left: '50%', transform: 'translateX(-50%)', width: '60px', height: '60px', borderRadius: '50%', fontSize: '28px' });
    updatePlayBtn('off');
    playBtn.addEventListener('click', toggle);
    document.body.appendChild(playBtn);

    function makeNavBtn(side, label) {
      const b = btnBase({
        top: '0', [side]: '0', width: '48px', height: '100dvh',
        borderRadius: side === 'left' ? '0 14px 14px 0' : '14px 0 0 14px',
        fontSize: '48px', fontWeight: 'bold', display: 'none', border: 'none',
        background: 'rgba(20,20,20,0.45)',
        borderLeft:  side === 'right' ? '1px solid rgba(255,255,255,0.12)' : 'none',
        borderRight: side === 'left'  ? '1px solid rgba(255,255,255,0.12)' : 'none',
      });
      b.textContent = label;
      return b;
    }
    prevBtn = makeNavBtn('left', '‹');
    nextBtn = makeNavBtn('right', '›');
    prevBtn.addEventListener('click', () => goTo(findCenterIndex() - 1));
    nextBtn.addEventListener('click', () => goTo(findCenterIndex() + 1));
    document.body.appendChild(prevBtn);
    document.body.appendChild(nextBtn);
  }

  function showNavBtns(show) {
    const d = show ? 'flex' : 'none';
    if (prevBtn) prevBtn.style.display = d;
    if (nextBtn) nextBtn.style.display = d;
  }

  // ── Вкл/Выкл ──────────────────────────────────────────────────────────────
  function toggle() {
    enabled = !enabled;
    if (enabled) {
      synth.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 }));
      paused = false;
      showNavBtns(true);
      if (CFG.tiltEnabled) enableTilt();
      mediaStart();
      waitForCards(() => goTo(findCenterIndex()));
    } else {
      speakGen++; clearTimeout(autoTimer); autoTimer = null; clearWD();
      synth.cancel(); showNavBtns(false); disableTilt();
      updatePlayBtn('r_off'); lastSpokenEl = null; paused = false;
      mediaStart();
    }
  }
