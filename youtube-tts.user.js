// ==UserScript==
// @name         📢 YouTube  TTS
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  Листает ленту YouTube по роликам, озвучивает название и дату
// @author       Vlad
// @match        https://m.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Настройки ──────────────────────────────────────────────────────────────
  const DEFAULTS = {
    lang:          'ru-RU',
    rate:          1.05,
    afterDelay:    700,
    tiltEnabled:   true,
    tiltThreshold: 40,
    tiltCooldown:  1500,
    noImages:      false,
    shareOnTap:    false,
  };

  function loadCFG() {
    const cfg = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      try { cfg[k] = GM_getValue(k, v); } catch { cfg[k] = v; }
    }
    return cfg;
  }
  function saveCFG(cfg) {
    for (const [k, v] of Object.entries(cfg)) {
      try { GM_setValue(k, v); } catch {}
    }
  }

  let CFG = loadCFG();

  // ── Блокировка картинок ────────────────────────────────────────────────────
  // Охватываем все thumbnail-контейнеры: лента, канал, шорты
  const THUMB_WRAP = [
    'ytm-thumbnail-cover',
    'ytd-thumbnail',
    '.ytm-thumbnail',
    '.compact-media-item-image',
    'ytm-playlist-thumbnail',
    '.ytm-thumbnail-cover',
    'ytm-shorts-lockup-view-model .thumbnail-container',
    'ytm-shorts-lockup-view-model-v2 .thumbnail-container',
    '#thumbnail',                          // десктоп
    'a#thumbnail',
    'ytd-channel-video-player-renderer',
    '.ytd-thumbnail',
  ].join(',');

  const NO_IMG_CSS = `
    ytm-thumbnail-cover,
    ytd-thumbnail,
    .ytm-thumbnail,
    .compact-media-item-image,
    ytm-playlist-thumbnail,
    .ytm-thumbnail-cover,
    ytm-shorts-lockup-view-model .thumbnail-container,
    ytm-shorts-lockup-view-model-v2 .thumbnail-container,
    #thumbnail img,
    a#thumbnail,
    ytd-rich-grid-media #thumbnail,
    ytd-channel-video-player-renderer ytd-thumbnail,
    .ytd-thumbnail {
      display: none !important;
    }
    ytm-compact-video-renderer,
    ytm-video-with-context-renderer,
    ytm-rich-item-renderer,
    ytm-compact-playlist-renderer,
    ytd-rich-item-renderer,
    ytd-video-renderer,
    ytd-compact-video-renderer {
      padding-top: 0 !important;
    }
  `;

  const _setAttr = Element.prototype.setAttribute;
  let imgBlocked = false;
  let noImgStyleEl = null;

  function applyImageBlock(enable) {
    if (enable === imgBlocked) return;
    imgBlocked = enable;
    if (enable) {
      Element.prototype.setAttribute = function (name, value) {
        if (
          this.tagName === 'IMG' &&
          (name === 'src' || name === 'srcset') &&
          this.closest?.(THUMB_WRAP)
        ) return;
        return _setAttr.call(this, name, value);
      };
      if (!noImgStyleEl) {
        noImgStyleEl = document.createElement('style');
        noImgStyleEl.id = 'yt-tts-no-img';
        noImgStyleEl.textContent = NO_IMG_CSS;
        (document.head || document.documentElement).appendChild(noImgStyleEl);
      }
    } else {
      Element.prototype.setAttribute = _setAttr;
      noImgStyleEl?.remove();
      noImgStyleEl = null;
    }
  }

  // Применяем блокировку картинок как можно раньше
  if (CFG.noImages) applyImageBlock(true);

  // ── Share-on-tap ───────────────────────────────────────────────────────────
  const CARD_SEL = [
    'ytm-compact-video-renderer',
    'ytm-video-with-context-renderer',
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-video-renderer',
    'ytm-reel-item-renderer',
    'ytm-shorts-lockup-view-model',
    'ytm-shorts-lockup-view-model-v2',
  ].join(',');

  function getVideoId(el) {
    const links = [el, ...el.querySelectorAll('a[href]')];
    for (const a of links) {
      const href = a.href || a.getAttribute?.('href') || '';
      const m = href.match(/[?&]v=([^&#]+)/) || href.match(/youtu\.be\/([^?#]+)/);
      if (m) return m[1];
    }
    return null;
  }

  function getCardTitle(card) {
    const t = card.querySelector(
      'h3, .compact-media-item-headline, [class*="video-title"], .media-item-headline, #video-title'
    );
    return t ? t.textContent.trim() : '';
  }

  async function openShare(videoId, title) {
    const url = `https://youtu.be/${videoId}`;
    if (navigator.share) {
      try { await navigator.share({ title: title || 'YouTube', url }); return; } catch (_) {}
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Скопировано: ' + url);
    } catch {
      showToast(url);
    }
  }

  function showToast(msg) {
    const el = Object.assign(document.createElement('div'), { textContent: msg });
    Object.assign(el.style, {
      position: 'fixed', bottom: '90px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.88)', color: '#fff',
      padding: '9px 16px', borderRadius: '20px',
      fontSize: '13px', zIndex: '99999',
      pointerEvents: 'none',
      maxWidth: '90vw', whiteSpace: 'nowrap',
      overflow: 'hidden', textOverflow: 'ellipsis',
    });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function patchCard(card) {
    if (card.dataset.ytSharePatched) return;
    card.dataset.ytSharePatched = '1';

    card.addEventListener('click', (e) => {
      if (!CFG.shareOnTap) return; // фича выключена — пропускаем
      const id = getVideoId(card);
      if (!id) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openShare(id, getCardTitle(card));
    }, true);
  }

  function scanCards() {
    document.querySelectorAll(CARD_SEL).forEach(patchCard);
  }

  const cardObserver = new MutationObserver(scanCards);

  function startCardObserver() {
    scanCards();
    cardObserver.observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) startCardObserver();
  else document.addEventListener('DOMContentLoaded', startCardObserver);

  // ── Состояние TTS ──────────────────────────────────────────────────────────
  let enabled      = false;
  let cardIndex    = 0;
  let autoTimer    = null;
  let speakGen     = 0;
  let tiltCooling  = false;
  let tiltBaseline = null;

  const synth = window.speechSynthesis;

  function getVoice() {
    const voices = synth.getVoices();
    return voices.find(v => v.lang === CFG.lang)
        || voices.find(v => v.lang.startsWith('ru'))
        || null;
  }

  // ── Карточки TTS ───────────────────────────────────────────────────────────
  function findCards() {
    let c = [...document.querySelectorAll(
      'ytm-video-with-context-renderer,ytm-compact-video-renderer'
    )];
    if (!c.length) c = [...document.querySelectorAll(
      'ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer'
    )];
    return c;
  }

  function extractInfo(card) {
    const titleEl =
      card.querySelector('#video-title') ||
      card.querySelector('.compact-media-item-headline') ||
      card.querySelector('h3') ||
      card.querySelector('[class*="title"]');
    const title = titleEl?.textContent?.trim() || '';

    const pat = /назад|час|день|дней|дня|мес|год|лет|мин|сек|нед|week|month|year|hour|day|ago/i;
    let rawDate = '';
    for (const el of card.querySelectorAll('span')) {
      const t = el.textContent?.trim() || '';
      if (pat.test(t) && t.length < 30) { rawDate = t; break; }
    }
    const date = rawDate.replace(/\s+назад\s*$/i,'').replace(/\s+ago\s*$/i,'').trim();
    return { title, date };
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
    speakGen++;
    const myGen = speakGen;
    synth.cancel();

    const cards = findCards();
    if (!cards.length) return;
    index = Math.max(0, Math.min(index, cards.length - 1));
    cardIndex = index;

    const card = cards[cardIndex];
    const rect = card.getBoundingClientRect();
    window.scrollTo({
      top:      window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2,
      behavior: 'instant',
    });

    const { title, date } = extractInfo(card);
    if (!title) return;
    updatePlayBtn('speaking');

    setTimeout(() => {
      if (!enabled || speakGen !== myGen) return;
      const phrase = date ? `${title}. ${date}` : title;
      const utt = new SpeechSynthesisUtterance(phrase);
      utt.lang  = CFG.lang; utt.rate = CFG.rate;
      utt.pitch = 1.0; utt.volume = 1.0;
      const voice = getVoice();
      if (voice) utt.voice = voice;
      utt.onend = utt.onerror = () => {
        if (speakGen !== myGen || !enabled) return;
        updatePlayBtn('pause');
        autoTimer = setTimeout(() => { autoTimer = null; goTo(cardIndex + 1); }, CFG.afterDelay);
      };
      synth.speak(utt);
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
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
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

  function updatePlayBtn(state) {
    if (!playBtn) return;
    if (state === 'off') {
      playBtn.textContent    = '📢';
      playBtn.style.fontSize = '28px';
    } else if (state === 'speaking') {
      playBtn.textContent    = '🔊';
      playBtn.style.fontSize = '30px';
    } else {
      playBtn.textContent    = '🗣️';
      playBtn.style.fontSize = '30px';
    }
  }

  function btnBase(extraStyles) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      position:       'fixed',
      zIndex:         '2147483647',
      border:         '1.5px solid rgba(255,255,255,0.22)',
      background:     'rgba(20,20,20,0.72)',
      color:          '#fff',
      cursor:         'pointer',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      WebkitTapHighlightColor: 'transparent',
      userSelect:     'none',
      boxShadow:      '0 2px 12px rgba(0,0,0,0.55)',
      pointerEvents:  'all',
      ...extraStyles,
    });
    b.addEventListener('pointerdown',  () => b.style.background = 'rgba(60,60,60,0.9)');
    b.addEventListener('pointerup',    () => b.style.background = 'rgba(20,20,20,0.72)');
    b.addEventListener('pointercancel',() => b.style.background = 'rgba(20,20,20,0.72)');
    b.addEventListener('pointerleave', () => b.style.background = 'rgba(20,20,20,0.72)');
    return b;
  }

  function createUI() {
    // ── Play — по центру внизу ──
    playBtn = btnBase({
      bottom:       '14px',
      left:         '50%',
      transform:    'translateX(-50%)',
      width:        '60px',
      height:       '60px',
      borderRadius: '50%',
      fontSize:     '28px',
    });
    updatePlayBtn('off');
    playBtn.addEventListener('click', toggle);
    document.body.appendChild(playBtn);

    // ── Prev / Next — на всю высоту экрана ──
    function makeNavBtn(side, label) {
      const b = btnBase({
        top:          '0',
        [side]:       '0',
        width:        '48px',
        height:       '100dvh',   // на всю высоту вьюпорта
        borderRadius: side === 'left' ? '0 14px 14px 0' : '14px 0 0 14px',
        fontSize:     '48px',
        fontWeight:   'bold',
        display:      'none',
        border:       'none',
        // полупрозрачнее чтобы не мешать чтению
        background:   'rgba(20,20,20,0.45)',
        // тонкая граница только с внутренней стороны
        borderLeft:   side === 'right' ? '1px solid rgba(255,255,255,0.12)' : 'none',
        borderRight:  side === 'left'  ? '1px solid rgba(255,255,255,0.12)' : 'none',
      });
      b.textContent = label;
      // при наведении/тапе — немного ярче
      b.addEventListener('pointerdown',  () => b.style.background = 'rgba(60,60,60,0.7)');
      b.addEventListener('pointerup',    () => b.style.background = 'rgba(20,20,20,0.45)');
      b.addEventListener('pointercancel',() => b.style.background = 'rgba(20,20,20,0.45)');
      b.addEventListener('pointerleave', () => b.style.background = 'rgba(20,20,20,0.45)');
      return b;
    }

    prevBtn = makeNavBtn('left',  '‹');
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
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0; synth.speak(warm);
      showNavBtns(true);
      if (CFG.tiltEnabled) enableTilt();
      goTo(findCenterIndex());
    } else {
      speakGen++;
      clearTimeout(autoTimer); autoTimer = null;
      synth.cancel();
      showNavBtns(false);
      disableTilt();
      updatePlayBtn('off');
    }
  }

  // ── Меню Tampermonkey ──────────────────────────────────────────────────────
  function promptFloat(msg, current, min, max) {
    const val = prompt(msg, current);
    if (val === null) return null;
    const n = parseFloat(val);
    if (isNaN(n) || n < min || n > max) {
      alert(`Введите число от ${min} до ${max}`);
      return null;
    }
    return n;
  }

  function registerMenuCommands() {
    GM_registerMenuCommand(
      `🔊 Скорость речи: ${CFG.rate.toFixed(2)}×`,
      () => {
        const val = promptFloat('Скорость речи (0.5 – 2.0):', CFG.rate, 0.5, 2.0);
        if (val === null) return;
        CFG.rate = val;
        saveCFG(CFG);
        alert(`✓ Скорость установлена: ${CFG.rate.toFixed(2)}×`);
      }
    );

    GM_registerMenuCommand(
      `📱 Жесты наклона: ${CFG.tiltEnabled ? 'ВКЛ ✓' : 'ВЫКЛ'}`,
      () => {
        CFG.tiltEnabled = !CFG.tiltEnabled;
        saveCFG(CFG);
        if (!CFG.tiltEnabled && enabled) disableTilt();
        else if (CFG.tiltEnabled && enabled) enableTilt();
        alert(`Жесты наклона: ${CFG.tiltEnabled ? 'включены' : 'выключены'}`);
      }
    );

    GM_registerMenuCommand(
      `📐 Чувствительность наклона: ${CFG.tiltThreshold}°`,
      () => {
        const val = promptFloat('Порог наклона в градусах (15 – 70):', CFG.tiltThreshold, 15, 70);
        if (val === null) return;
        CFG.tiltThreshold = val;
        saveCFG(CFG);
        alert(`✓ Чувствительность: ${CFG.tiltThreshold}°`);
      }
    );

    GM_registerMenuCommand(
      `🖼 Скрыть картинки: ${CFG.noImages ? 'ВКЛ ✓' : 'ВЫКЛ'}`,
      () => {
        CFG.noImages = !CFG.noImages;
        saveCFG(CFG);
        applyImageBlock(CFG.noImages);
        alert(`Картинки: ${CFG.noImages ? 'скрыты (обновите страницу для полного эффекта)' : 'показаны (обновите страницу)'}`);
      }
    );

    GM_registerMenuCommand(
      `📤 Поделиться по тапу: ${CFG.shareOnTap ? 'ВКЛ ✓' : 'ВЫКЛ'}`,
      () => {
        CFG.shareOnTap = !CFG.shareOnTap;
        saveCFG(CFG);
        alert(`Поделиться по тапу: ${CFG.shareOnTap ? 'включено — клик по карточке открывает меню «Поделиться»' : 'выключено'}`);
      }
    );

    GM_registerMenuCommand(
      '🔄 Проверить обновление',
      async () => {
        try {
          const url = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js';
          const res = await fetch(url + '?t=' + Date.now());
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const text = await res.text();
          const m = text.match(/@version\s+([\d.]+)/);
          const remote = m ? m[1] : '?';
          const local  = '10.0';
          if (remote === local) {
            alert(`✓ Актуальная версия ${local}`);
          } else {
            if (confirm(`Доступна версия ${remote} (текущая: ${local}). Открыть страницу обновления?`)) {
              window.open(url, '_blank');
            }
          }
        } catch (err) {
          alert('⚠️ Ошибка проверки: ' + err.message);
        }
      }
    );

    GM_registerMenuCommand(
      '♻️ Сбросить настройки',
      () => {
        if (!confirm('Сбросить все настройки к значениям по умолчанию?')) return;
        CFG = { ...DEFAULTS };
        saveCFG(CFG);
        applyImageBlock(CFG.noImages);
        if (enabled) disableTilt();
        alert('✓ Настройки сброшены. Обновите страницу.');
      }
    );
  }

  // ── Инициализация ─────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('yt-tts-play')) return;
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = () => {};
    createUI();
    registerMenuCommands();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // SPA — сброс при переходе между страницами
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (enabled) {
        speakGen++; clearTimeout(autoTimer); autoTimer = null;
        synth.cancel(); updatePlayBtn('off');
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
