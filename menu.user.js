// ==UserScript==
// @name         menu
// @namespace    https://github.com/vladyslavbokovnia/openscript
// @version      1.0
// @description  Круговое контекстное меню без текста: озвучка с выделенного слова и дальше / стандартное меню
// @license      MIT
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js
// ==/UserScript==

(() => {
  'use strict';

  const R = 62;               // радиус круга до центров кнопок
  const BTN = 52;             // размер кнопки
  const BYPASS_MS = 10000;    // сколько секунд "стандартное меню" остаётся разрешённым
  const MAX_CHARS = 80000;    // лимит текста для озвучки

  let host = null, root = null, wrap = null;
  let isOpen = false;
  let cx = 0, cy = 0;               // точка долгого нажатия
  let snapshot = null;              // последнее выделение
  let bypassUntil = 0;
  let speaking = false;
  let gen = 0;
  const keep = [];                  // защита utterance от сборщика мусора

  const ICONS = {
    read: '<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>'
  };

  /* ---------- UI ---------- */

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .wrap{position:fixed;width:0;height:0;pointer-events:none}
        .disc{position:absolute;left:0;top:0;width:${2 * (R + BTN / 2 + 8)}px;height:${2 * (R + BTN / 2 + 8)}px;
          transform:translate(-50%,-50%) scale(.4);opacity:0;border-radius:50%;
          background:rgba(20,20,22,.28);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
          border:1px solid rgba(255,255,255,.18);transition:transform .16s ease,opacity .16s ease}
        .dot{position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.85);
          transform:translate(-50%,-50%);box-shadow:0 0 0 3px rgba(0,0,0,.25);opacity:0;transition:opacity .16s}
        .btn{position:absolute;left:0;top:0;width:${BTN}px;height:${BTN}px;border-radius:50%;border:0;padding:0;
          display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:auto;
          box-shadow:0 4px 14px rgba(0,0,0,.4);opacity:0;touch-action:manipulation;
          -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;
          transform:translate(-50%,-50%) scale(.2);transition:transform .18s cubic-bezier(.2,1.4,.4,1),opacity .15s}
        .btn svg{width:26px;height:26px;fill:currentColor;pointer-events:none}
        .btn:active{filter:brightness(1.25)}
        .open .disc{transform:translate(-50%,-50%) scale(1);opacity:1}
        .open .dot{opacity:1}
        .open .btn{opacity:1;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1)}
      </style>
      <div class="wrap"><div class="disc"></div><div class="dot"></div></div>`;
    wrap = root.querySelector('.wrap');
    (document.documentElement || document).appendChild(host);
  }

  function open(x, y) {
    ensureHost();
    if (!host.isConnected) (document.documentElement).appendChild(host);

    const m = R + BTN / 2 + 10;
    cx = x; cy = y;
    const px = Math.min(Math.max(x, m), innerWidth - m);
    const py = Math.min(Math.max(y, m), innerHeight - m);
    wrap.style.left = px + 'px';
    wrap.style.top = py + 'px';

    const items = [
      { id: 'read', icon: speaking ? ICONS.stop : ICONS.read, color: '#2f80ed', run: onRead },
      { id: 'menu', icon: ICONS.menu, color: '#48484a', run: onStandard }
    ];

    wrap.querySelectorAll('.btn').forEach(b => b.remove());
    const step = 90;                                  // угол между кнопками
    items.forEach((it, i) => {
      const a = (-90 + (i - (items.length - 1) / 2) * step) * Math.PI / 180;
      const b = document.createElement('button');
      b.className = 'btn';
      b.style.background = it.color;
      b.style.setProperty('--x', Math.cos(a) * R + 'px');
      b.style.setProperty('--y', Math.sin(a) * R + 'px');
      b.innerHTML = it.icon;
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); it.run(); });
      wrap.appendChild(b);
    });

    snapshot = currentRange();
    isOpen = true;
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove('open');
    setTimeout(() => { if (!isOpen) wrap.querySelectorAll('.btn').forEach(b => b.remove()); }, 200);
  }

  /* ---------- выделение ---------- */

  function currentRange() {
    const s = getSelection();
    if (s && s.rangeCount && !s.isCollapsed) return s.getRangeAt(0).cloneRange();
    return null;
  }

  document.addEventListener('selectionchange', () => {
    if (!isOpen) return;
    const r = currentRange();
    if (r) snapshot = r;
  });

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) return { node: p.offsetNode, offset: p.offset };
    }
    if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) return { node: r.startContainer, offset: r.startOffset };
    }
    return null;
  }

  function startPoint() {
    const r = currentRange() || snapshot;
    if (r) return { node: r.startContainer, offset: r.startOffset };
    const c = caretAt(cx, cy);
    if (c && c.node && c.node.nodeType === 3) {
      let o = c.offset;
      while (o > 0 && /[\p{L}\p{N}_]/u.test(c.node.data[o - 1])) o--;   // к началу слова
      return { node: c.node, offset: o };
    }
    return c;
  }

  /* ---------- сбор текста от точки до конца страницы ---------- */

  function collectText(start) {
    if (!start || !document.body) return '';
    const vis = new Map();
    const visible = el => {
      if (vis.has(el)) return vis.get(el);
      let v = true;
      if (el.checkVisibility) v = el.checkVisibility({ checkVisibilityCSS: true });
      else v = el.getClientRects().length > 0;
      vis.set(el, v);
      return v;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|SELECT|OPTION|SVG)$/i.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (!n.data.trim()) return NodeFilter.FILTER_REJECT;
        return visible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    const parts = [];
    let total = 0;
    const push = t => { parts.push(t); total += t.length; };

    walker.currentNode = start.node;
    if (start.node.nodeType === 3) push(start.node.data.slice(start.offset));
    let n;
    while ((n = walker.nextNode()) && total < MAX_CHARS) push(n.data);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function chunk(text) {
    const sentences = text.match(/[^.!?…。]+[.!?…。]*\s*/g) || [text];
    const out = [];
    let buf = '';
    for (const s of sentences) {
      if ((buf + s).length <= 180) { buf += s; continue; }
      if (buf) out.push(buf);
      buf = '';
      if (s.length <= 180) { buf = s; continue; }
      const words = s.split(' ');
      let line = '';
      for (const w of words) {
        if ((line + ' ' + w).length > 180) { out.push(line); line = w; }
        else line += (line ? ' ' : '') + w;
      }
      buf = line;
    }
    if (buf) out.push(buf);
    return out.map(s => s.trim()).filter(Boolean);
  }

  /* ---------- озвучка ---------- */

  function stopReading() {
    gen++;
    speaking = false;
    try { speechSynthesis.cancel(); } catch (e) {}
  }

  function startReading(text) {
    if (!('speechSynthesis' in window)) return;
    stopReading();
    const my = gen;
    const chunks = chunk(text);
    const lang = document.documentElement.lang || navigator.language || 'ru-RU';
    let i = 0;
    speaking = true;

    const next = () => {
      if (my !== gen) return;
      if (i >= chunks.length) { speaking = false; return; }
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = lang;
      u.onend = next;
      u.onerror = next;
      keep.push(u);
      if (keep.length > 5) keep.shift();
      speechSynthesis.speak(u);
    };
    setTimeout(next, 80);
  }

  function onRead() {
    if (speaking) { stopReading(); close(); return; }
    const text = collectText(startPoint());
    close();
    if (text) startReading(text);
  }

  /* ---------- стандартное меню ---------- */

  function onStandard() {
    // Программно открыть системное меню браузер не позволяет,
    // поэтому на 10 секунд отключаем перехват: следующее долгое нажатие откроет родное меню.
    bypassUntil = Date.now() + BYPASS_MS;
    if (navigator.vibrate) navigator.vibrate(25);
    close();
  }

  /* ---------- перехват ---------- */

  window.addEventListener('contextmenu', e => {
    if (Date.now() < bypassUntil) { bypassUntil = 0; return; }     // пропускаем родное меню один раз
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    open(e.clientX, e.clientY);
  }, true);

  window.addEventListener('pointerdown', e => {
    if (isOpen && !e.composedPath().includes(host)) close();
  }, true);

  window.addEventListener('scroll', () => close(), { passive: true, capture: true });
  window.addEventListener('pagehide', () => { try { speechSynthesis.cancel(); } catch (e) {} });
})();
