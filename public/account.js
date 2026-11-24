'use strict';
(()=>{
const el=id=>document.getElementById(id);let user=null,busy=false;
const dialog=el('kpAccountDialog');
const msg=t=>el('kpMessage').textContent=t;
async function api(action,data={}){const r=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let j;try{j=await r.json()}catch{throw Error('Hesap servisine ulaşılamadı.')}if(!r.ok)throw Error(j.error||'İşlem başarısız.');return j}
function render(){window.kpAccount=user;el('kpAccountOpen').textContent=user?'👤 @'+user.username:'👤 Giriş yap';el('kpGuest').hidden=!!user;el('kpMember').hidden=!user;el('kpMemberName').textContent=user?'@'+user.username:'';if(!joined){el('playerName').readOnly=!!user;if(user)el('playerName').value=user.username}for(const id of ['kpLogin','kpRegister','kpLogout','kpRefresh'])el(id).disabled=busy;}
function block(title,lines){const box=document.createElement('div');box.className='kp-stats-block';const b=document.createElement('b');b.textContent=title;box.append(b);for(const text of lines){const span=document.createElement('span');span.textContent=text;box.append(span)}return box}
async function stats(){if(!user)return;try{const s=await api('stats');el('kpStats').replaceChildren(block('⚓ Amiral Battı',[`${s.battle.games} maç · ${s.battle.wins} galibiyet · ${s.battle.losses} mağlubiyet`,`${s.battle.hits} / ${s.battle.shots} isabetli atış · ${s.battle.shipsSunk} batırılan gemi`]),block('⚽ KEKIP Football',[`${s.football.careers} ortak kariyer · ${s.football.games} maç`,`${s.football.goals} gol · ${s.football.assists} asist`]));}catch(e){el('kpStats').textContent=e.message}}
async function init(){try{user=(await api('me')).user;render();if(dialog.open)await stats()}catch(e){msg(e.message)}}
async function sign(action){if(busy)return;if(joined){msg('Hesap değiştirmeden önce odadan ayrıl.');return}if(action!=='logout'&&!el('kpAuthForm').reportValidity())return;busy=true;render();try{await api(action,action==='logout'?{}:{username:el('kpUsername').value,password:el('kpPassword').value,...(action==='register'?{inviteCode:el('kpInvite').value}:{})});location.reload();}catch(e){msg(e.message);busy=false;render()}}
el('kpAccountOpen').onclick=()=>{msg('');dialog.showModal();init()};el('kpAccountClose').onclick=()=>dialog.close();el('kpAuthForm').onsubmit=e=>{e.preventDefault();sign('login')};el('kpRegister').onclick=()=>sign('register');el('kpLogout').onclick=()=>sign('logout');el('kpRefresh').onclick=()=>stats();
socket.on('statsSaved',r=>{if(r.ok){if(dialog.open)stats();}else error('Oyun tamamlandı ancak hesap istatistikleri kaydedilemedi.');});
window.addEventListener('pageshow',e=>{if(e.persisted&&!joined)location.reload()});init();
})();
