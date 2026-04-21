// ==UserScript==
// @name         Phantom Opera
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Ghost of Opera TTS + Memory Slideshow for Telegram Web
// @match        https://web.telegram.org/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/phantom_opera.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/phantom_opera.user.js
// ==/UserScript==

(function () {
  'use strict';

  const MEMORY_URL = 'http://localhost:3000';

  const CSS = `
    #phantom-panel {
      position: fixed; bottom: 20px; right: 20px;
      width: 340px; background: #1a1a2e;
      border: 1px solid #e94560; border-radius: 12px;
      color: #eee; font-family: serif; z-index: 99999;
      box-shadow: 0 0 20px #e9456055;
      display: none; flex-direction: column;
    }
    #phantom-header {
      padding: 10px 14px; font-size: 13px; color: #e94560;
      letter-spacing: 1px; border-bottom: 1px solid #e9456033;
      display: flex; justify-content: space-between; align-items: center;
    }
    #phantom-tabs {
      display: flex; border-bottom: 1px solid #e9456033;
    }
    .ph-tab {
      flex: 1; padding: 7px; text-align: center; font-size: 12px;
      cursor: pointer; color: #aaa; border: none; background: none;
      border-bottom: 2px solid transparent;
    }
    .ph-tab.active { color: #e94560; border-bottom-color: #e94560; }
    #phantom-tts-pane, #phantom-memory-pane { display: none; flex-direction: column; }
    #phantom-tts-pane.active, #phantom-memory-pane.active { display: flex; }

    /* TTS pane */
    #phantom-text {
      padding: 12px 14px; font-size: 14px; line-height: 1.6;
      max-height: 160px; overflow-y: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    #phantom-text .word { cursor: pointer; border-radius: 3px; padding: 0 1px; }
    #phantom-text .word.active { background: #e94560; color: #fff; }
    #phantom-controls {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; border-top: 1px solid #e9456033;
    }
    #phantom-ring {
      position: relative; width: 48px; height: 48px; flex-shrink: 0; cursor: pointer;
    }
    #phantom-ring svg { position: absolute; top:0; left:0; transform: rotate(-90deg); }
    #phantom-ring-btn {
      position: absolute; inset: 0; display: flex;
      align-items: center; justify-content: center;
      font-size: 18px; user-select: none;
    }
    #phantom-seek {
      flex: 1; -webkit-appearance: none; height: 4px;
      background: #e9456044; border-radius: 2px; outline: none; cursor: pointer;
    }
    #phantom-seek::-webkit-slider-thumb {
      -webkit-appearance: none; width: 12px; height: 12px;
      background: #e94560; border-radius: 50%;
    }

    /* Memory slideshow pane */
    #phantom-memory-pane { padding: 10px 14px; gap: 8px; }
    #phantom-slide {
      position: relative; width: 100%; height: 160px;
      background: #0f0f1a; border-radius: 8px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
    }
    #phantom-slide-img {
      width: 100%; height: 100%; object-fit: cover;
      display: none; border-radius: 8px;
    }
    #phantom-slide-text {
      position: absolute; inset: 0; display: flex;
      align-items: center; justify-content: center;
      padding: 12px; font-size: 13px; line-height: 1.5;
      text-align: center; color: #eee; background: #0f0f1a88;
    }
    #phantom-slide-nav {
      display: flex; align-items: center; justify-content: space-between;
    }
    .ph-nav-btn {
      background: #e94560; border: none; border-radius: 6px;
      color: #fff; padding: 4px 10px; cursor: pointer; font-size: 14px;
    }
    .ph-nav-btn:disabled { opacity: .3; cursor: default; }
    #phantom-slide-counter { font-size: 11px; color: #aaa; }
    #phantom-slide-caption {
      font-size: 12px; color: #ccc; text-align: center;
      max-height: 48px; overflow-y: auto; line-height: 1.4;
    }
    #phantom-mem-controls { display: flex; gap: 6px; }
    #phantom-mem-controls input {
      flex: 1; background: #0f0f1a; border: 1px solid #e9456055;
      border-radius: 6px; color: #eee; padding: 4px 8px; font-size: 12px; outline: none;
    }
    #phantom-mem-controls button {
      background: #e94560; border: none; border-radius: 6px;
      color: #fff; padding: 4px 8px; font-size: 11px; cursor: pointer;
    }
    #phantom-slide-tts-btn {
      background: none; border: 1px solid #e94560; border-radius: 6px;
      color: #e94560; padding: 3px 8px; font-size: 11px; cursor: pointer;
    }

    #phantom-close { cursor: pointer; font-size: 16px; opacity: .6; }
    #phantom-close:hover { opacity: 1; }
    .phantom-btn {
      position: absolute; bottom: 4px; right: 4px;
      background: #e94560; color: #fff; border: none;
      border-radius: 50%; width: 22px; height: 22px;
      font-size: 12px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      z-index: 9999;
    }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'phantom-panel';
  panel.innerHTML = `
    <div id="phantom-header">
      🎭 ПРИЗРАК ОПЕРЫ
      <span id="phantom-close">✕</span>
    </div>
    <div id="phantom-tabs">
      <button class="ph-tab active" data-tab="tts">🔊 TTS</button>
      <button class="ph-tab" data-tab="memory">🧠 Память</button>
    </div>

    <div id="phantom-tts-pane" class="active">
      <div id="phantom-text"></div>
      <div id="phantom-controls">
        <div id="phantom-ring">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="#e9456033" stroke-width="4"/>
            <circle id="phantom-arc" cx="24" cy="24" r="20" fill="none"
              stroke="#e94560" stroke-width="4"
              stroke-dasharray="125.66" stroke-dashoffset="125.66"
              stroke-linecap="round"/>
          </svg>
          <div id="phantom-ring-btn">▶</div>
        </div>
        <input type="range" id="phantom-seek" min="0" max="100" value="0">
      </div>
    </div>

    <div id="phantom-memory-pane">
      <div id="phantom-slide">
        <img id="phantom-slide-img" alt="">
        <div id="phantom-slide-text">Нет записей</div>
      </div>
      <div id="phantom-slide-nav">
        <button class="ph-nav-btn" id="ph-prev">◀</button>
        <span id="phantom-slide-counter">0 / 0</span>
        <button class="ph-nav-btn" id="ph-next">▶</button>
      </div>
      <div id="phantom-slide-caption"></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button id="phantom-slide-tts-btn">🔊 Озвучить</button>
        <button id="ph-auto-btn" style="background:none;border:1px solid #e9456055;border-radius:6px;color:#aaa;padding:3px 8px;font-size:11px;cursor:pointer">▶ Авто</button>
      </div>
      <div id="phantom-mem-controls">
        <input id="phantom-memory-input" placeholder="Сохранить или найти...">
        <button id="phantom-mem-save">💾</button>
        <button id="phantom-mem-search">🔍</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // --- Tab switching ---
  let currentTab = 'tts';
  panel.querySelectorAll('.ph-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTab = tab.dataset.tab;
      panel.querySelectorAll('.ph-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.getElementById('phantom-tts-pane').classList.toggle('active', currentTab === 'tts');
      document.getElementById('phantom-memory-pane').classList.toggle('active', currentTab === 'memory');
      if (currentTab === 'memory') loadSlides();
    });
  });

  // --- TTS ---
  let utterance = null, words = [], wordIndex = 0, isSpeaking = false;
  let seekTarget = null, currentText = '';
  const arc = document.getElementById('phantom-arc');
  const ringBtn = document.getElementById('phantom-ring-btn');
  const seekEl = document.getElementById('phantom-seek');
  const textEl = document.getElementById('phantom-text');
  const CIRC = 125.66;

  function setProgress(p) {
    arc.style.strokeDashoffset = CIRC * (1 - p);
    seekEl.value = Math.round(p * 100);
  }

  function highlightWord(i) {
    words.forEach((w, j) => w.classList.toggle('active', j === i));
    if (words[i]) words[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function speak(fromIndex = 0, text_override) {
    window.speechSynthesis.cancel();
    const src = text_override || words.slice(fromIndex).map(w => w.textContent).join(' ');
    wordIndex = fromIndex;
    utterance = new SpeechSynthesisUtterance(src);
    utterance.lang = 'ru-RU';
    if (!text_override) {
      utterance.onboundary = (e) => {
        if (e.name !== 'word') return;
        const idx = fromIndex + src.slice(0, e.charIndex).trim().split(/\s+/).filter(Boolean).length;
        wordIndex = idx;
        highlightWord(idx);
        setProgress(idx / words.length);
      };
      utterance.onend = () => {
        isSpeaking = false; ringBtn.textContent = '▶';
        setProgress(1); highlightWord(-1);
      };
    }
    window.speechSynthesis.speak(utterance);
    isSpeaking = true;
    if (!text_override) ringBtn.textContent = '⏸';
  }

  document.getElementById('phantom-ring').addEventListener('click', () => {
    if (isSpeaking) {
      window.speechSynthesis.pause(); isSpeaking = false; ringBtn.textContent = '▶';
    } else if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume(); isSpeaking = true; ringBtn.textContent = '⏸';
    } else {
      speak(wordIndex);
    }
  });

  seekEl.addEventListener('input', () => {
    seekTarget = Math.floor((seekEl.value / 100) * words.length);
  });
  seekEl.addEventListener('change', () => {
    if (seekTarget !== null) { speak(seekTarget); seekTarget = null; }
  });

  // --- Memory slideshow ---
  let slides = [], slideIdx = 0, autoTimer = null;

  function memoryRequest(method, path, data, cb) {
    GM_xmlhttpRequest({
      method, url: MEMORY_URL + path,
      headers: { 'Content-Type': 'application/json' },
      data: data ? JSON.stringify(data) : undefined,
      onload: r => { try { cb(null, JSON.parse(r.responseText || '{}')); } catch(e) { cb(e); } },
      onerror: e => cb(e)
    });
  }

  // Generate a simple image from text using Canvas (no external API needed)
  function textToDataURL(text) {
    const c = document.createElement('canvas');
    c.width = 312; c.height = 160;
    const ctx = c.getContext('2d');
    // gradient background
    const grad = ctx.createLinearGradient(0, 0, 312, 160);
    grad.addColorStop(0, '#1a1a2e');
    grad.addColorStop(1, '#16213e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 312, 160);
    // decorative border
    ctx.strokeStyle = '#e9456066';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, 304, 152);
    // text
    ctx.fillStyle = '#eee';
    ctx.font = '13px serif';
    ctx.textAlign = 'center';
    const maxW = 280, lineH = 20;
    const words = text.split(' ');
    let line = '', lines = [];
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    const startY = 80 - (lines.length * lineH) / 2 + lineH / 2;
    lines.forEach((l, i) => ctx.fillText(l, 156, startY + i * lineH));
    return c.toDataURL();
  }

  function renderSlide() {
    const img = document.getElementById('phantom-slide-img');
    const txt = document.getElementById('phantom-slide-text');
    const cap = document.getElementById('phantom-slide-caption');
    const counter = document.getElementById('phantom-slide-counter');
    const prev = document.getElementById('ph-prev');
    const next = document.getElementById('ph-next');

    if (!slides.length) {
      img.style.display = 'none'; txt.textContent = 'Нет записей';
      cap.textContent = ''; counter.textContent = '0 / 0';
      prev.disabled = next.disabled = true;
      return;
    }

    const s = slides[slideIdx];
    const content = s.content || s.text || '';
    img.src = textToDataURL(content);
    img.style.display = 'block';
    txt.textContent = '';
    cap.textContent = content;
    counter.textContent = `${slideIdx + 1} / ${slides.length}`;
    prev.disabled = slideIdx === 0;
    next.disabled = slideIdx === slides.length - 1;
  }

  function loadSlides(query) {
    const path = query
      ? `/memory/search?q=${encodeURIComponent(query)}&limit=20`
      : '/memory?limit=20';
    memoryRequest('GET', path, null, (err, data) => {
      slides = (data.results || data.memories || []);
      slideIdx = 0;
      renderSlide();
    });
  }

  document.getElementById('ph-prev').addEventListener('click', () => {
    if (slideIdx > 0) { slideIdx--; renderSlide(); }
  });
  document.getElementById('ph-next').addEventListener('click', () => {
    if (slideIdx < slides.length - 1) { slideIdx++; renderSlide(); }
  });

  document.getElementById('phantom-slide-tts-btn').addEventListener('click', () => {
    if (!slides.length) return;
    const content = slides[slideIdx].content || slides[slideIdx].text || '';
    speak(0, content);
  });

  // Auto slideshow
  document.getElementById('ph-auto-btn').addEventListener('click', function() {
    if (autoTimer) {
      clearInterval(autoTimer); autoTimer = null;
      this.textContent = '▶ Авто';
    } else {
      this.textContent = '⏹ Стоп';
      autoTimer = setInterval(() => {
        if (!slides.length) return;
        const content = slides[slideIdx].content || slides[slideIdx].text || '';
        speak(0, content);
        setTimeout(() => {
          slideIdx = (slideIdx + 1) % slides.length;
          renderSlide();
        }, 3000);
      }, 5000);
    }
  });

  document.getElementById('phantom-mem-save').addEventListener('click', () => {
    const note = document.getElementById('phantom-memory-input').value.trim() || currentText;
    if (!note) return;
    memoryRequest('POST', '/memory', { content: note, metadata: { source: 'phantom_opera', url: location.href } }, (err) => {
      if (!err) { loadSlides(); document.getElementById('phantom-memory-input').value = ''; }
    });
  });

  document.getElementById('phantom-mem-search').addEventListener('click', () => {
    const q = document.getElementById('phantom-memory-input').value.trim();
    loadSlides(q || undefined);
  });

  // --- Panel open/close ---
  document.getElementById('phantom-close').addEventListener('click', () => {
    window.speechSynthesis.cancel();
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    panel.style.display = 'none';
    isSpeaking = false;
  });

  function openPanel(text) {
    window.speechSynthesis.cancel();
    isSpeaking = false; wordIndex = 0; currentText = text;
    setProgress(0); ringBtn.textContent = '▶';

    const rawWords = text.trim().split(/\s+/);
    textEl.innerHTML = rawWords.map((w, i) =>
      `<span class="word" data-i="${i}">${w}</span>`
    ).join(' ');
    words = Array.from(textEl.querySelectorAll('.word'));
    words.forEach(w => w.addEventListener('click', () => speak(+w.dataset.i)));

    // switch to TTS tab
    panel.querySelectorAll('.ph-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'tts'));
    document.getElementById('phantom-tts-pane').classList.add('active');
    document.getElementById('phantom-memory-pane').classList.remove('active');
    currentTab = 'tts';

    panel.style.display = 'flex';
  }

  function injectButtons() {
    document.querySelectorAll('.message').forEach(msg => {
      if (msg.querySelector('.phantom-btn')) return;
      const textNode = msg.querySelector('.text-content, .message-text, span.translatable-message');
      if (!textNode || !textNode.textContent.trim()) return;

      const btn = document.createElement('button');
      btn.className = 'phantom-btn';
      btn.title = 'Озвучить';
      btn.textContent = '🎭';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPanel(textNode.textContent.trim());
      });

      msg.style.position = 'relative';
      msg.appendChild(btn);
    });
  }

  const observer = new MutationObserver(injectButtons);
  observer.observe(document.body, { childList: true, subtree: true });
  injectButtons();
})();
