'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const create=$('arenaCreate'),join=$('arenaJoin'),room=$('arenaRoom'),stage=$('arenaStage');
 const params=new URLSearchParams(location.search);
 const invite=params.get('room')?.trim().toUpperCase();
 if(invite)$('arenaCode').value=invite;
 const socket=io('/arena',{autoConnect:false,forceNew:true});
 let current=null,offset=0,press=null,sending=false,cueKey='',soundOn=true,audio=null;
 let useInvite=Boolean(invite);
 const notified=new Set(),playerCards=new Map();
 let rosterKey='';
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
 create.onsubmit=event=>{
  event.preventDefault();
  run(()=>emit('create',{visibility:new FormData(create).get('visibility')}));
 };
 join.onsubmit=event=>{event.preventDefault();run(()=>emit('join',{code:$('arenaCode').value.trim().toUpperCase()}));};
 const serverNow=()=>Date.now()+offset;
 const reflex=$('arenaReflex'),sound=$('arenaSound');
 function unlockSound(){
  if(!soundOn)return;
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)return;
  try{if(!audio)audio=new Context();audio.resume().catch(()=>{});}catch{}
 }
 document.addEventListener('pointerdown',event=>{if(!event.target.closest('#arenaSound'))unlockSound();},{capture:true});
 document.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')unlockSound();},{capture:true});
 sound.onclick=()=>{
  if(soundOn&&audio?.state==='running')soundOn=false;
  else{soundOn=true;unlockSound();}
  sound.setAttribute('aria-pressed',String(soundOn));
  sound.textContent=soundOn?'Ses efekti açık':'Ses efekti kapalı';
 };
 function tone(frequency,length,delay=0){
  if(!soundOn||audio?.state!=='running')return;
  const start=audio.currentTime+delay,osc=audio.createOscillator(),gain=audio.createGain();
  osc.type='sine';osc.frequency.value=frequency;
  gain.gain.setValueAtTime(.001,start);gain.gain.exponentialRampToValueAtTime(.13,start+.012);
  gain.gain.exponentialRampToValueAtTime(.001,start+length);osc.connect(gain);gain.connect(audio.destination);
  osc.start(start);osc.stop(start+length);
 }
 function renderStage(t){
  if(!current||current.phase==='lobby')return;
  const {challenge,phase,number,settings}=current;
  const title=$('arenaRoundTitle'),prompt=$('arenaPrompt'),clock=$('arenaClock');
  const update=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  reflex.hidden=!challenge;
  if(!challenge){
   clock.textContent=current.deadline?Math.max(0,Math.ceil((current.deadline-t)/1000))+' sn':'';
   update(title,phase==='final'?'Maç tamamlandı':'Tur '+number+' sonuçları');
   if(current.cancelled){update(prompt,'Maç, yeterli oyuncu kalmadığı için sona erdi.');return;}
   if(phase==='final'){
    const top=Math.max(...current.players.map(player=>player.total));
    const names=current.players.filter(player=>player.total===top).map(player=>'@'+player.username);
    update(prompt,(names.length>1?'Berabere · ':'Kazanan · ')+names.join(', '));
   }else update(prompt,'En hızlı geçerli tepki 100 puan alır.');
   return;
  }
  const lit=challenge.phase==='lit';
  const expired=challenge.endsAt!==null&&t>=challenge.endsAt;
  const ready=challenge.phase!=='prepare';
  update(title,'Refleks Testi · '+number+'/'+settings.rounds);
  clock.textContent=!ready?Math.max(0,Math.ceil((challenge.startsAt-t)/1000))+' sn':'';
  reflex.dataset.state=press?(press.kind==='hit'?'hit':'early'):lit&&!expired?'lit':'waiting';
  reflex.disabled=!ready||Boolean(press)||sending||expired||!socket.connected;
  if(press){
   update(reflex,press.kind==='hit'?press.ms+' ms':'Erken tıklama');
   update(prompt,press.kind==='hit'?'Tepkin kaydedildi.':'Düğme parlamadan tıkladın. Bu tur 0 puan.');
  }else if(expired){
   update(reflex,'Süre doldu');update(prompt,'Sonraki turu bekle.');
  }else{
   update(reflex,lit?'ŞİMDİ TIKLA':'Bekle');
   update(prompt,ready?'Düğme parlayınca tıkla.':'Tur başlıyor.');
  }
  const key=current.code+':'+number;
  if(lit&&!expired&&!press&&cueKey!==key){
   cueKey=key;tone(660,.15);tone(880,.20,.075);
  }
 }
 reflex.onclick=async()=>{
  if(reflex.disabled||!current?.challenge)return;
  const {code,number}=current;
  const sameRound=()=>current?.code===code&&current.number===number;
  sending=true;renderStage(serverNow());
  try{
   const result=await emit('action',{round:number});
   if(sameRound()){
    press=result.press;
    tone(press.kind==='hit'?520:170,.15);
   }
  }catch(error){if(sameRound())status(error.message);}
  finally{if(sameRound()){sending=false;renderStage(serverNow());}}
 };
 socket.on('arena:state',data=>{
  const entering=!current;
  const newRound=data.phase==='round'&&(current?.phase!=='round'||current.number!==data.number);
  if(entering||current.number!==data.number||current.code!==data.code){press=null;sending=false;}
  if(data.challenge?.press)press=data.challenge.press;
  offset=data.serverTime-Date.now();
  current=data;room.dataset.code=data.code;room.dataset.phase=data.phase;room.hidden=false;$('arenaEntry').hidden=true;
  stage.hidden=data.phase==='lobby';$('arenaRoomTitle').textContent='Arena lobisi · '+data.code;
  $('arenaRoomInfo').textContent=data.players.length+'/8 oyuncu · Refleks Testi';
  const players=[...data.players].sort((a,b)=>b.total-a.total||a.username.localeCompare(b.username));
  const displayKey=JSON.stringify([data.phase==='summary',players]);
  if(displayKey!==rosterKey){
   const active=new Set(players.map(player=>player.username));
   for(const username of playerCards.keys())if(!active.has(username))playerCards.delete(username);
   const list=$('arenaPlayers');
   players.forEach((player,index)=>{
    let card=playerCards.get(player.username);
    if(!card){
     const item=node('li',''),portrait=node('div',''),info=node('div','');
     portrait.className='arena-player-portrait';
     portrait.dataset.kpAvatar=player.username;
     portrait.dataset.kpAvatarMode='body';
     portrait.setAttribute('aria-hidden','true');
     portrait.append(node('span',player.username.slice(0,2).toUpperCase()));
     info.className='arena-player-info';
     const name=node('strong',''),score=node('span','');
     info.append(name,score);item.append(portrait,info);
     card={item,name,score};playerCards.set(player.username,card);
    }
    card.name.textContent='@'+player.username+(player.online?'':' · Çevrimdışı');
    const last=player.reaction;
    const reaction=last?.kind==='hit'?last.ms+' ms':last?.kind==='early'?'Erken tıklama':'Süre doldu';
    card.score.textContent=(data.phase==='summary'&&last?reaction+' · +'+player.last+' · ':'')+player.total+' puan';
    if(list.children[index]!==card.item)list.insertBefore(card.item,list.children[index]||null);
   });
   while(list.children.length>players.length)list.lastElementChild.remove();
   rosterKey=displayKey;
   window.KEKIPPortraits?.refresh?.();
  }
  const start=$('arenaStart');
  start.hidden=data.phase!=='lobby'||data.host!==data.you;
  start.disabled=data.players.length<2||players.some(player=>!player.online);
  $('arenaInvite').hidden=data.party||data.phase!=='lobby';
  if(entering){status('');$('arenaRoomTitle').focus();}
  if(data.phase==='final'&&!data.cancelled){
   if(data.rewards==='pending')status('Maç ödülleri kaydediliyor…');
   else if(data.rewards==='failed')status('Maç ödülleri şu anda kaydedilemedi.');
   else if(!data.rewards)status('Ödül için en az iki oyuncunun dörder tur oynaması gerekir.');
  }
  if(data.rewardMatchId&&!notified.has(data.rewardMatchId)){
   notified.add(data.rewardMatchId);
   status('Maç ödülleri kaydedildi.');
   window.dispatchEvent(new CustomEvent('kekip:match-cards-ready',{detail:{game:'arena',matchId:data.rewardMatchId}}));
  }
  renderStage(serverNow());
  if(newRound)stage.scrollIntoView({block:'start'});
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
  await emit('leave');current=null;press=null;sending=false;cueKey='';room.hidden=true;room.dataset.code='';$('arenaEntry').hidden=false;create.querySelector('button').focus();
 });
 $('arenaInvite').onclick=()=>run(async()=>{
  const link=new URL('/arena.html',location.origin);link.searchParams.set('room',current.code);
  await navigator.clipboard.writeText(link.toString());status('Davet bağlantısı kopyalandı.');
 });
 setInterval(()=>renderStage(serverNow()),100);
 socket.connect();
})();
