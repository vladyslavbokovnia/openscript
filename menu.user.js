// ==UserScript==
// @name         menu
// @namespace    https://github.com/vladyslavbokovnia/openscript
// @version      1.2.1
// @description  Круговое контекстное меню без текста: озвучка (подсветка, плавная прокрутка, переход тапом), открыть ссылку в новой вкладке, стандартное меню
// @license      MIT
// @match        *://*/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js
// ==/UserScript==

(() => {
  'use strict';

  const RADIUS = 62;          // радиус круга до центров кнопок
  const BTN = 52;             // размер кнопки
  const BYPASS_MS = 20000;    // сколько "стандартное меню" ждёт следующего долгого нажатия
  const MAX_CHARS = 400000;   // лимит текста страницы для озвучки
  const MAX_CHUNK = 220;      // максимальная длина одного фрагмента речи
  const CPS = 15;             // символов в секунду (оценка, если нет событий слов)
  const SCROLL_TAU = 0.9;     // постоянная сглаживания прокрутки, секунды (больше = мягче)
  const SCROLL_MAX = 2400;    // максимальная скорость прокрутки, px/с
  const RAW = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js';

  /* ---------- настройки (выключатели) ---------- */

  const DEF = { read: true, hlSentence: true, hlWord: true, scroll: true, tap: true, link: true };
  const LABELS = {
    read: 'Озвучка',
    hlSentence: 'Подсветка предложения',
    hlWord: 'Подсветка слова',
    scroll: 'Плавная прокрутка',
    tap: 'Переход по тексту тапом',
    link: 'Открыть ссылку в новой вкладке'
  };
  const cfg = {};
  for (const k of Object.keys(DEF)) {
    let v = DEF[k];
    try { v = GM_getValue(k, DEF[k]); } catch (e) {}
    cfg[k] = !!v;
    try { GM_addValueChangeListener(k, (n, o, nv) => { cfg[k] = !!nv; }); } catch (e) {}
  }

  let menuIds = [];
  function buildMenu() {
    if (window.top !== window || typeof GM_registerMenuCommand !== 'function') return;
    menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
    menuIds = [];
    for (const k of Object.keys(LABELS)) {
      menuIds.push(GM_registerMenuCommand((cfg[k] ? '✅ ' : '⬜ ') + LABELS[k], () => {
        cfg[k] = !cfg[k];
        try { GM_setValue(k, cfg[k]); } catch (e) {}
        if (k === 'read' && !cfg.read) stopReading();
        if (k === 'hlSentence' || k === 'hlWord') repaint();
        buildMenu();
      }, { autoClose: false }));
    }
    menuIds.push(GM_registerMenuCommand('🔄 Обновить', checkUpdate));
  }

  /* ---------- состояние ---------- */

  let host = null, root = null, wrap = null, badge = null, badgeTimer = 0;
  let isOpen = false;
  let cx = 0, cy = 0;
  let snapshot = null;
  let bypassUntil = 0;
  let linkEl = null;
  const keep = [];

  const S = {
    state: 'idle',        // idle | playing | paused
    doc: null, chunks: [], gen: 0,
    ci: 0, cs: 0, ce: 0, t0: 0,
    lastIdx: 0, boundaryAt: 0, resumeIdx: 0,
    raf: 0, lastTs: 0, noScrollUntil: 0, sy: null, sp: null,
    tmp: null
  };

  const ICONS = {
    read: '<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    menu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="19" r="2.2"/></svg>',
    newtab: '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/></g></svg>'
  };

  /* ---------- подсветка (CSS Custom Highlight API) ---------- */

  let HL = null;
  try {
    if (typeof Highlight !== 'undefined' && CSS.highlights) {
      HL = { sent: new Highlight(), word: new Highlight() };
      HL.word.priority = 1;
      CSS.highlights.set('menu-sent', HL.sent);
      CSS.highlights.set('menu-word', HL.word);
    }
  } catch (e) { HL = null; }

  const HL_CSS = '::highlight(menu-sent){background-color:rgba(255,214,0,.32)}::highlight(menu-word){background-color:rgba(47,128,237,.5)}';
  try { GM_addStyle(HL_CSS); } catch (e) {
    const st = document.createElement('style'); st.textContent = HL_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- UI ---------- */

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .wrap{position:fixed;width:0;height:0;pointer-events:none}
        .disc{position:absolute;left:0;top:0;width:${2 * (RADIUS + BTN / 2 + 8)}px;height:${2 * (RADIUS + BTN / 2 + 8)}px;
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
        .badge{position:fixed;right:16px;bottom:16px;width:42px;height:42px;border-radius:50%;background:#48484a;color:#fff;
          display:none;align-items:center;justify-content:center;pointer-events:none;
          box-shadow:0 0 0 0 rgba(255,255,255,.6);animation:pulse 1.4s infinite}
        .badge.on{display:flex}
        .badge svg{width:22px;height:22px;fill:currentColor}
        @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}70%{box-shadow:0 0 0 14px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
      </style>
      <div class="wrap"><div class="disc"></div><div class="dot"></div></div>
      <div class="badge">${ICONS.menu}</div>`;
    wrap = root.querySelector('.wrap');
    badge = root.querySelector('.badge');
    (document.documentElement || document).appendChild(host);
  }

  function buildItems() {
    const items = [];
    if (cfg.read) {
      if (S.state === 'playing') items.push({ icon: ICONS.pause, color: '#2f80ed', run: () => { pauseReading(); close(); } });
      else if (S.state === 'paused') items.push({ icon: ICONS.read, color: '#2f80ed', run: () => { close(); resumeReading(); } });
      else items.push({ icon: ICONS.read, color: '#2f80ed', run: onRead });
      if (S.state !== 'idle') items.push({ icon: ICONS.stop, color: '#d64545', run: () => { stopReading(); close(); } });
    }
    if (cfg.link && linkEl) {
      const href = linkEl.href;
      items.push({ icon: ICONS.newtab, color: '#2e9e5b', run: () => { close(); openLink(href); } });
    }
    items.push({ icon: ICONS.menu, color: '#48484a', run: onStandard });
    return items;
  }

  function open(x, y, items) {
    ensureHost();
    if (!host.isConnected) document.documentElement.appendChild(host);

    const m = RADIUS + BTN / 2 + 10;
    cx = x; cy = y;
    wrap.style.left = Math.min(Math.max(x, m), innerWidth - m) + 'px';
    wrap.style.top = Math.min(Math.max(y, m), innerHeight - m) + 'px';

    wrap.querySelectorAll('.btn').forEach(b => b.remove());
    const n = items.length;
    const step = n <= 2 ? 90 : n === 3 ? 70 : 60;
    items.forEach((it, i) => {
      const a = (-90 + (i - (n - 1) / 2) * step) * Math.PI / 180;
      const b = document.createElement('button');
      b.className = 'btn';
      b.style.background = it.color;
      b.style.setProperty('--x', Math.cos(a) * RADIUS + 'px');
      b.style.setProperty('--y', Math.sin(a) * RADIUS + 'px');
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

  function showBadge() {
    ensureHost();
    badge.classList.add('on');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(hideBadge, BYPASS_MS);
  }
  function hideBadge() {
    clearTimeout(badgeTimer);
    if (badge) badge.classList.remove('on');
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
    return caretAt(cx, cy);
  }

  /* ---------- модель текста страницы ---------- */

  function buildDoc() {
    const segs = [];
    const map = new Map();
    let text = '';
    const vis = new Map(), blk = new Map();

    const visible = el => {
      if (vis.has(el)) return vis.get(el);
      let v = true;
      try { v = el.checkVisibility ? el.checkVisibility({ checkVisibilityCSS: true }) : el.getClientRects().length > 0; } catch (e) {}
      vis.set(el, v);
      return v;
    };
    const blockOf = el => {
      if (blk.has(el)) return blk.get(el);
      let e = el, res = document.body;
      while (e && e !== document.body) {
        const d = getComputedStyle(e).display;
        if (!/^inline/.test(d) && d !== 'contents') { res = e; break; }
        e = e.parentElement;
      }
      blk.set(el, res);
      return res;
    };

    if (!document.body) return { segs, map, text };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|SELECT|OPTION)$/i.test(p.tagName) || p.closest('svg')) return NodeFilter.FILTER_REJECT;
        if (!n.data.trim()) return NodeFilter.FILTER_REJECT;
        return visible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });

    let lastBlock = null, n;
    while ((n = walker.nextNode())) {
      const b = blockOf(n.parentElement);
      if (segs.length) text += (b !== lastBlock ? '\n' : ' ');
      lastBlock = b;
      segs.push({ node: n, g: text.length, len: n.data.length });
      map.set(n, segs.length - 1);
      text += n.data.replace(/\s/g, ' ');      // длина сохраняется, \n только наши разделители
      if (text.length > MAX_CHARS) break;
    }
    return { segs, map, text };
  }

  function makeChunks(text) {
    const out = [];
    const push = (s, e) => {
      while (s < e && text[s] === ' ') s++;
      while (e > s && text[e - 1] === ' ') e--;
      if (e <= s || !/[\p{L}\p{N}]/u.test(text.slice(s, e))) return;
      while (e - s > MAX_CHUNK) {
        let cut = text.lastIndexOf(' ', s + MAX_CHUNK);
        if (cut <= s + 40) cut = s + MAX_CHUNK;
        out.push({ s, e: cut });
        s = cut;
        while (s < e && text[s] === ' ') s++;
      }
      out.push({ s, e });
    };
    const re = /[^\n]+?(?:[.!?…。]+["'»”)\]]*(?=\s|$)|(?=\n)|$)/g;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      push(m.index, m.index + m[0].length);
    }
    return out;
  }

  function chunkAt(idx) {
    const cs = S.chunks;
    let lo = 0, hi = cs.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cs[mid].e > idx) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  function toGlobal(node, offset) {
    const D = S.doc;
    if (!D || !node) return null;
    const i = D.map.get(node);
    if (i !== undefined) return D.segs[i].g + Math.min(offset, D.segs[i].len);
    let ref = node;
    if (node.nodeType === 1 && node.childNodes[offset]) ref = node.childNodes[offset];
    for (const sg of D.segs) {
      if (ref === sg.node || (ref.contains && ref.contains(sg.node)) ||
          (ref.compareDocumentPosition(sg.node) & Node.DOCUMENT_POSITION_FOLLOWING)) return sg.g;
    }
    return null;
  }

  function pos(idx) {
    const sg = S.doc.segs;
    let lo = 0, hi = sg.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sg[mid].g <= idx) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const s = sg[ans];
    return { node: s.node, offset: Math.max(0, Math.min(idx - s.g, s.node.data.length)) };
  }

  function rangeOf(a, b, reuse) {
    const r = reuse || document.createRange();
    const p = pos(a), q = pos(Math.max(a, b - 1));
    r.setStart(p.node, p.offset);
    r.setEnd(q.node, Math.min(q.offset + 1, q.node.data.length));
    return r;
  }

  function wordLenAt(i) {
    const m = /^[\p{L}\p{N}_'’-]+/u.exec(S.doc.text.slice(i, i + 40));
    return m ? m[0].length : 1;
  }

  /* ---------- подсветка ---------- */

  function paintSentence(a, b) {
    if (!HL) return;
    HL.sent.clear(); HL.word.clear();
    if (!cfg.hlSentence) return;
    try { HL.sent.add(rangeOf(a, b)); } catch (e) {}
  }
  function paintWord(i, len) {
    if (!HL) return;
    HL.word.clear();
    if (!cfg.hlWord) return;
    try { HL.word.add(rangeOf(i, i + (len > 0 ? len : wordLenAt(i)))); } catch (e) {}
  }
  function repaint() {
    if (!HL) return;
    if (S.state === 'idle') { HL.sent.clear(); HL.word.clear(); return; }
    paintSentence(S.cs, S.ce);
  }

  /* ---------- озвучка ---------- */

  function speakFrom(idx) {
    if (!('speechSynthesis' in window) || !S.doc) return;
    const ci = chunkAt(idx);
    if (ci < 0) return;
    S.gen++;
    const my = S.gen;
    try { speechSynthesis.cancel(); } catch (e) {}
    S.state = 'playing';
    startLoop();
    setTimeout(() => playChunk(my, ci, idx), 60);
  }

  function playChunk(my, ci, from) {
    if (my !== S.gen) return;
    if (ci >= S.chunks.length) { stopReading(); return; }
    const c = S.chunks[ci];
    const s = Math.max(c.s, from || 0);
    const text = S.doc.text;
    S.ci = ci; S.cs = s; S.ce = c.e; S.t0 = performance.now();
    S.lastIdx = s; S.boundaryAt = 0;
    try { S.sp = scrollParentOf(pos(s).node.parentElement); } catch (e) { S.sp = null; }

    const u = new SpeechSynthesisUtterance(text.slice(s, c.e));
    u.lang = document.documentElement.lang || navigator.language || 'ru-RU';
    u.onboundary = ev => {
      if (my !== S.gen) return;
      if (ev.name && ev.name !== 'word') return;
      S.lastIdx = s + ev.charIndex;
      S.boundaryAt = performance.now();
      paintWord(S.lastIdx, ev.charLength);
    };
    u.onend = () => { if (my === S.gen) playChunk(my, ci + 1); };
    u.onerror = ev => {
      if (my !== S.gen) return;
      if (ev && (ev.error === 'canceled' || ev.error === 'interrupted')) return;
      playChunk(my, ci + 1);
    };
    keep.push(u);
    if (keep.length > 6) keep.shift();
    paintSentence(s, c.e);
    speechSynthesis.speak(u);
  }

  function onRead() {
    const st = startPoint();
    close();
    if (!st) return;
    stopReading();
    S.doc = buildDoc();
    S.chunks = makeChunks(S.doc.text);
    let idx = toGlobal(st.node, st.offset);
    if (idx == null) return;
    // для места без выделения — к началу слова
    if (!currentRange() && !snapshot) {
      const t = S.doc.text;
      while (idx > 0 && /[\p{L}\p{N}_]/u.test(t[idx - 1])) idx--;
    }
    speakFrom(idx);
  }

  function pauseReading() {
    if (S.state !== 'playing') return;
    S.gen++;
    try { speechSynthesis.cancel(); } catch (e) {}
    S.resumeIdx = S.boundaryAt ? S.lastIdx : S.cs;
    S.state = 'paused';
  }

  function resumeReading() {
    if (S.state !== 'paused') return;
    speakFrom(S.resumeIdx);
  }

  function stopReading() {
    S.gen++;
    try { speechSynthesis.cancel(); } catch (e) {}
    S.state = 'idle';
    S.doc = null; S.chunks = []; S.sp = null; S.sy = null;
    if (HL) { HL.sent.clear(); HL.word.clear(); }
  }

  /* ---------- плавная непрерывная прокрутка ---------- */

  function scrollParentOf(el) {
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if (/(auto|scroll|overlay)/.test(o) && e.scrollHeight > e.clientHeight + 4) return e;
    }
    return null;
  }

  function focusIdx() {
    const now = performance.now();
    if (S.boundaryAt && now - S.boundaryAt < 2500) return S.lastIdx;
    const est = S.cs + Math.floor((now - S.t0) / 1000 * CPS);
    return Math.min(S.ce - 1, Math.max(S.cs, est));
  }

  function startLoop() {
    if (!S.raf) { S.lastTs = 0; S.raf = requestAnimationFrame(loop); }
  }

  function loop(ts) {
    if (S.state === 'idle') { S.raf = 0; return; }
    S.raf = requestAnimationFrame(loop);

    const dt = S.lastTs ? Math.min(0.05, Math.max(0.001, (ts - S.lastTs) / 1000)) : 0.016;
    S.lastTs = ts;

    if (S.state !== 'playing' || !cfg.scroll || performance.now() < S.noScrollUntil) { S.sy = null; return; }

    try {
      const i = focusIdx();
      S.tmp = rangeOf(i, i + 1, S.tmp || document.createRange());
      let rc = S.tmp.getClientRects()[0];
      if (!rc || (!rc.width && !rc.height)) rc = S.tmp.getBoundingClientRect();
      if (!rc || (!rc.width && !rc.height)) return;

      const sp = S.sp;
      let top = 0, h = innerHeight;
      if (sp) { const r = sp.getBoundingClientRect(); top = r.top; h = sp.clientHeight; }

      // собственная дробная позиция прокрутки: без округления до целых px — иначе рывки
      const cur = sp ? sp.scrollTop : window.scrollY;
      if (S.sy == null || Math.abs(S.sy - cur) > 3) S.sy = cur;

      const dy = rc.top - (top + h * 0.33);
      const k = 1 - Math.exp(-dt / SCROLL_TAU);          // экспоненциальное сглаживание, не зависит от FPS
      const lim = SCROLL_MAX * dt;
      const step = Math.max(-lim, Math.min(lim, dy * k));
      if (Math.abs(step) < 0.01) return;

      S.sy += step;
      // behavior:'instant' — чтобы CSS scroll-behavior:smooth на сайте не добавлял свою анимацию
      if (sp) sp.scrollTo({ top: S.sy, behavior: 'instant' });
      else window.scrollTo({ top: S.sy, left: window.scrollX, behavior: 'instant' });
    } catch (e) {}
  }

  const hold = () => { S.noScrollUntil = performance.now() + 3500; };
  window.addEventListener('wheel', hold, { passive: true, capture: true });
  window.addEventListener('pointercancel', hold, true);
  window.addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) hold();
  }, true);

  /* ---------- переход по тексту тапом ---------- */

  let down = null;

  function jumpAt(x, y) {
    const c = caretAt(x, y);
    if (!c || !S.doc) return;
    let idx = toGlobal(c.node, c.offset);
    if (idx == null) return;
    const t = S.doc.text;
    while (idx > 0 && /[\p{L}\p{N}_]/u.test(t[idx - 1])) idx--;
    // тап должен попасть по тексту, а не рядом с ним
    try {
      const rc = rangeOf(idx, idx + 1).getBoundingClientRect();
      if (Math.abs(y - (rc.top + rc.bottom) / 2) > rc.height + 14) return;
    } catch (e) { return; }
    S.noScrollUntil = 0;
    speakFrom(idx);
  }

  /* ---------- ссылка ---------- */

  function openLink(href) {
    try {
      if (typeof GM_openInTab === 'function') { GM_openInTab(href, { active: true, insert: true, setParent: true }); return; }
    } catch (e) {}
    window.open(href, '_blank', 'noopener');
  }

  /* ---------- стандартное меню ---------- */

  function onStandard() {
    // Системное меню браузера программно открыть нельзя: следующее долгое нажатие
    // пройдёт без перехвата. Пока ждём, в углу пульсирует значок ⋮.
    bypassUntil = Date.now() + BYPASS_MS;
    if (navigator.vibrate) navigator.vibrate(25);
    close();
    showBadge();
  }

  /* ---------- обновление ---------- */

  function cmpVersions(a, b) {
    const x = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const y = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function checkUpdate() {
    const current = GM_info.script.version;
    GM_xmlhttpRequest({
      method: 'GET',
      url: RAW + '?t=' + Date.now(),
      nocache: true,
      onload(r) {
        const m = /@version\s+(\S+)/.exec(r.responseText || '');
        if (!m) { alert('Не удалось определить версию на GitHub'); return; }
        const latest = m[1];
        if (cmpVersions(latest, current) > 0) {
          if (confirm('Доступна версия ' + latest + ' (установлена ' + current + '). Обновить?')) {
            GM_openInTab(RAW + '?t=' + Date.now(), { active: true });
          }
        } else {
          alert('Установлена последняя версия (' + current + ')');
        }
      },
      onerror() { alert('Не удалось проверить обновление'); },
      ontimeout() { alert('Не удалось проверить обновление'); }
    });
  }

  buildMenu();

  /* ---------- перехват событий ---------- */

  window.addEventListener('contextmenu', e => {
    if (Date.now() < bypassUntil) { bypassUntil = 0; hideBadge(); return; }   // родное меню, один раз
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (t && t.closest && t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')) return;

    linkEl = (t && t.closest) ? t.closest('a[href]') : null;
    if (linkEl && /^javascript:/i.test(linkEl.getAttribute('href') || '')) linkEl = null;

    const items = buildItems();
    if (items.length < 2) return;                    // заменять нечего — оставляем родное меню
    e.preventDefault();
    e.stopPropagation();
    open(e.clientX, e.clientY, items);
  }, true);

  window.addEventListener('pointerdown', e => {
    if (isOpen && !e.composedPath().includes(host)) close();
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  }, true);

  window.addEventListener('pointermove', e => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) hold();
  }, { passive: true, capture: true });

  window.addEventListener('pointerup', e => {
    const d = down; down = null;
    if (!d || !cfg.tap || S.state === 'idle' || isOpen) return;
    if (host && e.composedPath().includes(host)) return;
    if (performance.now() - d.t > 350 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    const t = e.target;
    if (t && t.closest && t.closest('a,button,input,textarea,select,summary,label,[role="button"],[onclick]')) return;
    jumpAt(e.clientX, e.clientY);
  }, true);

  window.addEventListener('scroll', () => close(), { passive: true, capture: true });
  window.addEventListener('pagehide', () => stopReading());
})();
