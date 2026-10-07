// ==UserScript==
// @name         Субтитры → SUBVOICE
// @namespace    subvoice
// @version      1.0
// @description  Берёт субтитры текущего видео YouTube / Bilibili и открывает их в SUBVOICE (перевод на русский и озвучка)
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://www.bilibili.com/*
// @match        https://m.bilibili.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      api.bilibili.com
// @connect      hdslb.com
// @updateURL    https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subs-to-subvoice.user.js
// @downloadURL  https://raw.githubusercontent.com/vladyslavbokovnia/openscript/main/subs-to-subvoice.user.js
// @run-at       document-idle
// @sandbox      raw
// ==/UserScript==
(function () {
  const TARGET = 'https://vladyslavbokovnia.github.io/openscript/subvoice/';
  const isYT = /youtube\.com$/.test(location.hostname);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let busy = false, cap = null;

  function toast(msg, ms = 3500) {
    const el = Object.assign(document.createElement('div'), { textContent: msg });
    Object.assign(el.style, { position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.88)', color: '#fff', padding: '9px 16px', borderRadius: '20px', fontSize: '13px', zIndex: '2147483647', pointerEvents: 'none', maxWidth: '90vw', whiteSpace: 'pre-wrap' });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  // YouTube: запасной путь — перехват субтитров, которые сам плеер запрашивает при включении CC
  if (isYT) {
    const ofetch = window.fetch;
    window.fetch = function (...a) {
      const u = String((a[0] && a[0].url) || a[0]);
      const p = ofetch.apply(this, a);
      if (u.includes('/api/timedtext')) p.then(r => r.clone().text().then(t => { if (t) cap = t; }).catch(() => {})).catch(() => {});
      return p;
    };
    const oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (String(u).includes('/api/timedtext')) this.addEventListener('load', () => { try { if (this.responseText) cap = this.responseText; } catch (e) {} });
      return oo.apply(this, arguments);
    };
  }

  const dec = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  function parseTT(s) {
    s = (s || '').trim();
    if (!s) return [];
    if (s[0] === '{') {
      try { return (JSON.parse(s).events || []).filter(e => e.segs).map(e => e.segs.map(x => x.utf8).join('').replace(/\s+/g, ' ').trim()).filter(Boolean); } catch (e) { return []; }
    }
    if (s.startsWith('WEBVTT')) return s.split('\n').filter(l => l.trim() && !/-->|^WEBVTT|^\d+$/.test(l)).map(l => dec(l.replace(/<[^>]+>/g, '').trim()));
    const d = new DOMParser().parseFromString(s, 'text/xml');
    return [...d.querySelectorAll('text,p')].map(n => dec(n.textContent.replace(/\s+/g, ' ').trim())).filter(Boolean);
  }

  async function ytText() {
    let pr = null;
    try { pr = document.getElementById('movie_player').getPlayerResponse(); } catch (e) {}
    if (!pr || !pr.captions) {
      try {
        const html = await (await fetch(location.href, { credentials: 'include' })).text();
        const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
        if (m) pr = JSON.parse(m[1]);
      } catch (e) {}
    }
    const tracks = (pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer && pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    if (!tracks.length) throw new Error('У видео нет субтитров');
    const title = (pr.videoDetails && pr.videoDetails.title) || document.title.replace(/ - YouTube$/, '');
    const pick = tracks.find(t => (t.languageCode || '').startsWith('ru')) || tracks.find(t => t.kind !== 'asr') || tracks[0];
    let lines = [];
    try {
      const u = new URL(pick.baseUrl, location.href); u.searchParams.set('fmt', 'json3');
      lines = parseTT(await (await fetch(u.href, { credentials: 'include' })).text());
    } catch (e) {}
    if (!lines.length) {
      cap = null;
      toast('Включаю субтитры в плеере…');
      try { document.getElementById('movie_player').toggleSubtitlesOn(); } catch (e) {}
      for (let i = 0; i < 20 && !cap; i++) await sleep(400);
      if (cap) lines = parseTT(cap);
    }
    if (!lines.length) throw new Error('YouTube не отдал субтитры. Включите CC в плеере и нажмите снова');
    return { title, text: lines.join('\n\n') };
  }

  const gm = url => new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url, responseType: 'text', timeout: 15000, onload: r => res(r.responseText), onerror: () => rej(new Error('Нет связи с ' + new URL(url).hostname)), ontimeout: () => rej(new Error('Таймаут ' + new URL(url).hostname)) }));

  async function biliText() {
    const m = location.pathname.match(/\/video\/(BV\w+|av\d+)/i);
    if (!m) throw new Error('Откройте страницу видео');
    const q = /^av/i.test(m[1]) ? 'aid=' + m[1].slice(2) : 'bvid=' + m[1];
    const p = +(new URLSearchParams(location.search).get('p') || 1);
    const v = JSON.parse(await gm('https://api.bilibili.com/x/web-interface/view?' + q)).data;
    if (!v) throw new Error('Bilibili: видео не найдено');
    const cid = (v.pages && v.pages[p - 1] && v.pages[p - 1].cid) || v.cid;
    let subs = null;
    for (const ep of ['x/player/wbi/v2', 'x/player/v2']) {
      try {
        const j = JSON.parse(await gm('https://api.bilibili.com/' + ep + '?bvid=' + v.bvid + '&cid=' + cid));
        subs = j.data && j.data.subtitle && j.data.subtitle.subtitles;
        if (subs && subs.length) break;
      } catch (e) {}
    }
    if (!subs || !subs.length) throw new Error('На Bilibili нет субтитров (часть доступна только после входа в аккаунт)');
    const pick = subs.find(s => s.lan === 'ru') || subs.find(s => !/^ai-/.test(s.lan)) || subs[0];
    let u = pick.subtitle_url; if (u.startsWith('//')) u = 'https:' + u;
    const body = JSON.parse(await gm(u)).body || [];
    return { title: v.title + (v.pages && v.pages.length > 1 ? ' · P' + p : ''), text: body.map(x => String(x.content).replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n') };
  }

  async function run() {
    if (busy) return;
    busy = true; toast('Загружаю субтитры…');
    try {
      const r = isYT ? await ytText() : await biliText();
      if (!r.text) throw new Error('Субтитры пустые');
      const url = TARGET + '#n=' + encodeURIComponent(r.title) + '&t=' + encodeURIComponent(r.text);
      if (url.length > 1500000) throw new Error('Субтитры слишком длинные');
      try { GM_openInTab(url, { active: true }); } catch (e) { window.open(url, '_blank'); }
      toast('Открываю SUBVOICE…');
    } catch (e) { toast('⚠️ ' + e.message, 6000); }
    busy = false;
  }

  const btn = Object.assign(document.createElement('button'), { textContent: '📝' });
  Object.assign(btn.style, { position: 'fixed', bottom: '14px', left: '14px', width: '48px', height: '48px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(20,20,20,0.55)', color: '#fff', fontSize: '22px', zIndex: '2147483646', display: 'none', alignItems: 'center', justifyContent: 'center' });
  btn.onclick = run;
  document.body.appendChild(btn);
  setInterval(() => {
    const ok = isYT ? /^\/(watch|shorts)/.test(location.pathname) : /\/video\//.test(location.pathname);
    btn.style.display = ok ? 'flex' : 'none';
  }, 1000);
})();
