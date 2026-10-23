// ==UserScript==
// @name         Прятать панели при прокрутке
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  На любых сайтах прячет закреплённые панели (шапки, нижние меню) при прокрутке вниз и возвращает при прокрутке вверх
// @author       Vlad
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/hide-panels.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/hide-panels.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  // ── Настройки ──────────────────────────────────────────────────────────────
  const host = location.hostname;
  const get = (k, d) => { try { const v = GM_getValue(k, d); return v === undefined ? d : v; } catch { return d; } };
  const put = (k, v) => { try { GM_setValue(k, v); } catch {} };
  let enabled = get('enabled', true);       // всё выключено/включено
  let sides = get('sides', false);          // прятать и боковые панели
  let thr = get('thr', 10);                 // сколько пикселей прокрутки в одну сторону нужно для реакции
  let off = get('offSites', []);            // сайты, где скрипт отключён
  if (!Array.isArray(off)) off = [];
  const siteOff = () => off.includes(host);
  const active = () => enabled && !siteOff();

  // ── Стиль ──────────────────────────────────────────────────────────────────
  // Прячем свойством translate (не transform), чтобы не ломать собственные transform сайта.
  const HIDE = 'html.__hp-hide ';
  const st = document.createElement('style');
  st.textContent =
    '.__hp{transition:translate .22s ease,opacity .22s ease!important}' +
    HIDE + '.__hp-t{translate:0 -120%!important;opacity:0!important;pointer-events:none!important}' +
    HIDE + '.__hp-b{translate:0 120%!important;opacity:0!important;pointer-events:none!important}' +
    HIDE + '.__hp-l{translate:-120% 0!important;opacity:0!important;pointer-events:none!important}' +
    HIDE + '.__hp-r{translate:120% 0!important;opacity:0!important;pointer-events:none!important}';
  (document.head || document.documentElement).appendChild(st);

  // ── Поиск панелей ──────────────────────────────────────────────────────────
  const panels = new Map();                 // элемент -> класс стороны (__hp-t/b/l/r)
  let seen = new WeakSet();
  const SKIP_TAGS = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TH', 'TD', 'TR', 'THEAD', 'TBODY']);

  function sideOf(el) {
    const cs = getComputedStyle(el);
    const pos = cs.position;
    if (pos !== 'fixed' && pos !== 'sticky') return null;
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    if (el.closest('[role="dialog"],[aria-modal="true"],dialog')) return null;     // модальные окна не трогаем
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.width <= 0 || r.height <= 0) return null;
    if (r.width * r.height > vw * vh * 0.5) return null;                           // оверлеи на пол-экрана
    const wide = r.width >= vw * 0.5;
    if (pos === 'sticky') {
      if (!wide || r.height > vh * 0.25) return null;
      const top = parseFloat(cs.top), bottom = parseFloat(cs.bottom);
      if (!isNaN(top) && top <= vh * 0.15) return '__hp-t';
      if (!isNaN(bottom) && bottom <= vh * 0.15) return '__hp-b';
      return null;
    }
    if (wide && r.height <= vh * 0.35) {
      if (r.top <= 8) return '__hp-t';
      if (r.bottom >= vh - 8) return '__hp-b';
    }
    if (sides && r.height >= vh * 0.5 && r.width <= vw * 0.4) {
      if (r.left <= 8) return '__hp-l';
      if (r.right >= vw - 8) return '__hp-r';
    }
    return null;
  }

  function classify(el) {
    if (!(el instanceof Element) || seen.has(el)) return;
    seen.add(el);
    if (SKIP_TAGS.has(el.tagName) || el.classList.contains('__hp')) return;
    for (let p = el.parentElement; p; p = p.parentElement) if (p.classList.contains('__hp')) return;   // родитель уже панель
    let side = null;
    try { side = sideOf(el); } catch {}
    if (side) { panels.set(el, side); el.classList.add('__hp', side); }
  }

  function scanAll() {
    if (!document.body) return;
    const all = document.body.getElementsByTagName('*');
    let i = 0;
    (function chunk() {
      const end = Math.min(i + 400, all.length);
      for (; i < end; i++) classify(all[i]);
      if (i < all.length) setTimeout(chunk, 0);
    })();
  }
  function rescan() { seen = new WeakSet(); scanAll(); }

  // Новые узлы (ленивая подгрузка, SPA)
  let added = new Set(), addT = null;
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) added.add(n);
    if (addT) return;
    addT = setTimeout(() => {
      addT = null;
      const nodes = [...added]; added = new Set();
      for (const n of nodes) {
        if (!n.isConnected) continue;
        classify(n);
        const kids = n.getElementsByTagName('*');
        if (kids.length <= 1500) for (let i = 0; i < kids.length; i++) classify(kids[i]);
      }
    }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // ── Показ / скрытие ────────────────────────────────────────────────────────
  const root = document.documentElement;
  let hidden = false;
  function typing() {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  }
  function show() {
    if (!hidden) return;
    hidden = false; root.classList.remove('__hp-hide');
  }
  function hide() {
    if (hidden || !active() || typing()) return;
    // фреймворки при перерисовке стирают чужие классы — возвращаем их
    for (const [el, side] of panels) {
      if (!el.isConnected) { panels.delete(el); continue; }
      if (!el.classList.contains('__hp')) el.classList.add('__hp', side);
    }
    if (!panels.size) return;
    hidden = true; root.classList.add('__hp-hide');
  }

  // ── Прокрутка: окно или любой крупный прокручиваемый блок ──────────────────
  const lastY = new WeakMap();
  let accum = 0;
  function onScroll(e) {
    if (!active()) { show(); return; }
    const t = e.target;
    let y;
    if (t === document || t === document.documentElement || t === document.body) {
      y = window.scrollY;
    } else if (t instanceof Element) {
      if (t.clientHeight < window.innerHeight * 0.5 || t.scrollHeight <= t.clientHeight) return;
      y = t.scrollTop;
    } else return;
    const prev = lastY.get(t);
    lastY.set(t, y);
    if (prev === undefined || y < 0) return;
    const d = y - prev;
    if (!d) return;
    if (y <= 20) { accum = 0; show(); return; }
    accum = (accum > 0) === (d > 0) ? accum + d : d;
    if (accum > thr) hide();
    else if (accum < -thr) show();
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('focusin', () => { if (typing()) show(); }, true);

  // SPA: смена адреса — показать панели и пересканировать
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href; accum = 0; show();
      setTimeout(rescan, 800);
    }
  }, 700);

  // ── Меню ──────────────────────────────────────────────────────────────────
  function menu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand(`🫥 Прятать панели при прокрутке: ${enabled ? 'ВКЛ ✓' : 'ВЫКЛ'}`, () => {
      enabled = !enabled; put('enabled', enabled); if (!enabled) show();
      alert(`Прятать панели: ${enabled ? 'включено' : 'выключено'}`);
    });
    GM_registerMenuCommand(`🌐 Этот сайт (${host}): ${siteOff() ? 'ВЫКЛ' : 'ВКЛ ✓'}`, () => {
      off = siteOff() ? off.filter(h => h !== host) : [...off, host]; put('offSites', off);
      if (siteOff()) show();
      alert(`${host}: ${siteOff() ? 'панели не прячутся' : 'панели прячутся'}`);
    });
    GM_registerMenuCommand(`↔️ Боковые панели: ${sides ? 'ВКЛ ✓' : 'ВЫКЛ'}`, () => {
      sides = !sides; put('sides', sides); show(); rescan();
      alert(`Боковые панели: ${sides ? 'прячутся' : 'не прячутся'} (перезагрузите страницу, чтобы сбросить найденное)`);
    });
    GM_registerMenuCommand(`📐 Чувствительность: ${thr} px`, () => {
      const v = parseFloat(prompt('Сколько пикселей прокрутки до реакции (3–80):', thr));
      if (isNaN(v) || v < 3 || v > 80) return;
      thr = v; put('thr', thr); alert(`✓ ${thr} px`);
    });
    GM_registerMenuCommand('🔎 Показать найденные панели', () => {
      alert(panels.size ? [...panels].map(([el, s]) => s.slice(5) + ': ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')).join('\n') : 'Панелей не найдено');
    });
  }

  menu();
  scanAll();
  [1500, 4000, 9000].forEach(t => setTimeout(rescan, t));
})();
