// ==UserScript==
// @name         Phantom Opera
// @namespace    http://tampermonkey.net/
// @version      4.0
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
  const CIRC = 2 * Math.PI * 28; // r=28

  const CSS = `
    .ph-msg-block {
      position: relative;
      width: 220px; height: 220px;
      background: #1a1a2e;
      border: 1px solid #e94560;
      border-radius: 12px;
      overflow: hidden;
      margin: 4px 0;
      display: inline-flex;
      flex-direction: column;
      cursor: pointer;
      box-shadow: 0 0 12px #e9456033;
    }
    .ph-msg-text {
      flex: 1;
      overflow: hidden;
      padding: 10px 12px 0;
      font-size: 13px;
      line-height: 1.6;
      color: #eee;
      font-family: serif;
      white-space: pre-wrap;
      word-break: break-word;
      scroll-behavior: smooth;
    }
    .ph-msg-text .word { border-radius: 3px; padding: 0 1px; }
    .ph-msg-text .word.active { background: #e94560; color: #fff; }
    .ph-msg-footer {
      height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .ph-ring {
      position: relative;
      width: 64px; height: 64px;
      touch-action: none;
      user-select: none;
    }
    .ph-ring svg {
      position: absolute; top: 0; left: 0;
      transform: rotate(-90deg);
    }
    .ph-ring-btn {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; color: #eee;
    }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // Active TTS state
  let activeBlock = null;
  let activeWords = [];
  let activeWordIdx = 0;
  let activeSpeaking = false;
  let activeUtterance = null;

  function stopCurrent() {
    window.speechSynthesis.cancel();
    activeSpeaking = false;
    if (activeBlock) {
      setRingProgress(activeBlock, 0);
      setRingBtn(activeBlock, '▶');
      activeBlock.querySelectorAll('.word.active').forEach(w => w.classList.remove('active'));
    }
    activeBlock = null;
    activeWords = [];
    activeWordIdx = 0;
    activeUtterance = null;
  }

  function setRingProgress(block, p) {
    const arc = block.querySelector('.ph-arc');
    if (arc) arc.style.strokeDashoffset = CIRC * (1 - p);
  }

  function setRingBtn(block, ch) {
    const btn = block.querySelector('.ph-ring-btn');
    if (btn) btn.textContent = ch;
  }

  function highlightAndScroll(block, idx) {
    const words = block.querySelectorAll('.word');
    words.forEach((w, i) => w.classList.toggle('active', i === idx));
    if (words[idx]) {
      const textEl = block.querySelector('.ph-msg-text');
      const wTop = words[idx].offsetTop;
      const wH = words[idx].offsetHeight;
      const tH = textEl.clientHeight;
      // smooth scroll so active word is centered
      textEl.scrollTo({ top: wTop - tH / 2 + wH / 2, behavior: 'smooth' });
    }
  }

  function speakBlock(block, fromIdx) {
    window.speechSynthesis.cancel();
    activeBlock = block;
    activeWords = Array.from(block.querySelectorAll('.word'));
    activeWordIdx = fromIdx;
    activeSpeaking = true;
    setRingBtn(block, '⏸');

    const src = activeWords.slice(fromIdx).map(w => w.textContent).join(' ');
    activeUtterance = new SpeechSynthesisUtterance(src);
    activeUtterance.lang = 'ru-RU';

    activeUtterance.onboundary = (e) => {
      if (e.name !== 'word') return;
      const before = src.slice(0, e.charIndex);
      const idx = fromIdx + (before.trim() === '' ? 0 : before.trim().split(/\s+/).length);
      activeWordIdx = idx;
      highlightAndScroll(block, idx);
      setRingProgress(block, idx / activeWords.length);
    };

    activeUtterance.onend = () => {
      activeSpeaking = false;
      setRingBtn(block, '▶');
      setRingProgress(block, 1);
    };

    window.speechSynthesis.speak(activeUtterance);
  }

  function buildBlock(text) {
    const block = document.createElement('div');
    block.className = 'ph-msg-block';

    const textEl = document.createElement('div');
    textEl.className = 'ph-msg-text';
    const rawWords = text.trim().split(/\s+/);
    textEl.innerHTML = rawWords.map((w, i) =>
      `<span class="word" data-i="${i}">${w}</span>`
    ).join(' ');
    block.appendChild(textEl);

    const footer = document.createElement('div');
    footer.className = 'ph-msg-footer';

    const ring = document.createElement('div');
    ring.className = 'ph-ring';
    ring.innerHTML = `
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="28" fill="none" stroke="#e9456033" stroke-width="5"/>
        <circle class="ph-arc" cx="32" cy="32" r="28" fill="none"
          stroke="#e94560" stroke-width="5"
          stroke-dasharray="${CIRC.toFixed(2)}" stroke-dashoffset="${CIRC.toFixed(2)}"
          stroke-linecap="round"/>
      </svg>
      <div class="ph-ring-btn">▶</div>
    `;
    footer.appendChild(ring);
    block.appendChild(footer);

    // Play/pause on ring click
    ring.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeBlock === block) {
        if (activeSpeaking) {
          window.speechSynthesis.pause();
          activeSpeaking = false;
          setRingBtn(block, '▶');
        } else if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          activeSpeaking = true;
          setRingBtn(block, '⏸');
        } else {
          speakBlock(block, activeWordIdx);
        }
      } else {
        stopCurrent();
        speakBlock(block, 0);
      }
    });

    // Swipe on ring = seek
    let swipeStartX = null, swipeStartOffset = null;
    ring.addEventListener('pointerdown', (e) => {
      swipeStartX = e.clientX;
      swipeStartOffset = activeBlock === block ? activeWordIdx / Math.max(activeWords.length, 1) : 0;
      ring.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    ring.addEventListener('pointermove', (e) => {
      if (swipeStartX === null) return;
      const dx = e.clientX - swipeStartX;
      const delta = dx / 120; // 120px = full range
      const p = Math.max(0, Math.min(1, swipeStartOffset + delta));
      setRingProgress(block, p);
      e.stopPropagation();
    });
    ring.addEventListener('pointerup', (e) => {
      if (swipeStartX === null) return;
      const dx = e.clientX - swipeStartX;
      const delta = dx / 120;
      const p = Math.max(0, Math.min(1, swipeStartOffset + delta));
      const words = Array.from(block.querySelectorAll('.word'));
      const idx = Math.floor(p * words.length);
      swipeStartX = null;
      stopCurrent();
      speakBlock(block, idx);
      e.stopPropagation();
    });

    // Click on word = seek to word
    textEl.querySelectorAll('.word').forEach(w => {
      w.addEventListener('click', (e) => {
        e.stopPropagation();
        stopCurrent();
        speakBlock(block, +w.dataset.i);
      });
    });

    return block;
  }

  function injectBlocks() {
    document.querySelectorAll('.message, .Message').forEach(msg => {
      if (msg.querySelector('.ph-msg-block')) return;
      const textNode = msg.querySelector('.text-content, .message-text, span.translatable-message, .text-entity-link, .text');
      if (!textNode || !textNode.textContent.trim()) return;

      const text = textNode.textContent.trim();
      if (!/[а-яёА-ЯЁ]/.test(text)) return;
      const block = buildBlock(text);

      // Insert block after the message text container
      const parent = textNode.closest('.message-content, .bubble-content, .message') || textNode.parentElement;
      parent.insertAdjacentElement('afterend', block);
    });
  }

  const observer = new MutationObserver(injectBlocks);
  observer.observe(document.body, { childList: true, subtree: true });
  injectBlocks();
})();
