'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const games={battleship:[2,2],football:[2,8],late_answer:[3,8],arena:[2,8]};
 let data=null,busy=false,polling=false,identity=null,lastLaunch=null,revision=0;
 const lists=new Map();
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 function button(text,fn){const b=node('button',text);b.type='button';b.onclick=fn;return b;}
 function status(text='',error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
 async function api(action,body={}){
  const r=await fetch('/api/party/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await r.json();
  if(!r.ok)throw Object.assign(new Error(result.error||'Parti işlemi tamamlanamadı.'),{status:r.status});
  return result;
 }
 function renderList(id,items,render){
  const signature=JSON.stringify(items);
  if(lists.get(id)===signature)return false;
  lists.set(id,signature);$(id).replaceChildren(...items.map(render));return true;
 }
 function renderGame(){
  const p=data?.party;
  if(!p)return;
  const [min,max]=games[$('game').value],n=p.members.length;
  const ready=p.members.every(m=>m.ready&&m.online);
  const fit=n>=min&&n<=max;
  $('launch').disabled=busy||p.busy||!fit||!ready;
  $('gameNote').textContent=!fit?(min===max?min:min+'–'+max)+' oyuncu gerekli.':!ready?'Tüm üyelerin çevrimiçi ve hazır olması gerekiyor.':
    $('game').value==='football'?'Yeni ortak kariyer açılır. Başlangıç mevkisi forvet, kulüpler üyelere sırayla atanır.':'Tüm üyeler için aynı özel odada yer ayrılır.';
 }
 function navigate(launch){
  if(!launch||typeof launch.id!=='string'||!/^\/(?:\?partyRoom=[A-Z2-9]{5}|(?:late-answer|arena)\.html\?partyRoom=[A-Z2-9]{5}|football\.html\?footballRoom=[A-F0-9]{10}&party=1)$/.test(launch.url))return;
  $('returnToGame').hidden=false;$('returnToGame').href=launch.url;
  const key='kekip.party.launch.'+data.username;
  try{lastLaunch=sessionStorage.getItem(key)||lastLaunch;}catch{}
  if(lastLaunch===launch.id)return;
  lastLaunch=launch.id;
  try{sessionStorage.setItem(key,launch.id);}catch{}
  location.assign(launch.url);
 }
 function render(){
  const p=data?.party,invites=data?.invites||[],self=data?.username;
  const leader=!!p&&p.leader===self;
  $('partyEntry').hidden=!self||!!p;$('party').hidden=!p;$('invites').hidden=!invites.length;
  renderList('inviteList',invites.map(i=>({...i,canAccept:!p})),i=>{
   const li=node('li');li.append(node('span','@'+i.leader+' seni partisine davet etti.'));
   const actions=node('div');actions.className='actions';
   const accept=button('Katıl',()=>act('accept',{id:i.id}));accept.disabled=!i.canAccept;
   actions.append(accept,button('Reddet',()=>act('decline',{id:i.id})));li.append(actions);return li;
  });
  $('returnToGame').hidden=true;
  if(!p)return;
  $('memberCount').textContent=p.members.length+' / 8';
  $('ready').textContent=p.ready?'Hazır değilim':'Hazırım';
  $('ready').setAttribute('aria-pressed',String(p.ready));
  $('ready').disabled=$('leave').disabled=p.busy;
  $('leaderGames').hidden=!leader;$('memberGameNote').hidden=leader;$('inviteForm').hidden=!leader;
  renderList('members',p.members.map(m=>({...m,isLeader:m.username===p.leader,canLead:leader&&m.username!==self&&!p.busy,self:m.username===self})),m=>{
   const li=node('li'),person=node('div');person.className='person';person.dataset.online=String(m.online);
   person.append(node('strong','@'+m.username+(m.isLeader?' · Lider':'')+(m.self?' (Sen)':'')),
    node('small',m.online?(m.ready?'Çevrimiçi · Hazır':'Çevrimiçi · Hazır değil'):'Bağlantı bekleniyor'));
   li.append(person);
   if(m.canLead){const b=button('Lider yap',()=>act('leader',{target:m.username}));b.setAttribute('aria-label','@'+m.username+' oyuncusunu lider yap');li.append(b);}
   return li;
  });
  const chat=$('messages');
  const nearBottom=chat.scrollHeight-chat.scrollTop-chat.clientHeight<35;
  if(renderList('messages',p.messages,m=>{const li=node('li');li.append(node('strong','@'+m.username),node('span',m.text));return li;})&&nearBottom)chat.scrollTop=chat.scrollHeight;
  $('chatEmpty').hidden=p.messages.length>0;
  renderGame();
  if(p.launch)navigate(p.launch);
 }
 async function loadFriends(){
  if(!data||identity===data.username)return;
  const username=data.username;
  identity=username;
  try{
   const r=await api('friends');
   if(data?.username!==username)return;
   $('friend').replaceChildren(new Option(r.friends.length?'Arkadaş seç':'Henüz arkadaşın yok',''),...r.friends.map(n=>new Option('@'+n,n)));
   $('friend').disabled=!r.friends.length;
  }catch{if(identity===username)identity=null;}
 }
 async function poll(){
  if(polling||busy||document.hidden)return;
  polling=true;const stamp=revision;
  try{
   const r=await api('state');
   if(busy||stamp!==revision)return;
   data=r;render();
   if($('status').classList.contains('error')&&$('status').dataset.connection){delete $('status').dataset.connection;status();}
   if(r.party?.leader===r.username)void loadFriends();
  }catch(e){if(stamp!==revision)return;if(e.status===401||e.status===403){data=null;identity=null;render();}
   $('status').dataset.connection='1';status(e.message,true);
  }finally{polling=false;}
 }
 async function act(action,body={}){
  if(busy||!data)return false;
  busy=true;revision++;delete $('status').dataset.connection;status();renderGame();
  try{
   data=await api(action,{username:data.username,...body});
   if(action==='invite')status('Davet gönderildi.');
   render();if(data.party?.leader===data.username)void loadFriends();return true;
  }catch(e){status(e.message,true);return false;}
  finally{busy=false;renderGame();}
 }
 $('inviteForm').onsubmit=e=>{e.preventDefault();const target=$('friend').value;if(target)void act('invite',{target});};
 $('chatForm').onsubmit=async e=>{e.preventDefault();const text=$('chat').value;if(await act('chat',{text})&&$('chat').value===text)$('chat').value='';};
 $('create').onclick=()=>void act('create');$('ready').onclick=()=>void act('ready',{ready:!data?.party?.ready});
 $('leave').onclick=()=>void act('leave');$('launch').onclick=()=>void act('launch',{game:$('game').value});$('game').onchange=renderGame;
 window.addEventListener('focus',poll);window.addEventListener('online',poll);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
 const partyPollInterval=4000,lobbyPollInterval=12000;
 let lastPoll=0;
 setInterval(()=>{
  const interval=data?.party?partyPollInterval:lobbyPollInterval;
  if(Date.now()-lastPoll>=interval){lastPoll=Date.now();void poll();}
 },partyPollInterval);
 lastPoll=Date.now();void poll();
})();
