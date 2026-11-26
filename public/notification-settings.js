/* KEKIP 0.51.9.3 — local popup preferences, independent of notification history. */
(()=>{'use strict';
const key='kekip.notification-popups.v1',defaults=Object.freeze({social:true,messages:true,achievements:true}),keys=Object.keys(defaults);
let state={...defaults};
function read(){try{const raw=JSON.parse(localStorage.getItem(key));return Object.fromEntries(keys.map(k=>[k,typeof raw?.[k]==='boolean'?raw[k]:defaults[k]]))}catch{return {...state}}}
function emit(){window.dispatchEvent(new CustomEvent('kekip:notification-preferences',{detail:{...state}}))}
state=read();
function set(patch){for(const k of keys)if(typeof patch?.[k]==='boolean')state[k]=patch[k];let saved=false;try{localStorage.setItem(key,JSON.stringify(state));saved=true}catch{}emit();return saved}
window.KEKIPNotificationPrefs=Object.freeze({get:()=>({...state}),allows:k=>state[k]!==false,set,reset:()=>set(defaults)});
window.addEventListener('storage',e=>{if(e.key===key||e.key===null){state=read();emit()}});
window.addEventListener('pageshow',e=>{if(e.persisted){state=read();emit()}});
})();
