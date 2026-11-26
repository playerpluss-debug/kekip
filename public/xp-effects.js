/* 0.51.13.5 — presentation only; server stats remain authoritative. */
(()=>{'use strict';
const motion=matchMedia('(prefers-reduced-motion: reduce)'), fmt=n=>n.toLocaleString('tr-TR');
let audio=null,tones=new Set();
const soundAllowed=()=>!document.hidden&&window.KEKIPExperience?.get()?.sound===true;
function stopSound(){for(const tone of tones){try{tone.stop();}catch{}}tones.clear();}
function unlock(){if(!soundAllowed())return;try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;audio ||= new C();if(audio.state!=='running')audio.resume().catch(()=>{});}catch{}}
function playSound(up){if(!soundAllowed()||audio?.state!=='running')return;stopSound();try{const notes=up?[523.25,659.25,783.99,1046.5]:[659.25,880];notes.forEach((hz,i)=>{const t=audio.currentTime+i*.105,o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.065,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+.19);o.connect(g);g.connect(audio.destination);tones.add(o);o.onended=()=>{tones.delete(o);o.disconnect();g.disconnect();};o.start(t);o.stop(t+.2);});}catch{stopSound();}}
document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock);
let owner=null,last=null,frame=0,timer=0,overlay=null,meters=[];
const allowed=()=>!document.hidden&&!motion.matches&&window.KEKIPExperience?.get()?.effects===true;
function clearOverlay(){clearTimeout(timer);overlay?.remove();overlay=null;}
function settle(){cancelAnimationFrame(frame);frame=0;for(const m of meters){if(last){m.max=last.nextLevelXp;m.value=last.levelXp;}}}
function reset(){stopSound();settle();clearOverlay();owner=null;last=null;meters=[];}
function notify(x,delta,levelUp){clearOverlay();const root=document.createElement('section');root.className='kp-xp-celebration'+(levelUp?' kp-xp-levelup':'');root.setAttribute('role','status');const title=document.createElement('strong');title.textContent=levelUp?'SEVİYE ATLADIN!':'XP KAZANDIN!';const value=document.createElement('b');value.textContent=levelUp?'SEVİYE '+fmt(x.level):'+'+fmt(delta)+' XP';const sub=document.createElement('span');sub.textContent=levelUp?'+'+fmt(delta)+' XP · Tebrikler!':'Toplam '+fmt(x.xp)+' XP';const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','XP bildirimini kapat');close.onclick=clearOverlay;root.append(title,value,sub,close);if(levelUp){for(let i=0;i<24;i++){const p=document.createElement('i');p.setAttribute('aria-hidden','true');p.style.setProperty('--x',((i%12)*9-50)+'%');p.style.setProperty('--dx',((i%7)-3)*36+'px');p.style.setProperty('--delay',(i%6)*.08+'s');p.style.setProperty('--hue',String([45,265,190,320][i%4]));root.append(p);}}const dialog=document.getElementById('kpAccountDialog');(dialog?.open?dialog:document.body).append(root);overlay=root;timer=setTimeout(clearOverlay,levelUp?6500:3500);}
function update(x,name,nodes){if(!x||!name||!['xp','level','levelXp','nextLevelXp'].every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)||x.nextLevelXp<=0||x.levelXp>x.nextLevelXp){reset();return;}
const prev=owner===name?last:null;settle();if(owner!==name){clearOverlay();stopSound();}owner=name;last={...x};meters=nodes.filter(Boolean);const delta=prev?x.xp-prev.xp:0,up=!!prev&&x.level>prev.level;
if(!prev||delta<=0||x.level<prev.level){settle();return;}
playSound(up);if(!allowed()){settle();return;}
notify(x,delta,up);let start=null;const duration=up?1050:750;
function tick(t){if(!allowed()){settle();return;}if(start===null)start=t;const p=Math.min(1,(t-start)/duration);for(const m of meters){if(up&&p<.4){m.max=prev.nextLevelXp;m.value=prev.levelXp+(prev.nextLevelXp-prev.levelXp)*p/.4;}else{m.max=x.nextLevelXp;const a=up?0:prev.levelXp,q=up?(p-.4)/.6:p;m.value=a+(x.levelXp-a)*(1-Math.pow(1-q,3));}}if(p<1)frame=requestAnimationFrame(tick);else settle();}tick(performance.now());}
function sync(){if(!soundAllowed())stopSound();if(!allowed()){settle();clearOverlay();}const s=window.KEKIPPreferences?.status();if(s?.mode==='guest'||(s?.mode==='member'&&owner&&s.username!==owner))reset();}
window.addEventListener('kekip:experience',sync);window.addEventListener('kekip:preferences-status',sync);document.addEventListener('visibilitychange',sync);motion.addEventListener?.('change',sync);window.KEKIPXpEffects=Object.freeze({update,reset});
})();
