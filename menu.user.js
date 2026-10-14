// ==UserScript==
// @name         menu
// @namespace    https://github.com/vladyslavbokovnia/openscript
// @version      1.4.2
// @description  Круговое контекстное меню без текста: озвучка (подсветка, плавная прокрутка, переход тапом), управление геймпадом и медиа-кнопками, чтение поля ввода (геймпад / телефон вертикально), открыть ссылку в новой вкладке, стандартное меню
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
  const ICON = 40;            // размер значка внутри кнопки
  const BYPASS_MS = 20000;    // сколько "стандартное меню" ждёт следующего долгого нажатия
  const MAX_CHARS = 400000;   // лимит текста страницы для озвучки
  const MAX_CHUNK = 220;      // максимальная длина одного фрагмента речи
  const CPS = 15;             // символов в секунду (оценка, если нет событий слов)
  const SCROLL_MAX = 2400;    // максимальная скорость прокрутки, px/с
  const RAW = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js';
  const IS_TOP = window.top === window;   // геймпад, наклон и медиа-кнопки работают только в самой странице, не во фреймах

  // Кнопки геймпада (стандартная раскладка Xbox: 0=A 1=B 2=X 3=Y 4=LB 5=RB, 12-15=крестовина).
  // Если у геймпада другая нумерация — в меню Tampermonkey включите «Определить кнопки геймпада»
  // (на экране покажется номер нажатой кнопки) и поправьте номера здесь.
  const PAD = {
    play: 0,        // A — пауза / продолжить / читать с экрана
    stop: 1,        // B — стоп
    field: 2,       // X — прочитать поле ввода (ещё раз — стоп)
    here: 3,        // Y — читать с места, которое сейчас на экране
    parPrev: 4,     // LB — предыдущий абзац
    parNext: 5,     // RB — следующий абзац
    rateUp: 12,     // ↑ — быстрее
    rateDown: 13,   // ↓ — медленнее
    prev: 14,       // ← — предыдущее предложение
    next: 15        // → — следующее предложение
  };
  const PAD_REPEAT = { 12: 220, 13: 220, 14: 400, 15: 400 };   // автоповтор при удержании, мс
  const PAD_REPEAT_DELAY = 450;                                  // через сколько мс удержания начинается автоповтор

  // Чтение поля ввода, когда телефон держат строго вертикально (экраном к себе, верхом вверх)
  const TILT = {
    center: 90,     // угол beta при вертикальном положении
    tol: 11,        // допуск, градусов (80…100)
    arm: 30,        // чтобы жест сработал, телефон сначала должен отклониться от вертикали хотя бы на столько
    hold: 800,      // сколько мс держать неподвижно
    cooldown: 3000, // пауза между срабатываниями
    typing: 1500    // не срабатывать, пока вы печатаете (мс после последнего ввода)
  };

  // Вибро при старте чтения поля ввода, мс (было 30). Веб-API не умеет менять силу мотора, только длительность;
  // можно и ритм: [вибро, пауза, вибро, ...].
  const FIELD_BUZZ = 75;

  const RATES = [0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
  const fmt = r => (Math.round(r * 100) / 100) + '×';

  /* ---------- настройки (выключатели) ---------- */

  const DEF = { read: true, hlSentence: true, hlWord: true, scroll: true, tap: true, link: true, pad: true, media: true, tilt: true };
  const LABELS = {
    read: 'Озвучка',
    hlSentence: 'Подсветка предложения',
    hlWord: 'Подсветка слова',
    scroll: 'Плавная прокрутка',
    tap: 'Переход по тексту тапом',
    link: 'Открыть ссылку в новой вкладке',
    pad: 'Геймпад',
    media: 'Медиа-команды (наушники, шторка)',
    tilt: 'Читать поле: телефон вертикально'
  };
  const cfg = {};
  for (const k of Object.keys(DEF)) {
    let v = DEF[k];
    try { v = GM_getValue(k, DEF[k]); } catch (e) {}
    cfg[k] = !!v;
    try { GM_addValueChangeListener(k, (n, o, nv, remote) => { cfg[k] = !!nv; if (remote) onCfgChange(k); }); } catch (e) {}
  }

  // Плавность прокрутки: чем больше значение, тем мягче текст догоняет озвучку
  const SMOOTH = [
    { v: 0.35, n: 'быстрая' },
    { v: 0.9, n: 'обычная' },
    { v: 1.6, n: 'мягкая' },
    { v: 2.5, n: 'очень мягкая' }
  ];
  let smoothIdx = 1;
  try { smoothIdx = Math.max(0, Math.min(SMOOTH.length - 1, GM_getValue('smoothIdx', 1) | 0)); } catch (e) {}
  try { GM_addValueChangeListener('smoothIdx', (n, o, nv) => { smoothIdx = Math.max(0, Math.min(SMOOTH.length - 1, nv | 0)); }); } catch (e) {}

  // Скорость речи (меняется кнопками геймпада ↑↓ или из меню)
  let rate = 1;
  try { rate = Math.max(0.5, Math.min(3, Number(GM_getValue('rate', 1)) || 1)); } catch (e) {}
  try { GM_addValueChangeListener('rate', (n, o, nv) => { rate = Math.max(0.5, Math.min(3, Number(nv) || 1)); }); } catch (e) {}
  let padDebug = false;   // режим «показывать номер нажатой кнопки»

  let menuIds = [];
  function buildMenu() {
    if (window.top !== window || typeof GM_registerMenuCommand !== 'function') return;
    menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
    menuIds = [];
    for (const k of Object.keys(LABELS)) {
      menuIds.push(GM_registerMenuCommand((cfg[k] ? '✅ ' : '⬜ ') + LABELS[k], () => {
        cfg[k] = !cfg[k];
        try { GM_setValue(k, cfg[k]); } catch (e) {}
        onCfgChange(k);
        buildMenu();
      }, { autoClose: false }));
    }
    menuIds.push(GM_registerMenuCommand('〰️ Плавность прокрутки: ' + SMOOTH[smoothIdx].n, () => {
      smoothIdx = (smoothIdx + 1) % SMOOTH.length;
      try { GM_setValue('smoothIdx', smoothIdx); } catch (e) {}
      buildMenu();
    }, { autoClose: false }));
    menuIds.push(GM_registerMenuCommand('⏩ Скорость озвучки: ' + fmt(rate), () => {
      setRate(RATES.find(v => v > rate + 0.001) || RATES[0], true);
      buildMenu();
    }, { autoClose: false }));
    menuIds.push(GM_registerMenuCommand(padDebug ? '🎮 Номера кнопок на экране: вкл' : '🎮 Определить кнопки геймпада', () => {
      padDebug = !padDebug;
      buildMenu();
    }, { autoClose: false }));
    menuIds.push(GM_registerMenuCommand('🔄 Обновить', checkUpdate));
  }

  /* ---------- состояние ---------- */

  let host = null, root = null, wrap = null, badge = null, badgeTimer = 0;
  let isOpen = false, openedAt = 0;
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
    raf: 0, lastTs: 0, noScrollUntil: 0, ownScrollAt: 0, sy: null, sp: null,
    tmp: null,
    lang: null            // язык речи для поля ввода (null — по языку страницы)
  };

  // viewBox обрезан до самого рисунка, поэтому значки крупные и без лишних полей
  const ICONS = {
    read: '<svg viewBox="2 2 20 20"><path d="M3 10v4h4l5 4V6L7 10H3z"/><path d="M15.5 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    pause: '<svg viewBox="2 2 20 20"><rect x="5.5" y="4" width="5" height="16" rx="1.4"/><rect x="13.5" y="4" width="5" height="16" rx="1.4"/></svg>',
    stop: '<svg viewBox="2 2 20 20"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    menu: '<svg viewBox="2 2 20 20"><circle cx="12" cy="5" r="2.6"/><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="19" r="2.6"/></svg>',
    newtab: '<svg viewBox="2 2 20 20"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/></g></svg>'
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
        .btn svg{width:${ICON}px;height:${ICON}px;fill:currentColor;pointer-events:none}
        .btn:active{filter:brightness(1.25)}
        .open .disc{transform:translate(-50%,-50%) scale(1);opacity:1}
        .open .dot{opacity:1}
        .open .btn{opacity:1;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1)}
        .badge{position:fixed;right:16px;bottom:16px;width:46px;height:46px;border-radius:50%;background:#48484a;color:#fff;
          display:none;align-items:center;justify-content:center;pointer-events:none;
          box-shadow:0 0 0 0 rgba(255,255,255,.6);animation:pulse 1.4s infinite}
        .badge.on{display:flex}
        .badge svg{width:30px;height:30px;fill:currentColor}
        .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80vw;padding:8px 16px;border-radius:18px;
          background:rgba(30,30,32,.9);color:#fff;font:600 15px/1.25 system-ui,sans-serif;text-align:center;
          opacity:0;pointer-events:none;transition:opacity .15s}
        .toast.on{opacity:1}
        @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.55)}70%{box-shadow:0 0 0 14px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
      </style>
      <div class="wrap"><div class="disc"></div><div class="dot"></div></div>
      <div class="badge">${ICONS.menu}</div>
      <div class="toast"></div>`;
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

    wrap.classList.remove('open');
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
    openedAt = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (isOpen) wrap.classList.add('open'); }));
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
    if (!HL || (S.doc && S.doc.field)) return;
    HL.sent.clear(); HL.word.clear();
    if (!cfg.hlSentence) return;
    try { HL.sent.add(rangeOf(a, b)); } catch (e) {}
  }
  function paintWord(i, len) {
    if (!HL || (S.doc && S.doc.field)) return;
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
    mediaSync();
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
    mediaPosition();
    try { S.sp = scrollParentOf(pos(s).node.parentElement); } catch (e) { S.sp = null; }

    const u = new SpeechSynthesisUtterance(text.slice(s, c.e));
    u.lang = S.lang || document.documentElement.lang || navigator.language || 'ru-RU';
    u.rate = rate;
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
      if (ev && ev.error === 'not-allowed') {      // браузер требует касания страницы — не перебираем все фрагменты
        stopReading();
        toast('Браузер не разрешил озвучку: коснитесь экрана');
        return;
      }
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
    mediaSync();
  }

  function resumeReading() {
    if (S.state !== 'paused') return;
    speakFrom(S.resumeIdx);
  }

  function stopReading() {
    S.gen++;
    try { speechSynthesis.cancel(); } catch (e) {}
    S.state = 'idle';
    S.doc = null; S.chunks = []; S.sp = null; S.sy = null; S.lang = null;
    if (HL) { HL.sent.clear(); HL.word.clear(); }
    mediaTeardown();
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
    const est = S.cs + Math.floor((now - S.t0) / 1000 * CPS * rate);
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

    // пока открыто круговое меню, страницу не двигаем: иначе меню "уезжает" и закрывается
    if (isOpen || S.state !== 'playing' || !cfg.scroll || performance.now() < S.noScrollUntil || (S.doc && S.doc.field)) { S.sy = null; return; }

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
      const k = 1 - Math.exp(-dt / SMOOTH[smoothIdx].v);   // экспоненциальное сглаживание, не зависит от FPS
      const lim = SCROLL_MAX * dt;
      const step = Math.max(-lim, Math.min(lim, dy * k));
      if (Math.abs(step) < 0.01) return;

      S.sy += step;
      S.ownScrollAt = performance.now();
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

  /* ---------- подсказка на экране и вибрация ---------- */

  let toastEl = null, toastTimer = 0;
  function toast(msg, ms) {
    try {
      ensureHost();
      toastEl = toastEl || root.querySelector('.toast');
      toastEl.textContent = msg;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms || 1300);
    } catch (e) {}
  }
  const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

  function onCfgChange(k) {
    if (k === 'read' && !cfg.read) stopReading();
    if (k === 'hlSentence' || k === 'hlWord') repaint();
    if (k === 'pad') { if (cfg.pad) { if (anyPad()) padStart(); } else padStop(); }
    if (k === 'media') { if (cfg.media) mediaSync(); else mediaTeardown(); }
    if (k === 'tilt') { if (cfg.tilt) { if (lastField) tiltStart(); } else tiltStop(); }
  }

  /* ---------- скорость речи ---------- */

  let rateTimer = 0;
  function setRate(r, quiet) {
    r = Math.max(0.5, Math.min(3, Math.round(r * 20) / 20));
    if (r === rate) return;
    rate = r;
    try { GM_setValue('rate', rate); } catch (e) {}
    if (!quiet) toast(fmt(rate));
    if (S.state === 'playing') {
      // новую скорость применяем с текущего слова; при быстром удержании кнопки — один раз в конце
      clearTimeout(rateTimer);
      rateTimer = setTimeout(() => { if (S.state === 'playing') speakFrom(S.boundaryAt ? S.lastIdx : S.cs); }, 350);
    }
  }

  /* ---------- управление чтением: пауза, шаги по предложениям и абзацам ---------- */

  function togglePlay() {
    if (S.state === 'playing') pauseReading(); else mediaPlay();
  }

  function mediaPlay() {
    if (S.state === 'paused') resumeReading();
    else if (S.state === 'idle') startFromViewport();
  }

  // Читать с того места, которое сейчас на экране
  function startFromViewport() {
    if (!cfg.read || !('speechSynthesis' in window)) return;
    stopReading();
    S.doc = buildDoc();
    S.chunks = makeChunks(S.doc.text);
    if (!S.chunks.length) { S.doc = null; toast('На странице нет текста'); return; }
    speakFrom(viewportIdx());
  }

  function viewportIdx() {
    const t = S.doc.text;
    const wordStart = idx => { while (idx > 0 && /[\p{L}\p{N}_]/u.test(t[idx - 1])) idx--; return idx; };
    // 1) пробуем найти текст в нескольких точках экрана сверху вниз
    for (const fy of [0.1, 0.2, 0.3, 0.4, 0.5, 0.62, 0.74, 0.86]) {
      for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
        const c = caretAt(innerWidth * fx, innerHeight * fy);
        if (!c || !c.node || c.node.nodeType !== 3 || !S.doc.map.has(c.node)) continue;
        const idx = toGlobal(c.node, c.offset);
        if (idx != null) return wordStart(idx);
      }
    }
    // 2) запасной путь: первый текстовый узел, который заканчивается ниже верхнего края экрана
    try {
      const sg = S.doc.segs, r = document.createRange();
      let lo = 0, hi = sg.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        r.selectNodeContents(sg[mid].node);
        if (r.getBoundingClientRect().bottom > 0) { ans = mid; hi = mid - 1; } else lo = mid + 1;
      }
      if (ans >= 0) return sg[ans].g;
    } catch (e) {}
    return 0;
  }

  function jumpChunk(ci) {
    if (ci >= S.chunks.length) { stopReading(); return; }
    ci = Math.max(0, ci);
    S.ci = ci; S.t0 = performance.now(); S.noScrollUntil = 0;   // сразу, чтобы быстрые повторные нажатия считались от нового места
    buzz(15);
    speakFrom(S.chunks[ci].s);
  }

  function skipSentence(d) {
    if (S.state === 'idle' || !S.chunks.length) return;
    // «назад» через пару секунд после начала фразы — сначала в её начало, как в плеерах
    const restart = d < 0 && S.state === 'playing' && performance.now() - S.t0 > 2500;
    jumpChunk(restart ? S.ci : S.ci + d);
  }

  function paraStart(i) {
    const c = S.chunks[i];
    if (!c) return false;
    const t = S.doc.text;
    let k = c.s - 1;
    while (k >= 0 && t[k] === ' ') k--;
    return k < 0 || t[k] === '\n';
  }

  function skipPara(d) {
    if (S.state === 'idle' || !S.chunks.length) return;
    let i = S.ci;
    if (d > 0) {
      i++;
      while (i < S.chunks.length && !paraStart(i)) i++;
    } else {
      if (paraStart(i)) i--;
      while (i > 0 && !paraStart(i)) i--;
    }
    jumpChunk(i);
  }

  function seekToTime(sec) {
    if (S.state === 'idle' || !S.doc || !(sec >= 0)) return;
    const idx = Math.min(S.doc.text.length - 1, Math.round(sec * CPS * rate));
    let ci = chunkAt(idx);
    if (ci < 0) ci = S.chunks.length - 1;
    jumpChunk(ci);
  }

  /* ---------- поле ввода ---------- */

  let lastField = null;

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function editableKind(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.tagName === 'TEXTAREA') return 'value';
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (!/^(text|search|url|tel|email)$/.test(t)) return null;                       // пароли и прочее не читаем
      if (/password|cc-|one-time-code/i.test(el.getAttribute('autocomplete') || '')) return null;
      return 'value';
    }
    return el.isContentEditable ? 'rich' : null;
  }

  function fieldTarget() {
    const a = deepActive();
    if (editableKind(a)) return a;
    if (lastField && lastField.isConnected && editableKind(lastField)) return lastField;
    return null;
  }

  function fieldText(el) {
    if (editableKind(el) === 'value') {
      let a = null, b = null;
      try { a = el.selectionStart; b = el.selectionEnd; } catch (e) {}
      const v = el.value || '';
      return (a != null && b != null && b > a) ? v.slice(a, b) : v;      // выделено — читаем выделенное
    }
    const s = getSelection();
    if (s && !s.isCollapsed && el.contains(s.anchorNode)) return s.toString();
    return el.innerText || el.textContent || '';
  }

  // Прочитать поле ввода (в фокусе или то, где вы печатали последним)
  function readField(silent) {
    if (!cfg.read || !('speechSynthesis' in window)) return;
    const el = fieldTarget();
    if (!el) { if (!silent) toast('Нет поля ввода'); return; }
    const raw = fieldText(el).replace(/\r/g, '').replace(/[^\S\n]+/g, ' ').trim();
    if (!raw) { if (!silent) toast('Поле пустое'); return; }
    const chunks = makeChunks(raw);
    if (!chunks.length) { if (!silent) toast('Нечего читать'); return; }
    stopReading();
    S.doc = { text: raw, segs: [], map: new Map(), field: true };
    S.chunks = chunks;
    const cyr = (raw.match(/[Ѐ-ӿ]/g) || []).length;
    const lat = (raw.match(/[A-Za-z]/g) || []).length;
    S.lang = cyr > lat ? (/[іїєґІЇЄҐ]/.test(raw) ? 'uk-UA' : 'ru-RU') : null;
    buzz(FIELD_BUZZ);
    speakFrom(0);
  }

  window.addEventListener('focusin', e => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (editableKind(t)) { lastField = t; if (cfg.tilt) tiltStart(); }
  }, true);

  /* ---------- медиа-команды: кнопки наушников, шторка уведомлений, часы ---------- */

  // Chrome отдаёт media-кнопки только странице, где «играет» звук. Озвучка (speechSynthesis) таким звуком
  // не считается, поэтому на время чтения крутится беззвучная дорожка — она и делает страницу получателем кнопок.

  const MS = IS_TOP && navigator.mediaSession ? navigator.mediaSession : null;
  const MS_ACTIONS = {
    play: () => mediaPlay(),
    pause: () => pauseReading(),
    stop: () => stopReading(),
    previoustrack: () => skipSentence(-1),
    nexttrack: () => skipSentence(1),
    seekbackward: () => skipPara(-1),
    seekforward: () => skipPara(1),
    seekto: d => seekToTime(d && d.seekTime)
  };
  let silent = null, ownPause = false, msOn = false;

  function wavUrl(asData) {
    const hz = 8000, n = hz * 10;                     // 10 с тишины: совсем короткие ролики Chrome за медиа не считает
    const b = new Uint8Array(44 + n);
    const dv = new DataView(b.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, hz, true); dv.setUint32(28, hz, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    str(36, 'data'); dv.setUint32(40, n, true); b.fill(128, 44);       // 8 бит без знака: 128 — тишина
    if (!asData) return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return 'data:audio/wav;base64,' + btoa(s);
  }

  function silentEl() {
    if (silent) return silent;
    silent = new Audio();
    silent.loop = true;
    silent.setAttribute('playsinline', '');
    try { silent.src = wavUrl(false); } catch (e) { try { silent.src = wavUrl(true); } catch (e2) {} }
    let triedData = false;
    silent.addEventListener('error', () => {            // сайт запретил blob: в media-src — пробуем data:
      if (triedData) return;
      triedData = true;
      try { silent.src = wavUrl(true); silent.load(); if (S.state === 'playing') silent.play().catch(() => {}); } catch (e) {}
    });
    silent.addEventListener('pause', () => {
      if (ownPause) { ownPause = false; return; }
      if (S.state === 'playing') pauseReading();       // звук перехватил звонок или другое приложение
    });
    return silent;
  }
  function silentPlay() {
    const a = silentEl();
    if (a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => {}); }
  }
  function silentPause() {
    if (silent && !silent.paused) { ownPause = true; silent.pause(); }
  }

  function otherMediaPlaying() {
    try {
      return Array.from(document.querySelectorAll('video,audio')).some(m => m !== silent && !m.paused && !m.ended && m.readyState > 2);
    } catch (e) { return false; }
  }

  function mediaSync() {
    if (!MS || !cfg.media) return;
    if (S.state === 'idle') { mediaTeardown(); return; }
    if (!msOn) {
      if (otherMediaPlaying()) return;                 // на странице играет видео или музыка — их кнопки не трогаем
      msOn = true;
      for (const a of Object.keys(MS_ACTIONS)) { try { MS.setActionHandler(a, MS_ACTIONS[a]); } catch (e) {} }
    }
    try {
      MS.metadata = new MediaMetadata({
        title: (S.doc && S.doc.field) ? 'Поле ввода' : (document.title || location.hostname),
        artist: location.hostname,
        album: 'Озвучка'
      });
    } catch (e) {}
    if (S.state === 'playing') { silentPlay(); MS.playbackState = 'playing'; }
    else { silentPause(); MS.playbackState = 'paused'; }
    mediaPosition();
  }

  function mediaTeardown() {
    silentPause();
    if (!MS || !msOn) return;
    msOn = false;
    for (const a of Object.keys(MS_ACTIONS)) { try { MS.setActionHandler(a, null); } catch (e) {} }
    try { MS.playbackState = 'none'; MS.metadata = null; } catch (e) {}
  }

  // Полоса перемотки в шторке: длительность оценивается по числу символов и скорости речи, поправка — на каждой фразе
  function mediaPosition() {
    if (!MS || !msOn || !S.doc || !MS.setPositionState) return;
    try {
      const cps = CPS * rate, dur = Math.max(1, S.doc.text.length / cps);
      MS.setPositionState({ duration: dur, playbackRate: 1, position: Math.min(dur, S.cs / cps) });
    } catch (e) {}
  }

  /* ---------- геймпад ---------- */

  const padState = new Map();
  let padTimer = 0;

  function anyPad() {
    try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).some(g => g && g.connected); } catch (e) { return false; }
  }
  function padStart() {
    if (!IS_TOP || !cfg.pad || padTimer) return;
    padTimer = setInterval(padPoll, 40);
  }
  function padStop() {
    clearInterval(padTimer);
    padTimer = 0;
    padState.clear();
  }

  function padPoll() {
    if (document.hidden) return;
    let list = [];
    try { list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch (e) {}
    const now = performance.now();
    let any = false;
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      any = true;
      let st = padState.get(gp.index);
      const fresh = !st;                                // кнопка, которой «разбудили» геймпад, действия не вызывает
      if (fresh) { st = {}; padState.set(gp.index, st); }
      gp.buttons.forEach((b, i) => {
        const on = b.pressed || b.value > 0.6;
        const d = st[i];
        if (on) {
          if (!d) { st[i] = { t: now, last: now }; if (!fresh) padPress(i); }
          else if (PAD_REPEAT[i] && now - d.t > PAD_REPEAT_DELAY && now - d.last > PAD_REPEAT[i]) { d.last = now; padPress(i); }
        } else if (d) delete st[i];
      });
    }
    if (!any) padStop();
  }

  function padPress(i) {
    if (padDebug) { toast('Кнопка ' + i, 900); return; }
    switch (i) {
      case PAD.play: if (cfg.read) togglePlay(); break;
      case PAD.stop: stopReading(); break;
      case PAD.field:
        if (S.state !== 'idle' && S.doc && S.doc.field) stopReading(); else readField();
        break;
      case PAD.here: startFromViewport(); break;
      case PAD.parPrev: skipPara(-1); break;
      case PAD.parNext: skipPara(1); break;
      case PAD.prev: skipSentence(-1); break;
      case PAD.next: skipSentence(1); break;
      case PAD.rateUp: setRate(rate + 0.1); break;
      case PAD.rateDown: setRate(rate - 0.1); break;
    }
  }

  /* ---------- чтение поля ввода: телефон вертикально ---------- */

  // beta ≈ 90° — телефон стоит вертикально верхом вверх. По beta, а не по gamma: в вертикали
  // углы alpha и gamma вырождаются и «прыгают», а beta остаётся устойчивой.
  let tiltOn = false, tiltIn = 0, tiltArmed = false, tiltLast = 0, lastInputAt = 0;

  function onTilt(e) {
    if (!cfg.tilt || e.beta == null) return;
    const ot = screen.orientation && screen.orientation.type;
    if (ot && !/^portrait/.test(ot)) { tiltIn = 0; return; }       // только портрет
    const dev = Math.abs(e.beta - TILT.center);
    if (dev > TILT.arm) { tiltArmed = true; tiltIn = 0; return; }  // отклонились — жест «взведён»
    if (dev > TILT.tol) { tiltIn = 0; return; }
    if (!tiltArmed) return;                                        // уже стоял вертикально — не срабатываем
    const now = performance.now();
    if (!tiltIn) { tiltIn = now; return; }
    if (now - tiltIn < TILT.hold || now - tiltLast < TILT.cooldown || now - lastInputAt < TILT.typing) return;
    tiltArmed = false; tiltIn = 0; tiltLast = now;
    if (!document.hidden) readField(true);
  }
  function tiltStart() {
    if (!IS_TOP || tiltOn || !cfg.tilt) return;
    tiltOn = true; tiltArmed = false; tiltIn = 0;
    window.addEventListener('deviceorientation', onTilt, true);
  }
  function tiltStop() {
    if (!tiltOn) return;
    tiltOn = false;
    window.removeEventListener('deviceorientation', onTilt, true);
  }
  window.addEventListener('input', () => { lastInputAt = performance.now(); }, true);

  /* ---------- запуск геймпада ---------- */

  if (IS_TOP) {
    window.addEventListener('gamepadconnected', () => padStart());
    window.addEventListener('gamepaddisconnected', () => { if (!anyPad()) padStop(); });
    if (cfg.pad && anyPad()) padStart();
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
    if (!d || !cfg.tap || S.state === 'idle' || isOpen || (S.doc && S.doc.field)) return;
    if (host && e.composedPath().includes(host)) return;
    if (performance.now() - d.t > 350 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    const t = e.target;
    if (t && t.closest && t.closest('a,button,input,textarea,select,summary,label,[role="button"],[onclick]')) return;
    jumpAt(e.clientX, e.clientY);
  }, true);

  // закрываем меню только от прокрутки пальцем, а не от нашей автопрокрутки озвучки
  window.addEventListener('scroll', () => {
    const now = performance.now();
    if (now - S.ownScrollAt < 200 || now - openedAt < 500) return;
    close();
  }, { passive: true, capture: true });

  window.addEventListener('pagehide', () => stopReading());
})();
