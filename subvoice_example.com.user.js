// ==UserScript==
// @name         SUBVOICE
// @namespace    subvoice
// @version      1.0
// @description  Субтитры: перевод на русский, озвучка, перемотка наклонами. Открывать страницу: https://example.com/
// @match        https://example.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
// Запуск: открыть в браузере пустую страницу https://example.com/ — скрипт заменит её интерфейсом SUBVOICE.
(function(){
document.title='SUBVOICE';
document.head.innerHTML='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover,user-scalable=no"><style>'+`
:root{color-scheme:dark;--bg:#101116;--p:#1b1c24;--p2:#252731;--t:#f5f5f7;--m:#9b9eae;--a:#b9f36b;--l:#363844}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;background:var(--bg);color:var(--t);font:15px/1.4 system-ui,sans-serif}
.app{position:fixed;inset:0;max-width:760px;margin:auto;padding:max(8px,env(safe-area-inset-top)) 12px max(8px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px}
.top{flex:none;display:flex;align-items:center;gap:10px}
.info{flex:1;min-width:0;font-size:12px;color:var(--m);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ib{flex:none;width:44px;height:44px;border:1px solid var(--l);border-radius:14px;background:var(--p);color:var(--t);font-size:20px;display:grid;place-items:center;cursor:pointer;padding:0}
.pri{background:var(--a);color:#151811;border-color:var(--a)}
.bar{height:2px;flex:none}.bar i{display:block;height:100%;width:0;background:var(--a);transition:width .3s}
.reader{position:relative;flex:1;min-height:0;overflow-y:auto;background:#14151b;border:1px solid var(--l);border-radius:18px;padding:14px;font-size:18px;line-height:1.65;color:#b4b7c4;overscroll-behavior:contain}
.reader span{border-radius:6px}.reader .cur{color:#fff;background:#b9f36b26}
.empty{height:100%;display:grid;place-items:center;font-size:56px;color:var(--a);cursor:pointer}
.ctl{flex:none;display:flex;justify-content:center;gap:12px}.ctl .ib{width:56px;height:56px;font-size:22px;border-radius:18px}.ctl .big{width:80px}
input[type=file]{display:none}
.modal{position:fixed;inset:0;background:#0009;display:none;align-items:flex-end;justify-content:center;padding:12px;z-index:10}.modal.open{display:flex}
.sheet{width:min(100%,520px);max-height:88dvh;overflow:auto;background:var(--p);border:1px solid var(--l);border-radius:22px;padding:16px}
.row{margin:12px 0}.row label{display:block;color:var(--m);font-size:12px;margin-bottom:6px}
select{width:100%;background:var(--p2);color:var(--t);border:1px solid var(--l);border-radius:12px;padding:11px;font:inherit}
input[type=range]{width:100%;accent-color:var(--a)}input[type=checkbox]{accent-color:var(--a);width:20px;height:20px;vertical-align:middle}
.btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.btns .ib{width:auto;height:42px;font-size:14px}
.note{font-size:11px;color:var(--m);line-height:1.45;margin:0}
@media(max-height:650px){.ctl .ib{width:48px;height:48px}.ctl .big{width:68px}.reader{font-size:16px;padding:10px}}
`+'</style>';
document.body.removeAttribute('style');document.body.innerHTML=`
<main class="app">
<div class="top"><button class="ib pri" id="pick" aria-label="Загрузить субтитры">＋</button><span class="info" id="info">.srt · .vtt · .ass · .txt</span><button class="ib" id="settings" aria-label="Настройки">⚙</button></div>
<div class="bar"><i id="bar"></i></div>
<section class="reader" id="reader"></section>
<div class="ctl"><button class="ib" id="prev" aria-label="Назад">⏮</button><button class="ib pri big" id="play" aria-label="Играть / пауза">▶</button><button class="ib" id="next" aria-label="Вперёд">⏭</button></div>
<input id="file" type="file" accept=".srt,.vtt,.ass,.ssa,.txt,.sub">
</main>
<div class="modal" id="modal"><div class="sheet">
<div class="row"><label for="voice">Голос</label><select id="voice"><option value="">Русский по умолчанию</option></select></div>
<div class="row"><label for="rate">Скорость <span id="rl"></span></label><input id="rate" type="range" min=".6" max="1.5" step=".1" value="1"></div>
<div class="row"><label><input type="checkbox" id="ton" checked> Наклоны</label></div>
<div class="row"><label for="tilt">Порог наклона <span id="tl"></span> · сейчас <span id="ang">—</span></label><input id="tilt" type="range" min="8" max="30" step="2" value="16"></div>
<div class="btns row"><button class="ib" id="swap">Оригинал</button><button class="ib" id="rew">В начало</button><button class="ib" id="copy">Копировать</button><button class="ib" id="dl">Скачать</button><button class="ib" id="clear">Очистить</button><button class="ib" id="close">Закрыть</button></div>
<div class="row"><button class="ib" id="chk" style="width:100%;height:42px;font-size:14px">Проверить датчики</button><pre class="note" id="diag" style="white-space:pre-wrap;margin:8px 0 0"></pre></div>
<p class="note">Наклон влево/вправо — предложение назад/вперёд, удержание — продолжает, каждый шаг с вибрацией. Работает при включённом экране.</p>
</div></div>
`;
const $=id=>document.getElementById(id),LS=(k,v)=>{try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}};
let orig='',trans='',cur='',showOrig=false,fname='',sents=[],brk=[],spans=[],idx=0,pos=0,off=0,playing=false,done=false,act=null,wlk=null,sensOn=false,cd=0,tt=null,got=0,base=null,ec=0,mc=0,err='',ps='',accS=null,permOk=false;
function cleanText(raw){let s=raw.replace(/^\uFEFF/,'').replace(/\r/g,'');if(/^\[Script Info\]/mi.test(s)){s=s.split('\n').filter(x=>/^Dialogue\s*:/i.test(x)).map(x=>{let m=x.match(/^Dialogue\s*:\s*[^,]*,(?:[^,]*,){7}(.*)$/i);return m?m[1].replace(/\{[^}]*\}/g,'').replace(/\\N|\\n/g,' '):''}).join('\n')}s=s.replace(/^\s*WEBVTT[^\n]*\n?/i,'');s=s.split('\n').filter(x=>{let t=x.trim();return !/^\d+$/.test(t)&&!/^(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}\s*-->/.test(t)&&!/^[\d:.]+\s*-->/.test(t)&&!/^align:|^position:|^line:|^size:|^vertical:|^<\?xml/i.test(t)}).join('\n');s=s.replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\{\\[^}]*\}/g,'').replace(/\\N|\\n/g,' ').replace(/[ \t]+/g,' ').replace(/\n[ \t]*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();return s.split(/\n\s*\n/).map(p=>p.split('\n').map(x=>x.trim()).filter(Boolean).join(' ')).filter(Boolean).join('\n\n')}
function info(s){$('info').textContent=s}
function counter(){info(sents.length?(idx+1)+' / '+sents.length+(fname?' · '+fname:''):(fname||'.srt · .vtt · .ass · .txt'))}
function parse(t){sents=[];brk=[];(t.replace(/\s+/g,' ').match(/[^.!?…]+(?:[.!?…]+[”"')\]]*)?|.+/g)||[]).forEach(s=>{s=s.trim();while(s.length>260){let k=s.lastIndexOf(', ',260);if(k<80)k=s.lastIndexOf(' ',260);if(k<80)k=260;sents.push(s.slice(0,k+1).trim());brk.push(false);s=s.slice(k+1).trim()}if(s){sents.push(s);brk.push(false)}})}
function flow(t){return t.replace(/\[[^\]]{0,40}\]|\([^)]{0,30}\)|[♪♫♬]+/g,'').replace(/(^|\n)[ \t]*[-–—]\s*/g,'$1').replace(/\s+/g,' ').trim()}
function show(t){cur=t;parse(t);idx=0;pos=off=0;done=false;const r=$('reader');r.textContent='';spans=[];r.scrollTop=0;
if(!sents.length){r.innerHTML='<div class="empty" id="empty">＋</div>';$('empty').onclick=()=>$('file').click();return counter()}
const f=document.createDocumentFragment();sents.forEach((s,i)=>{if(brk[i])f.append(document.createElement('br'),document.createElement('br'));const e=document.createElement('span');e.dataset.i=i;e.textContent=s+' ';spans.push(e);f.append(e)});r.append(f);mark()}
function mark(){spans.forEach(e=>e.classList.remove('cur'));const e=spans[idx],r=$('reader');if(e){e.classList.add('cur');r.scrollTo({top:e.offsetTop-r.clientHeight/2+e.offsetHeight/2,behavior:'smooth'})}counter()}
$('reader').onclick=e=>{const s=e.target.closest('span');if(!s)return;idx=+s.dataset.i;pos=off=0;done=false;mark();if(playing)speak()};
function speak(){if(!sents.length)return;speechSynthesis.cancel();const s=sents[idx],b=off,u=new SpeechSynthesisUtterance(s.slice(b)||s);u.lang='ru-RU';u.rate=+$('rate').value;const v=speechSynthesis.getVoices().find(x=>x.name===$('voice').value);if(v)u.voice=v;pos=b;u.onboundary=e=>{pos=b+e.charIndex};u.onend=()=>{if(act!==u)return;pos=off=0;if(idx<sents.length-1){idx++;mark();speak()}else{done=true;setPlay(false)}};act=u;speechSynthesis.speak(u)}
function setPlay(on){playing=on;$('play').textContent=on?'Ⅱ':'▶';wl(on)}
async function wl(on){try{if(on&&!wlk&&navigator.wakeLock){wlk=await navigator.wakeLock.request('screen');wlk.onrelease=()=>wlk=null}else if(!on&&wlk){wlk.release();wlk=null}}catch(e){}}
function stopSpeech(){act=null;if('speechSynthesis'in window)speechSynthesis.cancel();setPlay(false);pos=off=0}
function toggle(){if(!('speechSynthesis'in window))return info('TTS недоступен');if(playing){act=null;speechSynthesis.cancel();off=pos;setPlay(false);return}if(!sents.length)return;if(done){idx=0;done=false;mark()}setPlay(true);sens(0,1);speak()}
function seek(d){if(!sents.length)return;const n=Math.max(0,Math.min(sents.length-1,idx+d));if(n===idx){navigator.vibrate&&navigator.vibrate([50,40,50]);return}idx=n;pos=off=0;done=false;mark();navigator.vibrate&&navigator.vibrate(40);if(playing)speak()}
$('play').onclick=toggle;$('prev').onclick=()=>seek(-1);$('next').onclick=()=>seek(1);
async function sens(force,gest){if(sensOn&&!force&&(!gest||permOk))return;const R=window.DeviceOrientationEvent&&DeviceOrientationEvent.requestPermission;if(R&&gest){try{const r=await DeviceOrientationEvent.requestPermission();permOk=r==='granted';if(!permOk)err='requestPermission: '+r}catch(e){err='requestPermission: '+e}}else permOk=!R;
if(!sensOn){sensOn=true;addEventListener('deviceorientation',e=>{ec++;if(e.gamma!=null){got=1;tilt(e.gamma)}});addEventListener('devicemotion',e=>{mc++;const a=e.accelerationIncludingGravity;if(got===1||!a||a.x==null)return;got=2;tilt(-Math.asin(Math.max(-1,Math.min(1,a.x/9.81)))*57.3)})}
ps='';['accelerometer','gyroscope'].forEach(n=>{try{navigator.permissions.query({name:n}).then(p=>{ps+=n+': '+p.state+' '}).catch(()=>{})}catch(e){}});
setTimeout(()=>{if(!got&&window.Accelerometer&&!accS){try{accS=new Accelerometer({frequency:30});accS.onreading=()=>{if(got===1||got===2)return;got=3;tilt(-Math.asin(Math.max(-1,Math.min(1,accS.x/9.81)))*57.3)};accS.onerror=e=>{err='Accelerometer: '+e.error.name};accS.start()}catch(e){err='Accelerometer: '+e.name}}},1500);
setTimeout(()=>{if(!got)info('Нет данных датчиков · ⚙ → Проверить датчики')},3500)}
function tilt(g){if(base===null)base=g;const r=g-base;$('ang').textContent=Math.round(r)+'°';if(!$('ton').checked)return;const th=+$('tilt').value;let d=cd;if(cd===0){if(Math.abs(r)<th*.5)base+=r*.03;if(r<-th)d=-1;else if(r>th)d=1}else if(Math.abs(r)<th*.5)d=0;if(d!==cd){cd=d;clearTimeout(tt);if(d)fire(d,1)}}
function fire(d,first){if(cd!==d)return;seek(d);tt=setTimeout(()=>fire(d),first?900:650)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&playing)wl(true)});
function det(t){const s=t.slice(0,3000),n=r=>(s.match(r)||[]).length;if(n(/[\u3040-\u30ff]/g)>5)return'ja';if(n(/[\uac00-\ud7af]/g)>5)return'ko';if(n(/[\u4e00-\u9fff]/g)>5)return'zh-CN';if(n(/[а-яёіїєґ]/gi)>s.length*.3)return n(/[іїєґ]/gi)>3?'uk':'ru';return'auto'}
function chunks(t,max){const c=[];while(t.length){if(t.length<=max){c.push(t);break}const m=[...t.slice(0,max).matchAll(/[.!?…]["”')\]]*\s/g)];let k=m.length?m[m.length-1].index+m[m.length-1][0].length:-1;if(k<max/3)k=t.lastIndexOf(' ',max);if(k<max/3)k=max;c.push(t.slice(0,k));t=t.slice(k).trimStart()}return c}
async function gt(q,sl){const r=await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl='+sl+'&tl=ru&q='+encodeURIComponent(q));if(!r.ok)throw 0;const d=await r.json();return d[0].map(x=>x[0]||'').join('')}
async function mm(q,sl){const r=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(q)+'&langpair='+(sl==='auto'?'en':sl)+'|ru');if(!r.ok)throw 0;const d=await r.json(),t=d.responseData&&d.responseData.translatedText;if(!t||d.responseStatus!=200)throw 0;return t.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'")}
async function translate(src){const lg=det(src);if(lg==='ru')return counter();const bar=$('bar'),cs=chunks(src,1200),out=[];bar.style.width='0';
try{for(let i=0;i<cs.length;i++){let t;try{t=await gt(cs[i],lg)}catch(e){t='';for(const c of chunks(cs[i],430))t+=(t?' ':'')+await mm(c,lg)}out.push(t);const p=Math.round((i+1)/cs.length*100);bar.style.width=p+'%';info('Перевод '+p+'%')}
trans=out.join('\n\n');stopSpeech();showOrig=false;$('swap').textContent='Оригинал';show(trans)}catch(e){info('Ошибка перевода · интернет?')}setTimeout(()=>bar.style.width=0,600)}
$('pick').onclick=()=>$('file').click();
$('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;let t;try{t=cleanText(await f.text())}catch(x){return info('Не удалось открыть файл')}fname=f.name;orig=flow(t);trans='';showOrig=false;stopSpeech();show(orig);e.target.value='';info('Перевод…');await translate(orig)};
const modal=$('modal');$('settings').onclick=()=>modal.classList.add('open');$('close').onclick=()=>modal.classList.remove('open');modal.onclick=e=>{if(e.target===modal)modal.classList.remove('open')};
$('swap').onclick=()=>{if(!trans)return;showOrig=!showOrig;stopSpeech();show(showOrig?orig:trans);$('swap').textContent=showOrig?'Перевод':'Оригинал'};
$('rew').onclick=()=>{stopSpeech();idx=0;mark();modal.classList.remove('open')};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(cur);info('Скопировано')}catch(e){info('Не удалось скопировать')}};
$('dl').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([cur],{type:'text/plain;charset=utf-8'}));a.download=(fname.replace(/\.[^.]+$/,'')||'subtitles')+'-ru.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
$('clear').onclick=()=>{stopSpeech();orig=trans='';fname='';show('');modal.classList.remove('open')};
function lab(){$('rl').textContent=(+$('rate').value).toFixed(1)+'×';$('tl').textContent=$('tilt').value+'°'}
['rate','tilt'].forEach(k=>{const v=LS(k);if(v)$(k).value=v;$(k).oninput=()=>{LS(k,$(k).value);lab()}});
$('ton').checked=LS('ton')!=='0';$('ton').onchange=()=>LS('ton',$('ton').checked?1:0);$('voice').onchange=()=>LS('voice',$('voice').value);
function voices(){const val=$('voice').value||LS('voice')||'';$('voice').innerHTML='<option value="">Русский по умолчанию</option>';speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith('ru')).forEach(v=>{const o=document.createElement('option');o.value=v.name;o.textContent=v.name;$('voice').append(o)});$('voice').value=val}
if('speechSynthesis'in window){voices();speechSynthesis.onvoiceschanged=voices}
setInterval(()=>{$('diag').textContent=['протокол: '+location.protocol+(window.isSecureContext?' (secure)':' (НЕ secure)'),'orientation-событий: '+ec+' · motion: '+mc,'источник: '+['нет','orientation','motion','accelerometer'][got],ps&&'разрешения: '+ps,err&&'ошибка: '+err,!got&&sensOn&&'Нет данных. Chrome: ⋮ → Настройки → Настройки сайтов → Датчики движения → Разрешить'].filter(Boolean).join('\n')},500);$('chk').onclick=()=>{ec=mc=0;err='';sens(true,1)};
lab();show('');sens();
})();
