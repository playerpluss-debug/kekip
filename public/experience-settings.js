/* KEKIP 0.51.9.2 — device preferences; no account or game-state mutation. */
(()=>{'use strict';
const key='kekip.experience.v1',keys=['sound','ambient','effects'],root=document.documentElement,defaults={sound:true,ambient:true,effects:true};
let state={...defaults};
function parse(raw){let value;try{value=JSON.parse(raw)}catch{};return Object.fromEntries(keys.map(k=>[k,typeof value?.[k]==='boolean'?value[k]:defaults[k]]));}
function read(){try{return parse(localStorage.getItem(key))}catch{return {...state}}}
function apply(){for(const k of keys)root.dataset['kp'+k[0].toUpperCase()+k.slice(1)]=state[k]?'on':'off';}
function emit(){apply();window.dispatchEvent(new CustomEvent('kekip:experience',{detail:{...state}}));}
state=read();apply();
const style=document.createElement('style');style.textContent=`
html[data-kp-ambient="off"] .kp-live-backdrop>*{animation:none!important;will-change:auto!important}
html[data-kp-effects="off"] :is(.cell.hit,.shot-feedback.show,.kp-badge-toast,.shell .hero-art img,.launch-mascot,.wheel-rotor,.wheel-halo,.launch-top,.launch-actions-heading,.launch-actions,.kp-coin-panel,.kp-sh-state .kp-social-dot.on,.toast.show strong,.commentary-line.goal-flash,.live-score.goal-flash,.kn-toast,.kn-toast-clock,#kn-panel,.typing-dots i,.podium-card,.champion-crown,.row:nth-child(-n+8)){animation:none!important}
html[data-kp-effects="off"] :is(.launch-reward,.podium-card.place-1)::before,html[data-kp-effects="off"] :is(.kp-vitrine-icon,.symbol,.badge-icon)::after{animation:none!important}
html[data-kp-effects="off"] :is(.kp-vitrine-icon,.symbol,.badge-icon)::after{display:none!important}
html[data-kp-effects="off"] :is(.btn,.item,.kn-toast,.shop-card,.badge-card,.achievement-card){transition:none!important}
`;document.head.append(style);
window.KEKIPExperience=Object.freeze({get:()=>({...state}),set(patch){for(const k of keys)if(typeof patch?.[k]==='boolean')state[k]=patch[k];let saved=false;try{localStorage.setItem(key,JSON.stringify(state));saved=true}catch{}emit();return saved;},reset(){return this.set(defaults)}});
window.addEventListener('storage',e=>{if(e.key===key||e.key===null){state=read();emit()}});
window.addEventListener('pageshow',e=>{if(e.persisted){state=read();emit()}});
})();
