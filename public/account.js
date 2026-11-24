'use strict';
(()=>{
const el=id=>document.getElementById(id);let user=null,busy=false,statsRequest=0;
const dialog=el('kpAccountDialog');
const msg=t=>el('kpMessage').textContent=t;
async function api(action,data={}){const r=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let j;try{j=await r.json()}catch{throw Error('Hesap servisine ulaşılamadı.')}if(!r.ok)throw Error(j.error||'İşlem başarısız.');return j}
function render(){window.kpAccount=user;el('kpHeaderXp').hidden=!user;el('kpAccountOpen').textContent=user?'👤 @'+user.username:'👤 Giriş yap';el('kpGuest').hidden=!!user;el('kpMember').hidden=!user;el('kpMemberName').textContent=user?'@'+user.username:'';if(!joined){el('playerName').readOnly=!!user;if(user)el('playerName').value=user.username}for(const id of ['kpLogin','kpRegister','kpLogout','kpRefresh'])el(id).disabled=busy;}
function block(title,lines){const box=document.createElement('div');box.className='kp-stats-block';const b=document.createElement('b');b.textContent=title;box.append(b);for(const text of lines){const span=document.createElement('span');span.textContent=text;box.append(span)}return box}
function progressBlock(x){const fmt=n=>Number(n).toLocaleString('tr-TR');const box=block('⚡ KEKIP • Seviye '+fmt(x.level),[fmt(x.xp)+' toplam XP']);const meter=document.createElement('progress');meter.max=x.nextLevelXp;meter.value=x.levelXp;meter.setAttribute('aria-label','Sonraki seviyeye ilerleme');meter.style.cssText='display:block;width:100%;height:12px;margin:8px 0;accent-color:#b28bf8;';box.append(meter);const label=document.createElement('span');label.textContent=`${fmt(x.levelXp)} / ${fmt(x.nextLevelXp)} XP · Sonraki seviyeye ${fmt(x.remainingXp)} XP`;box.append(label);return box}
function headerProgress(x){const fmt=n=>Number(n).toLocaleString('tr-TR');el('kpHeaderLevel').textContent=x?fmt(x.level):'—';el('kpHeaderTotal').textContent=x?fmt(x.xp)+' XP':'—';el('kpHeaderMeter').max=x?x.nextLevelXp:100;el('kpHeaderMeter').value=x?x.levelXp:0;el('kpHeaderNext').textContent=x?`${fmt(x.levelXp)} / ${fmt(x.nextLevelXp)} XP · ${fmt(x.remainingXp)} XP kaldı`:'XP bilgisi alınamadı';}

const seenMemory=new Map();
let badgeTimer;
function achievementBlock(items){
  if(!Array.isArray(items))return block('🏅 Başarılar',['Rozet bilgisi şu anda alınamadı.']);
  const unlocked=items.filter(x=>x.unlocked),box=block('🏅 Başarılar ve rozetler',[`${unlocked.length} / ${items.length} rozet kazanıldı`,unlocked.length?unlocked.map(x=>x.icon+' '+x.name).join(' · '):'İlk rozetini kazanmak için bir maç tamamla.']);
  const edit=document.createElement('a');edit.href='/stats.html#edit-profile';edit.textContent='Profilimi özelleştir ↗';edit.style.cssText='display:block;color:#e1c9ff;font-weight:800;font-size:13px;margin-top:8px;';box.append(edit);const link=document.createElement('a');link.href='/stats.html#achievements';link.textContent='Rozet koleksiyonunu aç ↗';link.style.cssText='display:inline-block;color:#e1c9ff;font-weight:800;font-size:13px;margin-top:8px;';box.append(link);return box;
}
function notifyAchievements(items,username){
  if(!Array.isArray(items)||!username)return;
  const key='kekip.achievements.seen.v1.'+username;
  let previous=seenMemory.get(key);
  if(!previous){try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(Array.isArray(saved))previous=saved.filter(x=>typeof x==='string')}catch{}}
  const unlocked=items.filter(x=>x.unlocked),ids=unlocked.map(x=>x.id);
  // First visit establishes a baseline; later visits notify only newly observed unlocks.
  const newOnes=previous?unlocked.filter(x=>!previous.includes(x.id)):[];
  const next=[...new Set([...(previous||[]),...ids])];seenMemory.set(key,next);
  try{localStorage.setItem(key,JSON.stringify(next))}catch{}
  if(!newOnes.length)return;
  document.getElementById('kpBadgeToast')?.remove();clearTimeout(badgeTimer);
  const toast=document.createElement('div');toast.id='kpBadgeToast';toast.className='kp-badge-toast';toast.setAttribute('role','status');
  const title=document.createElement('strong');title.textContent='🏅 Yeni rozet kazandın!';
  const names=document.createElement('span');names.textContent=newOnes.map(x=>x.icon+' '+x.name).join(' · ');
  const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Rozet bildirimini kapat');close.onclick=()=>toast.remove();
  toast.append(title,names,close);(dialog.open?dialog:document.body).append(toast);badgeTimer=setTimeout(()=>toast.remove(),6500);
}

async function stats(){if(!user)return;const request=++statsRequest,username=user.username;try{const s=await api('stats');if(request!==statsRequest||user?.username!==username)return;headerProgress(s.progress);el('kpStats').replaceChildren(...(s.progress?[progressBlock(s.progress)]:[]),block('⚓ Amiral Battı',[`${s.battle.games} maç · ${s.battle.wins} galibiyet · ${s.battle.losses} mağlubiyet`,`${s.battle.hits} / ${s.battle.shots} isabetli atış · ${s.battle.shipsSunk} batırılan gemi`]),block('⚽ KEKIP Futbol Kariyer',[`${s.football.careers} ortak kariyer · ${s.football.games} maç`,`${s.football.goals} gol · ${s.football.assists} asist`]),achievementBlock(s.achievements));notifyAchievements(s.achievements,username);}catch(e){if(request!==statsRequest||user?.username!==username)return;headerProgress(null);el('kpStats').textContent=e.message}}
async function init(){try{user=(await api('me')).user;render();if(user)await stats();else {statsRequest++;headerProgress(null);}}catch(e){msg(e.message)}}
async function sign(action){if(busy)return;if(joined){msg('Hesap değiştirmeden önce odadan ayrıl.');return}if(action!=='logout'&&!el('kpAuthForm').reportValidity())return;busy=true;render();try{await api(action,action==='logout'?{}:{username:el('kpUsername').value,password:el('kpPassword').value,...(action==='register'?{inviteCode:el('kpInvite').value}:{})});location.reload();}catch(e){msg(e.message);busy=false;render()}}
el('kpAccountOpen').onclick=()=>{msg('');dialog.showModal();init()};el('kpAccountClose').onclick=()=>dialog.close();el('kpAuthForm').onsubmit=e=>{e.preventDefault();sign('login')};el('kpRegister').onclick=()=>sign('register');el('kpLogout').onclick=()=>sign('logout');el('kpRefresh').onclick=()=>stats();
socket.on('statsSaved',r=>{if(r.ok){stats();}else error('Oyun tamamlandı ancak hesap istatistikleri kaydedilemedi.');});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&user)stats()});
window.addEventListener('pageshow',e=>{if(e.persisted&&!joined)location.reload()});init();
})();
