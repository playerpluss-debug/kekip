'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const create=$('arenaCreate'),join=$('arenaJoin'),room=$('arenaRoom'),stage=$('arenaStage');
 const titles={reaction:'Tepki Protokolü',color:'Renk Şifresi',missing:'Eksik Parça',words:'İpucu Zinciri'};
 const figures={'Ay':'☾','Yıldız':'★','Elmas':'◆','Güneş':'☀','Bulut':'☁','Yaprak':'❧','Dalga':'≈','Şimşek':'ϟ'};
 const shapes={'Üçgen':'▲','Daire':'●','Kare':'■'};
 const params=new URLSearchParams(location.search);
 const invite=params.get('room')?.trim().toUpperCase();
 if(invite)$('arenaCode').value=invite;
 const socket=io('/arena');
 let current=null,offset=0,viewKey='',submitted=new Set(),inputRound=0;
 let useInvite=Boolean(invite);
 const status=message=>{$('arenaStatus').textContent=message;};
 const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
 const emit=(event,data={})=>new Promise((resolve,reject)=>{
  socket.timeout(6500).emit('arena:'+event,data,(error,result)=>{
   if(error||!result?.ok)reject(Error(result?.error||'Arena sunucusuna ulaşılamadı.'));
   else resolve(result);
  });
 });
 const run=operation=>operation().catch(error=>status(error.message));
 function entry(enabled){
  for(const form of [create,join])form.querySelector('button[type=submit]').disabled=!enabled;
 }
 for(const [id,title] of Object.entries(titles)){
  const label=node('label',''),input=document.createElement('input');
  input.type='checkbox';input.name='selected';input.value=id;input.checked=true;
  label.append(input,document.createTextNode(title));$('arenaChoices').append(label);
 }
 create.elements.mode.onchange=()=>{$('arenaChoices').hidden=create.elements.mode.value!=='custom';};
 create.onsubmit=event=>{
  event.preventDefault();
  const data=new FormData(create);
  run(()=>emit('create',{visibility:data.get('visibility'),mode:data.get('mode'),selected:data.getAll('selected')}));
 };
 join.onsubmit=event=>{event.preventDefault();run(()=>emit('join',{code:$('arenaCode').value.trim().toUpperCase()}));};
 const serverNow=()=>Date.now()+offset;
 function symbolList(names){
  const list=node('div','');list.className='arena-symbols';
  for(const name of names)list.append(node('span',figures[name]+' '+name));
  return list;
 }
 function action(label,input,key=input,color){
  const button=node('button',label);button.type='button';button.disabled=submitted.has(key)||!socket.connected;
  if(color){button.className='arena-tile';button.dataset.color=color.toLocaleLowerCase('tr');}
  button.onclick=async()=>{
   const number=current.number;
   if(submitted.has(key))return;
   submitted.add(key);button.disabled=true;
   try{
    await emit('action',{round:number,input});
    if(typeof key==='string'&&key==='answer'&&current?.number===number)for(const option of $('arenaMoves').children)option.disabled=true;
   }catch(error){
    if(current?.number===number){submitted.delete(key);button.disabled=false;status(error.message);}
   }
  };
  return button;
 }
 function renderStage(t){
  if(!current||current.phase==='lobby')return;
  const game=current.challenge,phase=current.phase;
  const before=game&&t<game.startsAt;
  const key=JSON.stringify([current.number,phase,before,game?.prompt]);
  const remaining=before?game.startsAt-t:current.deadline-t;
  $('arenaClock').textContent=current.deadline?Math.max(0,Math.ceil(remaining/1000))+' sn':'';
  if(key===viewKey)return;
  viewKey=key;
  const prompt=$('arenaPrompt'),moves=$('arenaMoves');
  prompt.replaceChildren();moves.replaceChildren();
  if(!game){
   const top=Math.max(...current.players.map(player=>player.total));
   const names=current.players.filter(player=>player.total===top).map(player=>'@'+player.username);
   $('arenaRoundTitle').textContent=phase==='final'?'Maç tamamlandı':'Tur sonuçları';
   prompt.append(node('p',phase==='final'?(names.length>1?'Berabere · ':'Kazanan · ')+names.join(', '):'Puanlar güncellendi.'));
   return;
  }
  $('arenaRoundTitle').textContent=current.number+'. tur · '+titles[game.id];
  if(before){prompt.append(node('p','Hazırlan…'));return;}
  const data=game.prompt;
  if(game.id==='reaction'){
   prompt.append(node('p','Hedef: '+figures[data.target]+' '+data.target));
   if(data.symbol){prompt.append(symbolList([data.symbol]));moves.append(action('İşareti yakala',data.index));}
   else prompt.append(node('p','İşareti bekle.'));
  }else if(game.id==='color'){
   prompt.append(node('p','Seç: '+data.rule.color+' '+data.rule.shape));
   data.tiles.forEach((tile,index)=>moves.append(action(shapes[tile.shape]+' '+tile.color+' '+tile.shape,data.stage*8+index,undefined,tile.color)));
  }else if(game.id==='missing'){
   prompt.append(node('p',data.shown?'Bu işaretleri aklında tut.':'Hangi işaret kayboldu?'));
   prompt.append(symbolList(data.shown||data.remaining));
   if(data.options)for(const name of data.options)moves.append(action(figures[name]+' '+name,name,'answer'));
  }else if(game.id==='words'){
   const list=node('ol','');
   for(const clue of data.clues)list.append(node('li',clue));
   prompt.append(list);
   for(const word of data.options)moves.append(action(word,word,'answer'));
  }
 }
 socket.on('arena:state',data=>{
  const entering=!current;
  if(inputRound!==data.number||entering){submitted=new Set();inputRound=data.number;viewKey='';}
  for(const key of data.actions)submitted.add(key);
  offset=data.serverTime-Date.now();
  current=data;room.dataset.code=data.code;room.dataset.phase=data.phase;room.hidden=false;$('arenaEntry').hidden=true;
  stage.hidden=data.phase==='lobby';$('arenaRoomTitle').textContent='Arena lobisi · '+data.code;
  $('arenaRoomInfo').textContent=data.players.length+'/8 oyuncu · '+(data.settings.selected?'Özel Liste':'Karma Arena');
  const players=[...data.players].sort((a,b)=>b.total-a.total||a.username.localeCompare(b.username));
  $('arenaPlayers').replaceChildren(...players.map(player=>{
   const item=node('li','');
   item.append(node('strong','@'+player.username+(player.online?'':' · Çevrimdışı')),
    node('span',data.phase==='summary'?'+'+player.last+' · '+player.total+' puan':player.total+' puan'));
   return item;
  }));
  const start=$('arenaStart');
  start.hidden=data.phase!=='lobby'||data.host!==data.you;
  start.disabled=data.players.length<2||players.some(player=>!player.online);
  $('arenaInvite').hidden=data.party||data.phase!=='lobby';
  if(entering){status('');$('arenaRoomTitle').focus();}
  renderStage(serverNow());
 });
 socket.on('connect',async()=>{
  entry(true);
  try{await emit('resume');status('');}
  catch(error){
   if(error.message!=='Kayıtlı lobi yok.'){status(error.message);return;}
   if(useInvite){useInvite=false;run(()=>emit('join',{code:invite}));}
   else status(params.has('partyRoom')?'Parti lobisi bulunamadı.':'');
  }
 });
 socket.on('connect_error',error=>{entry(false);status(error.message);});
 socket.on('disconnect',()=>{entry(false);status('Bağlantı kesildi. Yeniden bağlanılıyor…');});
 $('arenaStart').onclick=()=>run(()=>emit('start'));
 $('arenaLeave').onclick=()=>run(async()=>{
  await emit('leave');current=null;viewKey='';room.hidden=true;room.dataset.code='';$('arenaEntry').hidden=false;create.querySelector('button').focus();
 });
 $('arenaInvite').onclick=()=>run(async()=>{
  const link=new URL('/arena.html',location.origin);link.searchParams.set('room',current.code);
  await navigator.clipboard.writeText(link.toString());status('Davet bağlantısı kopyalandı.');
 });
 setInterval(()=>renderStage(serverNow()),100);
})();
