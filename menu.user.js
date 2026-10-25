// ==UserScript==
// @name         menu
// @namespace    https://github.com/vladyslavbokovnia/openscript
// @version      1.9.1
// @description  Озвучка страницы (тап по тексту, ссылке или кнопке — старт, тап во время озвучки — стоп, перемотка свайпами влево/вправо, подсветка, плавная прокрутка), управление геймпадом и медиа-кнопками, чтение поля ввода (геймпад / телефон вертикально) и круговое меню на долгое нажатие по ссылке или кнопке, открывающей страницу: открыть в новой вкладке (в том числе в выбранном профиле); тёмная тема включается сама на светлых сайтах (в браузере универсального приложения)
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
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js
// ==/UserScript==

(() => {
  'use strict';

  const RADIUS = 62;          // радиус круга до центров кнопок
  const BTN = 52;             // размер кнопки
  const ICON = 40;            // размер значка внутри кнопки
  const MAX_CHARS = 400000;   // лимит текста страницы для озвучки
  const MAX_CHUNK = 220;      // максимальная длина одного фрагмента речи
  const CPS = 15;             // символов в секунду на скорости 1× (начальная оценка: дальше скрипт подстраивает её по факту)
  const SCROLL_MAX = 2400;    // максимальная скорость прокрутки, px/с
  const RAW = 'https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/menu.user.js';
  const IS_TOP = window.top === window;   // геймпад, наклон и медиа-кнопки работают только в самой странице, не во фреймах
  const SITE = location.hostname;         // для запоминания выбора тёмной темы по сайтам

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

  const DEF = { read: true, hlSentence: true, hlWord: true, scroll: true, tap: true, swipe: true, link: true, pad: true, media: true, tilt: true, darkAuto: true };
  const LABELS = {
    read: 'Озвучка',
    hlSentence: 'Подсветка предложения',
    hlWord: 'Подсветка слова',
    scroll: 'Плавная прокрутка',
    tap: 'Тап по тексту, ссылкам и кнопкам: старт / стоп озвучки',
    swipe: 'Перемотка свайпами влево/вправо',
    link: 'Меню на ссылке или кнопке (долгое нажатие)',
    pad: 'Геймпад',
    media: 'Медиа-команды (наушники, шторка)',
    tilt: 'Читать поле: телефон вертикально',
    darkAuto: 'Тёмная тема сама на светлых сайтах'
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

  // Реальная скорость голоса, символов в секунду на 1×: по ней оценивается место чтения, когда движок не присылает
  // события слов (так на Android). Подстраивается по длительности уже прочитанных фраз и запоминается
  let calCps = CPS, calDirty = false;
  try { calCps = Math.max(6, Math.min(40, Number(GM_getValue('cps', CPS)) || CPS)); } catch (e) {}
  function calibrate(v) {
    if (!(v > 0)) return;
    calCps = Math.max(6, Math.min(40, calCps * 0.6 + v * 0.4));
    calDirty = true;
  }
  function saveCps() {
    if (!calDirty) return;
    calDirty = false;
    try { GM_setValue('cps', Math.round(calCps * 10) / 10); } catch (e) {}
  }

  let menuIds = [];
  function buildMenu() {
    if (window.top !== window || typeof GM_registerMenuCommand !== 'function') return;
    menuIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch (e) {} });
    menuIds = [];
    for (const k of Object.keys(LABELS)) {
      if (k === 'darkAuto' && darkState() < 0) continue;     // нет тёмной темы приложения — пункт не нужен
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
    const dark = darkState();
    if (dark >= 0) {
      menuIds.push(GM_registerMenuCommand(dark ? '🌙 Тёмная тема на этом сайте: вкл' : '☀️ Тёмная тема на этом сайте: выкл', () => {
        const on = !darkState();
        try { GM_setValue('dm:' + SITE, on ? 1 : 0); } catch (e) {}   // свой выбор важнее автоматики: на этом сайте она больше не вмешивается
        try { GM_openInTab.darkTheme(on); } catch (e) {}
        buildMenu();
      }, { autoClose: false }));
    }
    menuIds.push(GM_registerMenuCommand('🔄 Обновить', checkUpdate));
  }

  // Тёмная тема сайта: затемнение WebView включает само приложение (GM_openInTab.darkTheme есть только в браузере
  // универсального приложения). -1 — нет такой возможности, 0 — выключена, 1 — включена для этого сайта.
  function darkState() {
    try {
      const f = typeof GM_openInTab === 'function' ? GM_openInTab.darkTheme : null;
      const v = typeof f === 'function' ? f() : -1;
      return typeof v === 'number' ? v : -1;
    } catch (e) { return -1; }
  }

  /* ---------- тёмная тема сама на светлых сайтах ---------- */

  // Яркость цвета из rgb()/rgba() от 0 (чёрный) до 1 (белый); null — прозрачный или незнакомый формат
  function lumOf(c) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(c || '');
    if (!m) return null;
    const a = m[4] == null ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    if (a < 0.5) return null;
    const ch = v => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(+m[1]) + 0.7152 * ch(+m[2]) + 0.0722 * ch(+m[3]);
  }

  // Тёмная ли страница сейчас: смотрим фон в нескольких точках экрана (у многих сайтов фон не на body, а на внутренних блоках).
  // true — тёмная, false — светлая, null — страница ещё пуста и судить рано
  function pageIsDark() {
    try {
      if (!document.body || !document.body.children.length) return null;
      const cs = getComputedStyle(document.documentElement).colorScheme || '';
      const defL = /dark/.test(cs) && !/light/.test(cs) ? 0 : 1;   // фон не задан: белый, если сайт не объявил только тёмную схему
      let dark = 0, light = 0, seen = 0;
      for (const p of [[0.5, 0.3], [0.5, 0.6], [0.2, 0.5], [0.8, 0.5], [0.5, 0.85]]) {
        let el = document.elementFromPoint(innerWidth * p[0], innerHeight * p[1]);
        if (!el) continue;
        seen++;
        let L = null;
        for (; el && L == null; el = el.parentElement) L = lumOf(getComputedStyle(el).backgroundColor);
        if (L == null) L = defL;
        if (L < 0.18) dark++; else light++;
      }
      if (!seen) return null;
      return dark > light;
    } catch (e) { return null; }
  }

  // Включает тёмную тему приложения на светлом сайте. Выключать сама не будет: если вы отключили тему на сайте
  // из меню, этот выбор запоминается и автоматика на сайте больше не вмешивается. Результат: 'wait' — попробовать позже
  function autoDark() {
    if (!IS_TOP || !cfg.darkAuto) return;
    if (!/^https?:$/.test(location.protocol) || !/html/i.test(document.contentType || 'text/html')) return;
    if (darkState() !== 0) return;                                 // нет такой возможности или уже включена
    let manual = null;
    try { manual = GM_getValue('dm:' + SITE, null); } catch (e) {}
    if (manual != null) return;                                    // на этом сайте выбор сделан вручную
    const dark = pageIsDark();
    if (dark === null) return 'wait';
    if (dark) return;                                              // сайт и так тёмный
    try { GM_openInTab.darkTheme(true); toast('🌙 Тёмная тема', 1200); } catch (e) {}
  }

  /* ---------- состояние ---------- */

  let host = null, root = null, wrap = null;
  let isOpen = false, openedAt = 0;
  let cx = 0, cy = 0;
  let linkEl = null;      // ссылка или кнопка, на которой открыто круговое меню
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
    newtab: '<svg viewBox="2 2 20 20"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/></g></svg>',
    profile: '<svg viewBox="2 2 20 20"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.2 3.6-7 8-7s8 2.8 8 7z"/></svg>'
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
        .dot{position:absolute;left:0;top:0;width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.85);
          transform:translate(-50%,-50%);box-shadow:0 0 0 3px rgba(0,0,0,.25);opacity:0;transition:opacity .16s}
        .btn{position:absolute;left:0;top:0;width:${BTN}px;height:${BTN}px;border-radius:50%;border:0;padding:0;
          display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:auto;
          box-shadow:0 4px 14px rgba(0,0,0,.4);opacity:0;touch-action:manipulation;
          -webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;
          transform:translate(-50%,-50%) scale(.2);transition:transform .18s cubic-bezier(.2,1.4,.4,1),opacity .15s}
        .btn svg{width:${ICON}px;height:${ICON}px;fill:currentColor;pointer-events:none}
        .btn:active{filter:brightness(1.25)}
        .pn{font:700 22px/1 system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.7);pointer-events:none}
        .btn img.pi{width:100%;height:100%;border-radius:50%;object-fit:cover;pointer-events:none}
        .open .dot{opacity:1}
        .open .btn{opacity:1;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1)}
        .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80vw;padding:8px 16px;border-radius:18px;
          background:rgba(30,30,32,.9);color:#fff;font:600 15px/1.25 system-ui,sans-serif;text-align:center;
          opacity:0;pointer-events:none;transition:opacity .15s}
        .toast.on{opacity:1}
      </style>
      <div class="wrap"><div class="dot"></div></div>
      <div class="toast"></div>`;
    wrap = root.querySelector('.wrap');
    (document.documentElement || document).appendChild(host);
  }

  // Меню показывается на ссылках и кнопках: вне них остаётся родное меню браузера
  function buildItems() {
    const items = [];
    if (cfg.link && linkEl) {
      items.push({ icon: ICONS.newtab, color: '#2e9e5b', run: () => { close(); openTarget(linkEl); } });
      const pr = getProfiles();
      if (pr.length > 1) items.push({ icon: ICONS.profile, color: '#e08a1e', run: () => showProfiles(pr) });
    }
    return items;
  }

  // Профили браузера. Их отдаёт только браузер универсального приложения (GM_openInTab.profiles);
  // в Tampermonkey и других менеджерах функции нет — тогда кнопки выбора профиля просто не будет.
  function getProfiles() {
    try {
      const f = typeof GM_openInTab === 'function' ? GM_openInTab.profiles : null;
      if (typeof f !== 'function') return [];
      const a = f();
      return Array.isArray(a) ? a.filter(p => p && p.ok !== false) : [];
    } catch (e) { return []; }
  }

  // Значок профиля, как в браузере: своя картинка, иначе эмодзи, иначе номер
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function profileIcon(p) {
    const label = p.g || String(p.i + 1);
    if (p.img && /^data:image\//.test(p.img)) return '<img class="pi" alt="' + esc(label) + '" src="' + p.img + '">';
    return '<span class="pn">' + esc(label) + '</span>';
  }

  // Второй круг: по кнопке на каждый профиль (цвет и значок как на вкладках браузера), белое кольцо — профиль текущей вкладки
  function showProfiles(pr) {
    const items = pr.map(p => ({
      icon: profileIcon(p),
      color: p.c || '#48484a',
      title: p.n,
      ring: !!p.cur,
      run: () => { close(); openTarget(linkEl, p.i); }
    }));
    open(cx, cy, items);
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
    const step = n <= 2 ? 90 : n === 3 ? 70 : n <= 6 ? 60 : 360 / n;
    items.forEach((it, i) => {
      const a = (-90 + (i - (n - 1) / 2) * step) * Math.PI / 180;
      const b = document.createElement('button');
      b.className = 'btn';
      b.style.background = it.color;
      if (it.title) { b.title = it.title; b.setAttribute('aria-label', it.title); }
      if (it.ring) b.style.boxShadow = '0 4px 14px rgba(0,0,0,.4),0 0 0 3px #fff';
      b.style.setProperty('--x', Math.cos(a) * RADIUS + 'px');
      b.style.setProperty('--y', Math.sin(a) * RADIUS + 'px');
      b.innerHTML = it.icon;
      // сайт с жёсткой CSP может не пустить data:-картинку: тогда показываем эмодзи или номер
      b.querySelectorAll('img.pi').forEach(im => im.addEventListener('error', () => {
        const sp = document.createElement('span');
        sp.className = 'pn';
        sp.textContent = im.alt;
        im.replaceWith(sp);
      }));
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); it.run(); });
      wrap.appendChild(b);
    });

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

  /* ---------- позиция в тексте ---------- */

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

  // Сокращения, после которых точка не заканчивает предложение
  const ABBR = new Set(['гг', 'ул', 'пр', 'просп', 'пер', 'пл', 'им', 'др', 'см', 'рис', 'стр', 'табл', 'тыс', 'млн', 'млрд', 'руб', 'коп', 'напр', 'проф', 'акад', 'доц', 'обл',
    'янв', 'февр', 'апр', 'авг', 'сент', 'окт', 'нояб', 'дек',
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'fig', 'st', 'inc', 'ltd', 'mt', 'approx',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec']);

  // true — одиночная точка в позиции i (end — позиция после неё) НЕ конец предложения: инициалы, «т. е.», «г. Москва», «Dr. Smith»
  function notEnd(text, i, end) {
    const w = /(\p{L}+)$/u.exec(text.slice(Math.max(0, i - 12), i));
    if (!w) return false;                                  // перед точкой цифра или знак — конец
    const word = w[1], low = word.toLowerCase();
    let j = end;
    while (j < text.length && text[j] === ' ') j++;
    const nx = text[j];
    if (word.length <= 3 && nx && /\p{Ll}/u.test(nx)) return true;     // короткое слово и дальше маленькая буква: «т. е. это», «etc. and»
    if (word.length === 1 && /\p{Lu}/u.test(word)) return true;        // инициалы «А. С. Пушкин»
    if (ABBR.has(low)) return true;
    if (low === 'г' && !/\d\s*$/.test(text.slice(Math.max(0, i - 6), i - 1))) return true;   // «г. Москва», но не «в 2020 г.»
    return false;
  }

  // Делит текст на фразы для озвучки. cont:true у второй и следующих частей слишком длинного предложения:
  // при перемотке и подсветке они считаются одним предложением с первой частью
  function makeChunks(text) {
    const out = [];
    const push = (s, e) => {
      while (s < e && text[s] === ' ') s++;
      while (e > s && text[e - 1] === ' ') e--;
      if (e <= s || !/[\p{L}\p{N}]/u.test(text.slice(s, e))) return;
      let cont = false;
      while (e - s > MAX_CHUNK) {
        let cut = text.lastIndexOf(' ', s + MAX_CHUNK);
        if (cut <= s + 40) cut = s + MAX_CHUNK;
        out.push({ s, e: cut, cont });
        cont = true;
        s = cut;
        while (s < e && text[s] === ' ') s++;
      }
      out.push({ s, e, cont });
    };
    const re = /[.!?…。]+["'»”)\]]*(?=\s|$)|\n/g;
    let start = 0, m;
    while ((m = re.exec(text))) {
      if (m[0] === '\n') { push(start, m.index); start = m.index + 1; continue; }
      const end = m.index + m[0].length;
      if (m[0] === '.' && notEnd(text, m.index, end)) continue;
      push(start, end);
      start = end;
    }
    push(start, text.length);
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

  // Начало предложения, в которое входит фраза i
  function sentStart(i) {
    while (i > 0 && S.chunks[i] && S.chunks[i].cont) i--;
    return i;
  }

  // Границы всего предложения, в которое входит фраза ci (для подсветки)
  function sentSpan(ci) {
    const c = S.chunks[ci];
    if (!c) return { s: S.cs, e: S.ce };
    let a = ci, b = ci;
    while (a > 0 && S.chunks[a].cont) a--;
    while (b + 1 < S.chunks.length && S.chunks[b + 1].cont) b++;
    return { s: S.chunks[a].s, e: S.chunks[b].e };
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
    const sp = sentSpan(S.ci);
    paintSentence(sp.s, sp.e);
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
    const r0 = rate;
    let started = 0;
    S.ci = ci; S.cs = s; S.ce = c.e; S.t0 = performance.now();
    S.lastIdx = s; S.boundaryAt = 0;
    mediaPosition();
    try { S.sp = scrollParentOf(pos(s).node.parentElement); } catch (e) { S.sp = null; }

    const u = new SpeechSynthesisUtterance(text.slice(s, c.e));
    u.lang = S.lang || document.documentElement.lang || navigator.language || 'ru-RU';
    u.rate = rate;
    // речь реально началась (после задержки движка): от этого момента считаем место чтения
    u.onstart = () => {
      if (my !== S.gen) return;
      started = performance.now();
      S.t0 = started;
    };
    u.onboundary = ev => {
      if (my !== S.gen) return;
      if (ev.name && ev.name !== 'word') return;
      S.lastIdx = s + ev.charIndex;
      S.boundaryAt = performance.now();
      paintWord(S.lastIdx, ev.charLength);
    };
    u.onend = () => {
      if (my !== S.gen) return;
      // движок не присылал события слов: по фактической длительности фразы уточняем скорость голоса
      if (started && !S.boundaryAt) {
        const dt = (performance.now() - started) / 1000, n = c.e - s;
        if (n >= 25 && dt > 1) calibrate(n / dt / r0);
      }
      playChunk(my, ci + 1);
    };
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
    const sp = sentSpan(ci);
    paintSentence(sp.s, sp.e);
    speechSynthesis.speak(u);
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
    saveCps();
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
    const est = S.cs + Math.floor((now - S.t0) / 1000 * calCps * rate);
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
    const wasIdle = S.state === 'idle';
    if (wasIdle) {
      // озвучка ещё не идёт: тап по тексту запускает её с этого места
      const c0 = caretAt(x, y);
      if (!c0 || !c0.node || c0.node.nodeType !== 3 || !c0.node.data.trim()) return;
      S.doc = buildDoc();
      S.chunks = makeChunks(S.doc.text);
      if (!S.chunks.length) { S.doc = null; S.chunks = []; return; }
    }
    const fail = () => { if (wasIdle) { S.doc = null; S.chunks = []; } };
    const c = caretAt(x, y);
    if (!c || !S.doc) return fail();
    let idx = toGlobal(c.node, c.offset);
    if (idx == null) return fail();
    const t = S.doc.text;
    while (idx > 0 && /[\p{L}\p{N}_]/u.test(t[idx - 1])) idx--;
    // тап должен попасть по тексту, а не рядом с ним
    try {
      const rc = rangeOf(idx, idx + 1).getBoundingClientRect();
      if (Math.abs(y - (rc.top + rc.bottom) / 2) > rc.height + 14) return fail();
    } catch (e) { return fail(); }
    S.noScrollUntil = 0;
    speakFrom(idx);
  }

  /* ---------- поля ввода: к ним скрипт не прикасается ---------- */

  const EDITABLE_SEL = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],[role="searchbox"],[role="combobox"]';

  function inEditable(t) {
    try {
      if (t && t.nodeType !== 1) t = t.parentElement;
      if (!t) return false;
      return !!(t.isContentEditable || (t.closest && t.closest(EDITABLE_SEL)));
    } catch (e) { return false; }
  }

  function isTextEntry(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(el.type || 'text');
    return /^(textbox|searchbox|combobox)$/.test(el.getAttribute('role') || '');
  }

  // сейчас что-то печатают (поле в фокусе, открыта клавиатура)
  function typingNow() {
    try { return isTextEntry(deepActive()); } catch (e) { return false; }
  }

  /* ---------- перемотка свайпами влево/вправо ---------- */

  const SWIPE_RIGHT_NEXT = true;   // вправо — следующая фраза, влево — предыдущая (false — наоборот)
  const SWIPE_MIN = 60;            // минимальная длина свайпа, px
  const SWIPE_MAX_MS = 800;        // быстрее этого времени
  const SWIPE_EDGE = 28;           // у краёв экрана свайп отдан системе (жест «назад»)
  let sw = null;

  function hScrollable(el) {
    try {
      if (el && el.nodeType !== 1) el = el.parentElement;
      for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (/(auto|scroll)/.test(o) && e.scrollWidth > e.clientWidth + 4) return true;   // карусель, таблица, код — не мешаем
      }
    } catch (e) {}
    return false;
  }

  window.addEventListener('touchstart', e => {
    sw = null;
    if (!cfg.swipe || !cfg.read || S.state === 'idle' || isOpen || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < SWIPE_EDGE || t.clientX > innerWidth - SWIPE_EDGE) return;
    const el = (e.composedPath && e.composedPath()[0]) || e.target;
    if (inEditable(el) || typingNow() || hScrollable(el)) return;
    sw = { x: t.clientX, y: t.clientY, t: performance.now() };
  }, { passive: true, capture: true });

  window.addEventListener('touchend', e => {
    const s0 = sw; sw = null;
    if (!s0 || S.state === 'idle' || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s0.x, dy = t.clientY - s0.y;
    if (performance.now() - s0.t > SWIPE_MAX_MS || Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 2) return;
    skipSentence((dx > 0) === SWIPE_RIGHT_NEXT ? 1 : -1);
  }, { passive: true, capture: true });

  window.addEventListener('touchcancel', () => { sw = null; }, { passive: true, capture: true });

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
    if (k === 'darkAuto' && cfg.darkAuto) autoDark();
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

  // Шаг по предложениям. Длинное предложение, разбитое на части по 220 символов, для перемотки остаётся одним.
  // «Назад»: из середины предложения (или через 2,5 с после его начала) — в начало текущего, иначе в начало предыдущего
  function skipSentence(d) {
    if (S.state === 'idle' || !S.chunks.length) return;
    if (d > 0) {
      let j = S.ci + 1;
      while (j < S.chunks.length && S.chunks[j].cont) j++;
      jumpChunk(j);
      return;
    }
    const cur = sentStart(S.ci);
    if (cur !== S.ci || (S.state === 'playing' && performance.now() - S.t0 > 2500)) jumpChunk(cur);
    else jumpChunk(sentStart(Math.max(0, S.ci - 1)));
  }

  function paraStart(i) {
    const c = S.chunks[i];
    if (!c) return false;
    const t = S.doc.text;
    let k = c.s - 1;
    while (k >= 0 && t[k] === ' ') k--;
    return k < 0 || t[k] === '\n';
  }

  // «Назад» по абзацам ведёт себя так же: из середины абзаца (или через 2,5 с после его начала) — в начало текущего
  function skipPara(d) {
    if (S.state === 'idle' || !S.chunks.length) return;
    let i = S.ci;
    if (d > 0) {
      i++;
      while (i < S.chunks.length && !paraStart(i)) i++;
    } else {
      let p = i;
      while (p > 0 && !paraStart(p)) p--;
      const restart = p < i || (S.state === 'playing' && performance.now() - S.t0 > 2500);
      if (restart) i = p;
      else {
        i = Math.max(0, p - 1);
        while (i > 0 && !paraStart(i)) i--;
      }
    }
    jumpChunk(i);
  }

  function seekToTime(sec) {
    if (S.state === 'idle' || !S.doc || !(sec >= 0)) return;
    const idx = Math.min(S.doc.text.length - 1, Math.round(sec * calCps * rate));
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
      const cps = calCps * rate, dur = Math.max(1, S.doc.text.length / cps);
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

  /* ---------- открытие в новой вкладке ---------- */

  // profile (0-5) понимает только браузер универсального приложения; в остальных менеджерах опция игнорируется
  function openLink(href, profile) {
    const o = { active: true, insert: true, setParent: true };
    if (profile != null) o.profile = profile;
    try {
      if (typeof GM_openInTab === 'function') { GM_openInTab(href, o); return; }
    } catch (e) {}
    window.open(href, '_blank', 'noopener');
  }

  /* ---------- что нажали: ссылка или кнопка, открывающая страницу ---------- */

  // Нажимаемым считается <a href>, кнопка, [role=button/link], элемент с onclick/data-href; в крайнем случае — любой элемент с курсором-«рукой»
  const CLICKABLE = 'a[href],button,input[type=button],input[type=submit],input[type=image],[role=button],[role=link],[role=menuitem],[onclick],[data-href],[data-url],[data-link]';
  const PROBE_MS = 1500;   // сколько ждём, что кнопка попытается открыть страницу

  function targetFrom(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    const chain = [];
    for (const n of path) {
      if (!n || n.nodeType !== 1) continue;
      if (n === host) return null;
      if (n === document.body || n === document.documentElement) break;
      chain.push(n);
      if (chain.length >= 8) break;
    }
    if (!chain.length || inEditable(chain[0])) return null;
    let el = chain.find(n => { try { return n.matches(CLICKABLE); } catch (x) { return false; } });
    if (!el) el = chain.find(n => { try { return getComputedStyle(n).cursor === 'pointer'; } catch (x) { return false; } });
    return el || null;
  }

  // Адрес, который виден без клика
  function staticUrl(el) {
    try {
      const a = el.closest('a[href]');
      if (a) {
        const h = (a.getAttribute('href') || '').trim();
        if (h && h !== '#' && !/^javascript:/i.test(h)) return a.href;
      }
      for (const k of ['data-href', 'data-url', 'data-link']) {
        const h = el.closest('[' + k + ']');
        const v = h && (h.getAttribute(k) || '').trim();
        if (v && /^(https?:\/\/|\/|\.\/|\.\.\/)/i.test(v)) return new URL(v, location.href).href;
      }
    } catch (e) {}
    return null;
  }

  // Нажимает кнопку и перехватывает переход, не давая странице уйти. Результат: {url}, {post:true} или null
  function probeUrl(el) {
    return new Promise(resolve => {
      const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const undo = [];
      let done = false;
      const finish = r => {
        if (done) return;
        done = true;
        undo.forEach(f => { try { f(); } catch (e) {} });
        resolve(r);
      };
      try {   // location.href=…, location.assign, форма, роутер сайта
        const nav = W.navigation;
        if (nav && nav.addEventListener) {
          const onNav = ev => {
            if (ev.hashChange || ev.downloadRequest != null) return;
            const u = ev.destination && ev.destination.url;
            if (!u || u === location.href) return;
            if (ev.cancelable) ev.preventDefault();
            finish(ev.formData ? { post: true } : { url: u });
          };
          nav.addEventListener('navigate', onNav);
          undo.push(() => nav.removeEventListener('navigate', onNav));
        }
      } catch (e) {}
      try {   // window.open(url) на время клика
        const had = Object.prototype.hasOwnProperty.call(W, 'open'), orig = W.open;
        W.open = function (u) {
          try { if (u) finish({ url: new URL(String(u), location.href).href }); } catch (e) {}
          return null;
        };
        undo.push(() => { if (had) W.open = orig; else delete W.open; });
      } catch (e) {}
      setTimeout(() => finish(null), PROBE_MS);
      try { el.click(); } catch (e) { finish(null); }
    });
  }

  async function openTarget(el, profile) {
    let url = staticUrl(el);
    if (!url) {
      toast('Определяю адрес…', 1600);
      const r = await probeUrl(el);
      if (r && r.post) { toast('Это отправка формы (POST) — в новой вкладке не открыть', 2800); return; }
      url = r && r.url;
    }
    if (!url) { toast('Эта кнопка не открывает страницу', 2200); return; }
    openLink(url, profile);
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
  // на document-start адрес вкладки в приложении мог ещё не обновиться: пункт про тёмную тему перестраиваем после загрузки
  if (IS_TOP) document.addEventListener('DOMContentLoaded', buildMenu);

  // Автоматическая тёмная тема: проверяем после загрузки, когда фон страницы уже нарисован; у страниц,
  // которые рисуются позже (сайты на JS), повторяем проверку несколько раз
  if (IS_TOP) {
    const run = () => {
      let n = 0;
      const tick = () => {
        if (autoDark() === 'wait' && ++n < 4) setTimeout(tick, 1000);
        else buildMenu();
      };
      setTimeout(tick, 700);
    };
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
  }

  /* ---------- перехват событий ---------- */

  const LP_MS = 420;       // долгое нажатие на ссылке или кнопке, мс
  const LP_MOVE = 10;      // сдвиг пальца больше этого — это прокрутка, не долгое нажатие
  let lp = null;           // ожидающее долгое нажатие { x, y, a, timer }
  let clickGuard = false;  // после долгого нажатия съедаем «отпускание», чтобы ссылка не открылась

  function lpCancel() {
    if (lp) { clearTimeout(lp.timer); lp = null; }
  }

  function showLinkMenu(x, y, el) {
    linkEl = el;
    const items = buildItems();
    if (!items.length) return false;
    open(x, y, items);
    buzz(20);
    return true;
  }

  // Своё долгое нажатие по таймеру, а не по событию contextmenu: некоторые сайты (YouTube) гасят
  // touchstart, и тогда браузер contextmenu вообще не присылает
  function lpFire() {
    const s = lp; lp = null;
    if (!s || isOpen || !cfg.link) return;
    if (showLinkMenu(s.x, s.y, s.a)) clickGuard = true;
  }

  window.addEventListener('contextmenu', e => {
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (inEditable(t)) return;                      // поля ввода не трогаем
    if (host && e.composedPath && e.composedPath().includes(host)) { e.preventDefault(); return; }
    // меню уже открыто нашим таймером — родное не нужно
    if (isOpen && performance.now() - openedAt < 1500) { e.preventDefault(); e.stopPropagation(); return; }
    if (!cfg.link) return;
    const a = targetFrom(e);
    if (!a) return;                                 // не ссылка и не кнопка (обычный текст и т.п.): родное меню браузера
    lpCancel();
    if (showLinkMenu(e.clientX, e.clientY, a)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // После долгого нажатия отпускание пальца даёт click/touchend: без этого ссылка откроется сама
  // (а на YouTube ещё и сработает тап-обработчик карточки)
  const swallow = e => {
    if (!clickGuard) return;
    if (host && e.composedPath && e.composedPath().includes(host)) return;   // кнопки самого меню не трогаем
    if (e.type === 'click') clickGuard = false;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  };
  ['click', 'touchend', 'mouseup'].forEach(t => window.addEventListener(t, swallow, { capture: true, passive: false }));

  window.addEventListener('dragstart', e => { if (isOpen) e.preventDefault(); }, true);

  window.addEventListener('pointerdown', e => {
    clickGuard = false;                             // новое касание — прошлое уже закончилось
    lpCancel();
    const inHost = host && e.composedPath().includes(host);
    if (isOpen && !inHost) close();
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (inHost || !cfg.link || !e.isPrimary || e.pointerType === 'mouse') return;
    const a = targetFrom(e);
    if (!a) return;
    lp = { x: e.clientX, y: e.clientY, a, timer: setTimeout(lpFire, LP_MS) };
  }, true);

  window.addEventListener('pointermove', e => {
    if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LP_MOVE) lpCancel();
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) hold();
  }, { passive: true, capture: true });

  window.addEventListener('pointercancel', lpCancel, true);

  window.addEventListener('pointerup', e => {
    lpCancel();
    const d = down; down = null;
    if (!d || !cfg.tap || !cfg.read || isOpen) return;
    if (host && e.composedPath().includes(host)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (performance.now() - d.t > 350 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    const t = (e.composedPath && e.composedPath()[0]) || e.target;
    if (inEditable(t) || typingNow()) return;       // тап по полю или пока открыта клавиатура — озвучку не трогаем
    if (S.state === 'playing') { stopReading(); return; }   // тап во время озвучки — стоп
    if (S.doc && S.doc.field) return;
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
