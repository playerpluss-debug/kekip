/* KEKIP 0.51.13.3 — display-only animation of confirmed balances. */
(()=>{'use strict';
const states=new Map(),fmt=n=>n.toLocaleString('tr-TR')+' KC';
const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
const status=()=>window.KEKIPPreferences?.status();
function stop(s){if(s.frame!==null)cancelAnimationFrame(s.frame);s.frame=null;}
function paint(s,n){const t=n===null?'— KC':fmt(n);if(s.node.textContent!==t)s.node.textContent=t;s.shown=n;}
function clear(s){stop(s);s.owner=null;s.target=null;s.pending=null;paint(s,null);}
function enabled(){return !document.hidden&&!motion.matches&&status()?.mode==='member'&&window.KEKIPExperience?.get()?.effects===true;}
function apply(s,amount,owner){const same=s.owner===owner&&Number.isSafeInteger(s.target),previous=s.target;if(same&&previous===amount)return;stop(s);s.owner=owner;s.target=amount;
 if(!same||amount<=previous||!enabled()||!Number.isSafeInteger(s.shown)||s.shown>=amount){paint(s,amount);return;}
 const start=s.shown,delta=amount-start,duration=Math.min(1000,Math.max(420,350+Math.log10(delta+1)*180));let begin=null;
 function tick(t){s.frame=null;if(!enabled()){paint(s,s.target);return;}if(begin===null)begin=t;const p=Math.min(1,(t-begin)/duration);paint(s,p===1?amount:start+Math.floor(delta*(1-Math.pow(1-p,3))));if(p<1)s.frame=requestAnimationFrame(tick);}
 s.frame=requestAnimationFrame(tick);
}
function set(node,amount,owner){if(!node)return;let s=states.get(node);if(!s){s={node,owner:null,target:null,shown:null,frame:null,pending:null};states.set(node,s);}
 if(!Number.isSafeInteger(amount)||amount<0||typeof owner!=='string'||!/^[a-z0-9_]{3,24}$/.test(owner)){clear(s);return;}
 const d=status();if(d?.mode==='guest'||(d?.mode==='member'&&d.username!==owner)){clear(s);return;}
 if(d?.mode==='loading'){clear(s);s.pending={amount,owner};return;}
 s.pending=null;apply(s,amount,owner);
}
function sync(){const d=status();for(const [node,s] of states){if(!node.isConnected){clear(s);states.delete(node);continue;}
  if(d?.mode==='guest'||(d?.mode==='member'&&s.owner&&s.owner!==d.username)){clear(s);}
  else if(d?.mode==='loading'){if(s.owner)clear(s);}
  else if(s.pending){const p=s.pending;s.pending=null;if(d?.mode==='member'&&d.username!==p.owner)clear(s);else apply(s,p.amount,p.owner);}
  if(s.frame!==null&&!enabled()){stop(s);paint(s,s.target);}
 }}
window.addEventListener('kekip:preferences-status',sync);window.addEventListener('kekip:experience',sync);document.addEventListener('visibilitychange',sync);motion.addEventListener?.('change',sync);
window.KEKIPCoinCounter=Object.freeze({set});
})();
