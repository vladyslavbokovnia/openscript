// ==UserScript==
// @name         📢 YouTube Feed TTS
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Листает ленту YouTube по роликам, озвучивает название и дату
// @author       Vlad
// @match        https://m.youtube.com/*
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
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
  const THUMB_WRAP = [
    'ytm-thumbnail-cover','ytd-thumbnail',
    '.ytm-thumbnail','.compact-media-item-image',
  ].join(',');

  const _setAttr = Element.prototype.setAttribute;
  let imgBlocked = false;
  let noImgStyleEl = null;

  function applyImageBlock(enable) {
    if (enable === imgBlocked) return;
    imgBlocked = enable;
    if (enable) {
      Element.prototype.setAttribute = function (name, value) {
        if (this.tagName === 'IMG' && (name === 'src' || name === 'srcset') &&
            this.closest?.(THUMB_WRAP)) return;
        return _setAttr.call(this, name, value);
      };
      if (!noImgStyleEl) {
        noImgStyleEl = document.createElement('style');
        noImgStyleEl.textContent = `
          ytm-thumbnail-cover,ytd-thumbnail,.ytm-thumbnail,
          .compact-media-item-image,ytm-playlist-thumbnail{display:none!important}
          ytm-compact-video-renderer,ytm-video-with-context-renderer,
          ytm-rich-item-renderer{padding-top:0!important}
        `;
        document.head.appendChild(noImgStyleEl);
      }
    } else {
      Element.prototype.setAttribute = _setAttr;
      noImgStyleEl?.remove();
      noImgStyleEl = null;
    }
  }

  applyImageBlock(CFG.noImages);

  // ── Состояние ──────────────────────────────────────────────────────────────
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

  // ── Карточки ───────────────────────────────────────────────────────────────
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
  let playBtn, settingsBtn, prevBtn, nextBtn, settingsPanel, settingsPanelVisible = false;

  // Общий стиль нижней панели кнопок
  const BAR_BOTTOM = '14px';

  function updatePlayBtn(state) {
    if (!playBtn) return;
    // state: 'off' | 'speaking' | 'pause'
    if (state === 'off') {
      playBtn.textContent    = '📢';
      playBtn.style.fontSize = '28px';
    } else if (state === 'speaking') {
      playBtn.textContent    = '🔊';
      playBtn.style.fontSize = '30px';
    } else {
      playBtn.textContent    = '⏸';
      playBtn.style.fontSize = '30px';
    }
  }

  function btnBase(extraStyles) {
    const b = document.createElement('button');
    Object.assign(b.style, {
      position:       'fixed',
      zIndex:         '2147483647',   // максимально возможный z-index
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
      // Гарантируем что кнопка выше любого оверлея YouTube
      pointerEvents:  'all',
      ...extraStyles,
    });
    // подсветка нажатия
    b.addEventListener('pointerdown',  () => b.style.background = 'rgba(60,60,60,0.9)');
    b.addEventListener('pointerup',    () => b.style.background = 'rgba(20,20,20,0.72)');
    b.addEventListener('pointercancel',() => b.style.background = 'rgba(20,20,20,0.72)');
    b.addEventListener('pointerleave', () => b.style.background = 'rgba(20,20,20,0.72)');
    return b;
  }

  function createUI() {
    // ── Play — чуть левее центра ──
    playBtn = btnBase({
      bottom:       BAR_BOTTOM,
      left:         'calc(50% - 42px)',
      width:        '60px',
      height:       '60px',
      borderRadius: '50%',
      fontSize:     '28px',
    });
    updatePlayBtn('off');
    playBtn.addEventListener('click', toggle);
    document.body.appendChild(playBtn);

    // ── Settings — чуть правее центра ──
    settingsBtn = btnBase({
      bottom:       BAR_BOTTOM,
      left:         'calc(50% + 10px)',
      width:        '52px',
      height:       '52px',
      borderRadius: '50%',
      fontSize:     '24px',
      marginTop:    '4px',  // визуальное выравнивание
    });
    settingsBtn.textContent = '⚙️';
    settingsBtn.addEventListener('click', toggleSettings);
    document.body.appendChild(settingsBtn);

    // ── Prev / Next (боковые) ──
    function makeNavBtn(side, label) {
      const b = btnBase({
        top:          '50%',
        transform:    'translateY(-50%)',
        [side]:       '0',
        width:        '52px',
        height:       '288px',
        borderRadius: side === 'left' ? '0 18px 18px 0' : '18px 0 0 18px',
        fontSize:     '52px',
        fontWeight:   'bold',
        display:      'none',
        border:       'none',
      });
      b.textContent = label;
      return b;
    }

    prevBtn = makeNavBtn('left',  '‹');
    nextBtn = makeNavBtn('right', '›');
    prevBtn.addEventListener('click', () => goTo(findCenterIndex() - 1));
    nextBtn.addEventListener('click', () => goTo(findCenterIndex() + 1));
    document.body.appendChild(prevBtn);
    document.body.appendChild(nextBtn);

    // ── Панель настроек ──
    createSettingsPanel();
  }

  // ── Панель настроек ────────────────────────────────────────────────────────
  function createSettingsPanel() {
    settingsPanel = document.createElement('div');
    Object.assign(settingsPanel.style, {
      position:      'fixed',
      bottom:        '84px',
      left:          '50%',
      transform:     'translateX(-50%)',
      zIndex:        '2147483647',
      background:    'rgba(15,15,15,0.97)',
      border:        '1px solid rgba(255,255,255,0.13)',
      borderRadius:  '18px',
      padding:       '18px 16px',
      width:         '280px',
      color:         '#fff',
      fontFamily:    'system-ui,sans-serif',
      fontSize:      '14px',
      boxShadow:     '0 6px 32px rgba(0,0,0,0.8)',
      display:       'none',
      flexDirection: 'column',
      gap:           '16px',
      pointerEvents: 'all',
    });

    settingsPanel.innerHTML = `
      <div style="font-weight:700;font-size:16px">⚙️ Настройки</div>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>Жесты наклона</span>
        <input type="checkbox" id="cfg-tilt" ${CFG.tiltEnabled?'checked':''}
          style="width:22px;height:22px;cursor:pointer;accent-color:#e65c00">
      </label>

      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between">
          <span>Чувствительность наклона</span>
          <b id="cfg-tilt-val">${CFG.tiltThreshold}°</b>
        </div>
        <input type="range" id="cfg-tilt-thresh" min="15" max="70" step="5"
          value="${CFG.tiltThreshold}"
          style="width:100%;accent-color:#e65c00">
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.5">
          <span>← чувствительнее</span><span>грубее →</span>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between">
          <span>Скорость речи</span>
          <b id="cfg-rate-val">${CFG.rate.toFixed(2)}×</b>
        </div>
        <input type="range" id="cfg-rate" min="0.5" max="2.0" step="0.05"
          value="${CFG.rate}"
          style="width:100%;accent-color:#e65c00">
        <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.5">
          <span>← медленнее</span><span>быстрее →</span>
        </div>
      </div>

      <label style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>Скрыть картинки</span>
        <input type="checkbox" id="cfg-noimg" ${CFG.noImages?'checked':''}
          style="width:22px;height:22px;cursor:pointer;accent-color:#e65c00">
      </label>

      <div style="display:flex;gap:8px">
        <button id="cfg-save"
          style="flex:1;padding:11px;border-radius:12px;border:none;
                 background:#e65c00;color:#fff;font-size:14px;font-weight:700;cursor:pointer">
          Сохранить
        </button>
        <button id="cfg-close"
          style="flex:1;padding:11px;border-radius:12px;
                 border:1px solid rgba(255,255,255,0.2);
                 background:transparent;color:#fff;font-size:14px;cursor:pointer">
          Закрыть
        </button>
      </div>

      <button id="cfg-update"
        style="padding:10px;border-radius:12px;
               border:1px solid rgba(255,255,255,0.2);
               background:transparent;color:#fff;font-size:13px;cursor:pointer">
        🔄 Проверить обновление
      </button>
      <div id="cfg-update-status" style="font-size:12px;opacity:.6;text-align:center;min-height:14px"></div>
    `;

    document.body.appendChild(settingsPanel);

    // Events
    const q = s => settingsPanel.querySelector(s);

    q('#cfg-tilt-thresh').addEventListener('input', e =>
      q('#cfg-tilt-val').textContent = e.target.value + '°'
    );
    q('#cfg-rate').addEventListener('input', e =>
      q('#cfg-rate-val').textContent = parseFloat(e.target.value).toFixed(2) + '×'
    );

    q('#cfg-save').addEventListener('click', () => {
      CFG.tiltEnabled   = q('#cfg-tilt').checked;
      CFG.tiltThreshold = parseFloat(q('#cfg-tilt-thresh').value);
      CFG.rate          = parseFloat(q('#cfg-rate').value);
      CFG.noImages      = q('#cfg-noimg').checked;
      saveCFG(CFG);
      applyImageBlock(CFG.noImages);
      if (!CFG.tiltEnabled) disableTilt();
      else if (enabled) enableTilt();
      const btn = q('#cfg-save');
      btn.textContent = '✓ Сохранено';
      setTimeout(() => { btn.textContent = 'Сохранить'; }, 1500);
    });

    q('#cfg-close').addEventListener('click', () => closeSettings());

    q('#cfg-update').addEventListener('click', async () => {
      const st = q('#cfg-update-status');
      st.textContent = 'Проверяю…';
      try {
        const url = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/youtube-tts.user.js';
        const res = await fetch(url + '?t=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const m = text.match(/@version\s+([\d.]+)/);
        const remote = m ? m[1] : '?';
        const local  = '8.0';
        if (remote === local) {
          st.textContent = `✓ Актуальная версия ${local}`;
        } else {
          st.innerHTML = `Новая версия ${remote}! <a href="${url}"
            style="color:#e65c00" target="_blank">Обновить</a>`;
        }
      } catch (err) {
        st.textContent = '⚠️ ' + err.message;
      }
    });

    // Закрытие по тапу вне панели
    document.addEventListener('pointerdown', e => {
      if (settingsPanelVisible &&
          !settingsPanel.contains(e.target) &&
          e.target !== settingsBtn) {
        closeSettings();
      }
    }, { passive: true });
  }

  function toggleSettings() {
    settingsPanelVisible ? closeSettings() : openSettings();
  }
  function openSettings() {
    settingsPanelVisible = true;
    settingsPanel.style.display = 'flex';
  }
  function closeSettings() {
    settingsPanelVisible = false;
    settingsPanel.style.display = 'none';
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

  // ── Инициализация ─────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('yt-tts-play')) return;
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = () => {};
    createUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // SPA
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
