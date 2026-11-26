/* 0.51.13.4 — presentation only; server stats remain authoritative. */
(()=>{'use strict';
const motion=matchMedia('(prefers-reduced-motion: reduce)'), fmt=n=>n.toLocaleString('tr-TR');
let owner=null,last=null,frame=0,timer=0,overlay=null,meters=[];
const allowed=()=>!document.hidden&&!motion.matches&&window.KEKIPExperience?.get()?.effects===true;
function clearOverlay(){clearTimeout(timer);overlay?.remove();overlay=null;}
function settle(){cancelAnimationFrame(frame);frame=0;for(const m of meters){if(last){m.max=last.nextLevelXp;m.value=last.levelXp;}}}
function reset(){settle();clearOverlay();owner=null;last=null;meters=[];}
function notify(x,delta,levelUp){clearOverlay();const root=document.createElement('section');root.className='kp-xp-celebration'+(levelUp?' kp-xp-levelup':'');root.setAttribute('role','status');const title=document.createElement('strong');title.textContent=levelUp?'SEVİYE ATLADIN!':'XP KAZANDIN!';const value=document.createElement('b');value.textContent=levelUp?'SEVİYE '+fmt(x.level):'+'+fmt(delta)+' XP';const sub=document.createElement('span');sub.textContent=levelUp?'+'+fmt(delta)+' XP · Tebrikler!':'Toplam '+fmt(x.xp)+' XP';const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','XP bildirimini kapat');close.onclick=clearOverlay;root.append(title,value,sub,close);if(levelUp){for(let i=0;i<24;i++){const p=document.createElement('i');p.setAttribute('aria-hidden','true');p.style.setProperty('--x',((i%12)*9-50)+'%');p.style.setProperty('--dx',((i%7)-3)*36+'px');p.style.setProperty('--delay',(i%6)*.08+'s');p.style.setProperty('--hue',String([45,265,190,320][i%4]));root.append(p);}}const dialog=document.getElementById('kpAccountDialog');(dialog?.open?dialog:document.body).append(root);overlay=root;timer=setTimeout(clearOverlay,levelUp?6500:3500);}
function update(x,name,nodes){if(!x||!name||!['xp','level','levelXp','nextLevelXp'].every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||x.nextLevelXp<=0||x.levelXp>x.nextLevelXp){reset();return;}
const prev=owner===name?last:null;settle();if(owner!==name)clearOverlay();owner=name;last={...x};meters=nodes.filter(Boolean);const delta=prev?x.xp-prev.xp:0,up=!!prev&&x.level>prev.level;
if(!prev||delta<=0||x.level<prev.level||!allowed()){settle();return;}
notify(x,delta,up);let start=null;const duration=up?1050:750;
function tick(t){if(!allowed()){settle();return;}if(start===null)start=t;const p=Math.min(1,(t-start)/duration);for(const m of meters){if(up&&p<.4){m.max=prev.nextLevelXp;m.value=prev.levelXp+(prev.nextLevelXp-prev.levelXp)*p/.4;}else{m.max=x.nextLevelXp;const a=up?0:prev.levelXp,q=up?(p-.4)/.6:p;m.value=a+(x.levelXp-a)*(1-Math.pow(1-q,3));}}if(p<1)frame=requestAnimationFrame(tick);else settle();}tick(performance.now());}
function sync(){if(!allowed()){settle();clearOverlay();}const s=window.KEKIPPreferences?.status();if(s?.mode==='guest'||(s?.mode==='member'&&owner&&s.username!==owner))reset();}
window.addEventListener('kekip:experience',sync);window.addEventListener('kekip:preferences-status',sync);document.addEventListener('visibilitychange',sync);motion.addEventListener?.('change',sync);window.KEKIPXpEffects=Object.freeze({update,reset});
})();
