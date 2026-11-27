/* Initial page readiness only. No fake percentage, artificial hold or repeat on refresh. */
(() => {
 'use strict';
 if(window.KEKIPLoading)return;
 const captions={home:'Oyun dünyan hazırlanıyor',welcome:'Hesabın kontrol ediliyor',shop:'Mağaza hazırlanıyor',profile:'Oyuncu profili hazırlanıyor'};
 const page=document.body?.dataset.kpLayout;
 if(!Object.hasOwn(captions,page))return;
 let done=false,settled=false,domReady=document.readyState!=='loading',overlay=null,showTimer=null,escapeTimer=null;
 const remove=()=>{
  if(done)return;
  done=true;
  clearTimeout(showTimer);clearTimeout(escapeTimer);
  document.removeEventListener('DOMContentLoaded',onReady);
  document.removeEventListener('pointerdown',remove,true);
  document.removeEventListener('keydown',remove,true);
  window.removeEventListener('pagehide',remove);
  overlay?.remove();overlay=null;
 };
 function check(){if(domReady&&settled)remove();}
 function onReady(){domReady=true;check();}
 function finish(){settled=true;check();}
 function track(promise){Promise.resolve(promise).then(finish,finish);return promise;}
 window.KEKIPLoading=Object.freeze({track,finish,dismiss:remove});
 function show(){
  if(done||!document.body)return;
  const el=document.createElement('div');el.id='kpStartupLoader';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.setAttribute('aria-atomic','true');
  const core=document.createElement('div');core.className='kp-load-core';
  const orbit=document.createElement('div');orbit.className='kp-load-orbit';orbit.setAttribute('aria-hidden','true');
  const mark=document.createElement('span');mark.className='kp-load-mark';mark.textContent='K';orbit.append(mark);
  const word=document.createElement('div');word.className='kp-load-word';word.setAttribute('aria-hidden','true');word.append('KEKIP');const dot=document.createElement('em');dot.textContent='.';word.append(dot,' GAMES');
  const trackEl=document.createElement('div');trackEl.className='kp-load-track';trackEl.setAttribute('aria-hidden','true');
  const caption=document.createElement('div');caption.className='kp-load-caption';caption.textContent=captions[page]+'…';
  core.append(orbit,word,trackEl,caption);el.append(core);document.body.append(el);
  if(getComputedStyle(el).position!=='fixed'){el.remove();remove();return;}
  overlay=el;
 }
 if(!domReady)document.addEventListener('DOMContentLoaded',onReady,{once:true});
 document.addEventListener('pointerdown',remove,{capture:true,once:true});
 document.addEventListener('keydown',remove,{capture:true,once:true});
 window.addEventListener('pagehide',remove,{once:true});
 // A fast first request never flashes a full screen indicator. An absent/broken
 // bootstrap cannot trap the user; existing page error/retry controls stay in charge.
 showTimer=setTimeout(show,150);
 escapeTimer=setTimeout(remove,8000);
})();