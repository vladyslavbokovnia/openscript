// ==UserScript==
// @name 📢 YouTube TTS
// @namespace http://tampermonkey.net/
// @version 10.6
// @description Листает ленту YouTube по роликам, озвучивает название и дату
// @author Vlad
// @match https://m.youtube.com/*
// @match https://www.youtube.com/*
// @grant GM_setValue
// @grant GM_getValue
// @grant GM_registerMenuCommand
// @grant GM_setClipboard
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
    tiltEnabled: true,
    tiltThreshold: 40,
    tiltCooldown: 1500,
    shareOnTap: false,
  };

  function loadCFG() {
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

  // ── TTS ───────────────────────────────────────────────────────────────────
  const synth = window.speechSynthesis;

  function speak(text, onDone) {
    synth.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = CFG.lang;
    utt.rate = CFG.rate;
    utt.pitch = 1.0;
    utt.volume = 1.0;
    utt.onend = () => onDone && onDone();
    utt.onerror = () => onDone && onDone();
    synth.speak(utt);
  }

  // ── Состояние ─────────────────────────────────────────────────────────────
  let enabled = false, cardIndex = 0, autoTimer = null, speakGen = 0;
  let tiltCooling = false, tiltBaseline = null;
  // Отслеживаем последний озвученный элемент по DOM-ссылке, а не индексу
  let lastSpokenEl = null;

  // ── Карточки ──────────────────────────────────────────────────────────────
  const CARD_SELECTORS = [
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer',
    'ytm-media-lockup-view-model',
    'ytm-rich-item-renderer',
    'ytm-reel-item-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
  ];

  function findCards() {
    for (const sel of CARD_SELECTORS) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > 0) return found;
    }
    return [...document.querySelectorAll('*')].filter(el => {
      const tag = el.tagName.toLowerCase();
      return (tag.startsWith('ytm-') || tag.startsWith('ytd-'))
        && el.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
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

  // ── Заголовок / дата ──────────────────────────────────────────────────────
  const TITLE_SELECTORS = [
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
    if (!card.querySelector('a[href*="/watch"], a[href*="/shorts/"]')) return true;
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
      const d = Math.abs(r.top + r.height / 2 - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  // ── Навигация ──────────────────────────────────────────────────────────────
  function goTo(index) {
    if (!enabled) return;
    clearTimeout(autoTimer); autoTimer = null;
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

    const rect = card.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2,
      behavior: 'instant',
    });

    const { title, date } = extractInfo(card);
    if (!title) {
      // Заголовок не найден — пропускаем молча
      autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, 200);
      return;
    }

    updatePlayBtn('speaking');
    const phrase = date ? `${title}. ${date}` : title;

    setTimeout(() => {
      if (!enabled || speakGen !== myGen) return;
      speak(phrase, () => {
        if (speakGen !== myGen || !enabled) return;
        updatePlayBtn('pause');
        autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, CFG.afterDelay);
      });
    }, 80);
  }

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
      showNavBtns(true);
      if (CFG.tiltEnabled) enableTilt();
      waitForCards(() => goTo(findCenterIndex()));
    } else {
      speakGen++; clearTimeout(autoTimer); autoTimer = null;
      synth.cancel(); showNavBtns(false); disableTilt();
      updatePlayBtn('off'); lastSpokenEl = null;
    }
  }

  // ── Диагностика ────────────────────────────────────────────────────────────
  function runDiagnostics() {
    const lines = ['=== YouTube TTS Диагностика v10.6 ===', ''];

    lines.push('--- Карточки ---');
    let bestSel = null;
    for (const sel of CARD_SELECTORS) {
      const n = document.querySelectorAll(sel).length;
      lines.push(`${sel}: ${n}`);
      if (n > 0 && !bestSel) bestSel = sel;
    }
    lines.push('');

    lines.push('--- Все yt* теги на странице ---');
    const tagCounts = {};
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag.startsWith('ytm-') || tag.startsWith('ytd-') || tag.startsWith('yt-'))
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .forEach(([tag, n]) => lines.push(`  ${tag}: ${n}`));
    lines.push('');

    if (bestSel) {
      const cards = [...document.querySelectorAll(bestSel)];
      lines.push(`Всего карточек: ${cards.length}`);

      // Найти текущую карточку (по центру экрана)
      const ci = findCenterIndex();
      const card = cards[ci];
      lines.push(`Текущий индекс: ${ci}`);
      lines.push(`Skippable: ${isSkippable(card)}`);
      lines.push(`Совпадает с lastSpokenEl: ${card === lastSpokenEl}`);
      lines.push('');
      lines.push(`--- Содержимое карточки [${ci}] ---`);
      [...card.querySelectorAll('h3,h4,span,a,p')]
        .map(el => el.textContent?.trim()).filter(t => t && t.length > 5 && t.length < 120)
        .slice(0, 10).forEach(t => lines.push('  ' + t.slice(0, 80)));
      lines.push('');
      const { title, date } = extractInfo(card);
      lines.push(`Заголовок: "${title || 'НЕ НАЙДЕН'}"`);
      lines.push(`Дата: "${date || 'НЕ НАЙДЕНА'}"`);
    } else {
      lines.push('❌ Карточки не найдены.');
      lines.push('Прокрутите ленту и попробуйте снова.');
    }
    lines.push('');

    lines.push('--- TTS ---');
    lines.push(`speechSynthesis: ${'speechSynthesis' in window ? 'есть' : 'НЕТ'}`);
    const voices = synth.getVoices();
    lines.push(`Голосов: ${voices.length}`);
    voices.filter(v => v.lang.startsWith('ru')).slice(0, 3)
      .forEach(v => lines.push(`  ${v.name} (${v.lang})`));
    lines.push('');
    lines.push(`URL: ${location.href.slice(0, 80)}`);
    lines.push('Скрипт: v10.6');

    showDiagDialog(lines.join('\n'));
  }

  function showDiagDialog(report) {
    document.getElementById('yt-tts-diag')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'yt-tts-diag';
    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.85)', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '16px', boxSizing: 'border-box',
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
      background: '#1a1a1a', border: '1px solid #444', borderRadius: '16px', padding: '16px',
      maxWidth: '500px', width: '100%', maxHeight: '80vh',
      display: 'flex', flexDirection: 'column', gap: '12px',
    });
    const hdr = Object.assign(document.createElement('div'), { textContent: '🔍 Диагностика DOM' });
    Object.assign(hdr.style, { color: '#fff', fontWeight: 'bold', fontSize: '16px' });
    const pre = Object.assign(document.createElement('pre'), { textContent: report });
    Object.assign(pre.style, {
      color: '#aef', fontSize: '11px', lineHeight: '1.5', overflowY: 'auto', flex: '1',
      margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace',
    });
    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px' });

    function mkBtn(label, bg, fn) {
      const b = Object.assign(document.createElement('button'), { textContent: label });
      Object.assign(b.style, { flex: '1', padding: '10px', borderRadius: '10px', border: 'none', background: bg, color: '#fff', fontSize: '14px', cursor: 'pointer', fontWeight: 'bold' });
      b.addEventListener('click', fn); return b;
    }
    const copyBtn = mkBtn('📋 Скопировать', '#0066cc', () => {
      try {
        if (typeof GM_setClipboard !== 'undefined') GM_setClipboard(report);
        else navigator.clipboard.writeText(report);
        copyBtn.textContent = '✓ Скопировано!';
        setTimeout(() => { copyBtn.textContent = '📋 Скопировать'; }, 2000);
      } catch { copyBtn.textContent = '❌ Ошибка'; }
    });
    row.appendChild(copyBtn);
    row.appendChild(mkBtn('✕ Закрыть', '#444', () => overlay.remove()));
    box.append(hdr, pre, row);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── Меню ──────────────────────────────────────────────────────────────────
  function promptFloat(msg, cur, min, max) {
    const val = prompt(msg, cur); if (val === null) return null;
    const n = parseFloat(val);
    if (isNaN(n) || n < min || n > max) { alert(`Введите от ${min} до ${max}`); return null; }
    return n;
  }

  function registerMenuCommands() {
    GM_registerMenuCommand('🔍 Диагностика DOM', runDiagnostics);

    GM_registerMenuCommand(`🔊 Скорость речи: ${CFG.rate.toFixed(2)}×`, () => {
      const val = promptFloat('Скорость речи (0.5–2.0):', CFG.rate, 0.5, 2.0);
      if (val === null) return; CFG.rate = val; saveCFG(CFG); alert(`✓ Скорость: ${CFG.rate.toFixed(2)}×`);
    });

    GM_registerMenuCommand(`📱 Жесты наклона: ${CFG.tiltEnabled ? 'ВКЛ ✓' : 'ВЫКЛ'}`, () => {
      CFG.tiltEnabled = !CFG.tiltEnabled; saveCFG(CFG);
      if (!CFG.tiltEnabled && enabled) disableTilt();
      else if (CFG.tiltEnabled && enabled) enableTilt();
      alert(`Жесты наклона: ${CFG.tiltEnabled ? 'включены' : 'выключены'}`);
    });

    GM_registerMenuCommand(`📐 Чувствительность: ${CFG.tiltThreshold}°`, () => {
      const val = promptFloat('Порог наклона (15–70)°:', CFG.tiltThreshold, 15, 70);
      if (val === null) return; CFG.tiltThreshold = val; saveCFG(CFG); alert(`✓ ${CFG.tiltThreshold}°`);
    });

    GM_registerMenuCommand(`📤 Поделиться по тапу: ${CFG.shareOnTap ? 'ВКЛ ✓' : 'ВЫКЛ'}`, () => {
      CFG.shareOnTap = !CFG.shareOnTap; saveCFG(CFG);
      alert(`Поделиться по тапу: ${CFG.shareOnTap ? 'включено' : 'выключено'}`);
    });

    GM_registerMenuCommand('🔄 Проверить обновление', async () => {
      try {
        const url = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js';
        const res = await fetch(url + '?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const m = (await res.text()).match(/@version\s+([\d.]+)/);
        const remote = m ? m[1] : '?', local = '10.6';
        if (remote === local) alert(`✓ Актуальная версия ${local}`);
        else if (confirm(`Доступна v${remote} (текущая: ${local}). Открыть?`)) window.open(url, '_blank');
      } catch (err) { alert('⚠️ Ошибка: ' + err.message); }
    });

    GM_registerMenuCommand('♻️ Сбросить настройки', () => {
      if (!confirm('Сбросить все настройки?')) return;
      CFG = { ...DEFAULTS }; saveCFG(CFG); alert('✓ Сброшено. Обновите страницу.');
    });
  }

  // ── Share-on-tap ───────────────────────────────────────────────────────────
  function getVideoId(el) {
    for (const a of [el, ...el.querySelectorAll('a[href]')]) {
      const href = a.href || a.getAttribute?.('href') || '';
      const m = href.match(/[?&]v=([^&#]+)/) || href.match(/youtu\.be\/([^?#]+)/);
      if (m) return m[1];
    }
    return null;
  }
  async function openShare(videoId, title) {
    const url = `https://youtu.be/${videoId}`;
    if (navigator.share) { try { await navigator.share({ title: title || 'YouTube', url }); return; } catch {} }
    try { await navigator.clipboard.writeText(url); showToast('Скопировано: ' + url); } catch { showToast(url); }
  }
  function patchCard(card) {
    if (card.dataset.ytSharePatched) return;
    card.dataset.ytSharePatched = '1';
    card.addEventListener('click', e => {
      if (!CFG.shareOnTap) return;
      const id = getVideoId(card); if (!id) return;
      e.preventDefault(); e.stopImmediatePropagation();
      openShare(id, extractInfo(card).title);
    }, true);
  }
  const cardObserver = new MutationObserver(() =>
    document.querySelectorAll(CARD_SELECTORS.join(',')).forEach(patchCard)
  );

  // ── Инициализация ──────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('yt-tts-play')) return;
    createUI();
    registerMenuCommands();
    document.querySelectorAll(CARD_SELECTORS.join(',')).forEach(patchCard);
    cardObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // ── SPA навигация ──────────────────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (enabled) {
        speakGen++; clearTimeout(autoTimer); autoTimer = null;
        synth.cancel(); lastSpokenEl = null;
        waitForCards(() => goTo(findCenterIndex()));
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
