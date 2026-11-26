/* KEKIP 0.51.9.5 — account preferences; guest-only device storage. */
(()=>{'use strict';
const root=document.documentElement,experienceKeys=['sound','ambient','effects'],notificationKeys=['social','messages','achievements'],keys=[...experienceKeys,...notificationKeys],defaults=Object.fromEntries(keys.map(k=>[k,true]));
const deviceKeys=['kekip.experience.v1','kekip.notification-popups.v1'],signal='kekip.preferences.changed.v1',sessionSignal='kekip.preferences.session.v1';
let state={...defaults},mode='loading',username=null,busy=false,reading=false,queued=false,message='Tercihler yükleniyor…',error=false,epoch=0,lastReadAt=null;
const pick=(obj,subset)=>Object.fromEntries(subset.map(k=>[k,typeof obj?.[k]==='boolean'?obj[k]:true]));
function guest(){let result={...defaults};for(const [i,subset] of [experienceKeys,notificationKeys].entries()){try{Object.assign(result,pick(JSON.parse(localStorage.getItem(deviceKeys[i])),subset))}catch{}}return result;}
function emit(){for(const k of experienceKeys)root.dataset['kp'+k[0].toUpperCase()+k.slice(1)]=state[k]?'on':'off';window.dispatchEvent(new CustomEvent('kekip:experience',{detail:pick(state,experienceKeys)}));window.dispatchEvent(new CustomEvent('kekip:notification-preferences',{detail:pick(state,notificationKeys)}));window.dispatchEvent(new CustomEvent('kekip:preferences-status',{detail:info()}));}
function info(){return {mode,username,busy:busy||mode==='loading',ready:(mode==='member'||mode==='guest')&&!busy&&!reading,message,error};}
function report(text,failed=false){message=text;error=failed;emit();}
async function request(action,body={}){const c=new AbortController(),timer=setTimeout(()=>c.abort(),10000);try{const r=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:c.signal});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error||'Tercihler alınamadı.'),{status:r.status});return d}finally{clearTimeout(timer)}}
function valid(d){return d&&typeof d.username==='string'&&/^[a-z0-9_]{3,24}$/.test(d.username)&&keys.every(k=>typeof d.preferences?.[k]==='boolean');}
function finish(){if(queued){queued=false;void refresh();}}
async function refresh(){if(busy||reading){queued=true;return;}reading=true;lastReadAt=Date.now();const stamp=epoch;emit();try{const d=await request('ui-preferences-read');if(stamp!==epoch)return;if(d.username===null&&d.preferences===null){mode='guest';username=null;state=guest();report('Misafir tercihleri bu tarayıcıda saklanır.');}else if(valid(d)){mode='member';username=d.username;state=pick(d.preferences,keys);report('Hesabına kayıtlı tercihler.');}else throw Error('Tercihler doğrulanamadı.');}catch{if(stamp===epoch){mode='error';username=null;state={...defaults};report('Tercihler yüklenemedi. Yeniden dene.',true);}}finally{reading=false;emit();finish();}}
function announce(key=signal){try{localStorage.setItem(key,String(Date.now())+':'+Math.random())}catch{}}
function invalidate(){++epoch;mode='loading';username=null;state={...defaults};report('Oturum değişti. Tercihler yeniden yükleniyor…');void refresh();}
function set(patch,subset){const clean=Object.fromEntries(subset.filter(k=>typeof patch?.[k]==='boolean').map(k=>[k,patch[k]]));if(!Object.keys(clean).length)return false;
 if(!info().ready||reading){emit();return false;}
 if(mode==='guest'){Object.assign(state,clean);let saved=true;try{localStorage.setItem(deviceKeys[0],JSON.stringify(pick(state,experienceKeys)));localStorage.setItem(deviceKeys[1],JSON.stringify(pick(state,notificationKeys)));}catch{saved=false;}report(saved?'Misafir tercihleri bu tarayıcıya kaydedildi.':'Yalnızca bu sayfada uygulanıyor.',!saved);return saved;}
 const name=username,before={...state},stamp=epoch;busy=true;Object.assign(state,clean);report('Hesaba kaydediliyor…');
 void (async()=>{try{const d=await request('ui-preferences-save',{username:name,preferences:clean});if(stamp!==epoch)return;if(!valid(d)||d.username!==name)throw Object.assign(Error('Hesap değişti.'),{status:409});state=pick(d.preferences,keys);message='Hesabına kaydedildi.';error=false;announce();}catch(e){if(stamp!==epoch)return;state=before;message='Kaydedilemedi. Tercihi yeniden seç.';error=true;if([401,403,409].includes(e.status)){mode='loading';username=null;state={...defaults};queued=true;message='Oturum değişti. Tercihler yeniden yükleniyor…';}}finally{busy=false;emit();finish();}})();return true;
}
const style=document.createElement('style');style.textContent=`
html[data-kp-ambient="off"] .kp-live-backdrop>*{animation:none!important;will-change:auto!important}
html[data-kp-effects="off"] :is(.cell.hit,.shot-feedback.show,.kp-badge-toast,.shell .hero-art img,.launch-mascot,.wheel-rotor,.wheel-halo,.launch-top,.launch-actions-heading,.launch-actions,.kp-coin-panel,.kp-sh-state .kp-social-dot.on,.toast.show strong,.commentary-line.goal-flash,.live-score.goal-flash,.kn-toast,.kn-toast-clock,#kn-panel,.typing-dots i,.podium-card,.champion-crown,.row:nth-child(-n+8)){animation:none!important}
html[data-kp-effects="off"] :is(.launch-reward,.podium-card.place-1)::before,html[data-kp-effects="off"] :is(.kp-vitrine-icon,.symbol,.badge-icon)::after{animation:none!important}
html[data-kp-effects="off"] :is(.kp-vitrine-icon,.symbol,.badge-icon)::after{display:none!important}
html[data-kp-effects="off"] :is(.btn,.item,.kn-toast,.shop-card,.badge-card,.achievement-card){transition:none!important}
`;document.head.append(style);

window.KEKIPExperience=Object.freeze({get:()=>pick(state,experienceKeys),set:p=>set(p,experienceKeys),reset:()=>set(defaults,experienceKeys)});
window.KEKIPNotificationPrefs=Object.freeze({get:()=>pick(state,notificationKeys),allows:k=>mode!=='loading'&&mode!=='error'&&state[k]!==false,set:p=>set(p,notificationKeys),reset:()=>set(defaults,notificationKeys)});
window.KEKIPPreferences=Object.freeze({status:info,refresh,sessionChanged(){announce(sessionSignal);invalidate();}});
window.addEventListener('storage',e=>{if(e.key===sessionSignal||e.key===null){invalidate();}else if(e.key===signal){void refresh();}else if(mode==='guest'&&deviceKeys.includes(e.key)){state=guest();emit();}});
// Coalesce focus and visibility events; explicit refresh and session/storage changes stay immediate.
function autoRefresh(){if(document.hidden||reading||busy||(lastReadAt!==null&&Date.now()-lastReadAt<3000))return;void refresh();}
window.addEventListener('focus',autoRefresh);window.addEventListener('pageshow',e=>{if(e.persisted)autoRefresh()});document.addEventListener('visibilitychange',autoRefresh);setInterval(autoRefresh,60000);
emit();void refresh();
})();
