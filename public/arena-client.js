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
 const notified=new Set(),cardQueue=new Set(),playerCards=new Map();
 const results=$('arenaResults'),resultsTitle=$('arenaResultsTitle'),lastResults=$('arenaLastResults');
 let renderedResult=null;
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
 const picker=$('arenaGamePicker'),gameOptions=$('arenaGameOptions');
 let savingGames=false,catalogKey='';
 const colors=$('arenaColors'),colorButtons=[...colors.querySelectorAll('button')];
 const gameNames=new Map();
 const gameTitle=id=>gameNames.get(id)||id;
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
 function paintColors(palette,{disabled,choice,answer}){
  colors.hidden=!palette;
  if(!palette)return;
  colorButtons.forEach((button,index)=>{
   button.style.setProperty('--arena-color',palette[index]);
   button.disabled=disabled;
   button.classList.toggle('selected',choice===index);
   button.classList.toggle('correct',answer===index);
  });
 }
 function renderStage(t){
  if(!current)return;
  if(current.phase==='final'){
   $('arenaReturnClock').textContent='Lobiye dönüş '+Math.max(0,Math.ceil((current.deadline-t)/1000))+' sn';return;
  }
  if(current.phase==='lobby')return;
  const {challenge,number,settings,game}=current;
  const title=$('arenaRoundTitle'),prompt=$('arenaPrompt'),clock=$('arenaClock');
  const update=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
  reflex.hidden=!challenge||game==='color';
  if(game!=='color')colors.hidden=true;
  if(!challenge){
   clock.textContent=current.deadline?Math.max(0,Math.ceil((current.deadline-t)/1000))+' sn':'';
   update(title,'Tur '+number+' sonuçları');
   if(game==='color'){
    const own=current.players.find(player=>player.username===current.you)?.reaction;
    const answer=current.colorAnswer;
    paintColors(answer?.colors,{disabled:true,choice:own?.choice,answer:answer?.odd});
    const result=own?.kind==='hit'?'Doğru cevap · '+own.points+' puan':own?.kind==='wrong'?'Yanlış cevap · 0 puan':'Cevap verilmedi · 0 puan';
    update(prompt,result+(answer?' · Farklı renk '+(answer.odd+1)+'. dairedeydi.':''));
   }else update(prompt,'En hızlı geçerli tepki 100 puan alır.');
   return;
  }
  const lit=challenge.phase==='lit';
  const expired=challenge.endsAt!==null&&t>=challenge.endsAt;
  const ready=challenge.phase!=='prepare';
  update(title,gameTitle(game)+' · '+number+'/'+settings.rounds);
  if(game==='color'){
   const palette=challenge.colors;
   clock.textContent=(lit?Math.max(0,Math.ceil((challenge.endsAt-t)/1000)):Math.max(0,Math.ceil((challenge.startsAt-t)/1000)))+' sn';
   paintColors(palette,{disabled:!lit||expired||Boolean(press)||sending||!socket.connected,choice:press?.choice});
   update(prompt,press?'Seçimin kaydedildi.':expired?'Süre doldu.':ready?'Diğer ikisinden farklı olan daireyi seç.':'Tur başlıyor.');
   return;
  }
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
 async function submit(choice){
  if(sending||press||!current?.challenge)return;
  const {code,number}=current;
  const sameRound=()=>current?.code===code&&current.number===number;
  sending=true;renderStage(serverNow());
  try{
   const result=await emit('action',{round:number,choice});
   if(sameRound()){
    press=result.press;
    tone(press.kind==='early'?170:520,.15);
   }
  }catch(error){if(sameRound())status(error.message);}
  finally{if(sameRound()){sending=false;renderStage(serverNow());}}
 }
 reflex.onclick=()=>{if(!reflex.disabled)submit();};
 colorButtons.forEach((button,index)=>{button.onclick=()=>{if(!button.disabled)submit(index);};});
 function showResults(result){
  if(!result)return;
  results.hidden=false;
  lastResults.setAttribute('aria-expanded','true');
  if(renderedResult===result.id)return;
  renderedResult=result.id;
  const leaders=result.standings.filter(player=>player.rank===1);
  $('arenaResultsSummary').textContent=result.cancelled?'Maç, yeterli oyuncu kalmadığı için sona erdi.':
   (leaders.length>1?'Birinciliği paylaşanlar · ':'Kazanan · ')+leaders.map(player=>'@'+player.username).join(', ');
  $('arenaStandings').replaceChildren(...result.standings.map((player,index)=>{
   const row=node('li','');
   row.style.setProperty('--arena-reveal-delay',index*85+'ms');
   row.dataset.rank=String(player.rank);
   const rank=node('span',player.rank+'.');rank.className='arena-result-rank';
   const copy=node('div',''),name=node('strong','@'+player.username);
   const detail=node('small',(result.games.includes('color')&&result.games.includes('reflex')?player.hits+' başarılı · '+player.wrong+' yanlış · '+player.early+' erken':result.games.includes('color')?player.hits+' doğru · '+player.wrong+' yanlış':player.hits+' tepki · '+player.early+' erken')+' · '+player.missed+' kaçan'+
     (player.fastest===null?'':' · En iyi '+player.fastest+' ms'));
   copy.append(name,detail);
   const score=node('strong',player.total+' puan');score.className='arena-result-score';
   row.append(rank,copy,score);return row;
  }));
 }
 function hideResults(){
  results.hidden=true;lastResults.setAttribute('aria-expanded','false');
  $('arenaReturnClock').textContent='';
 }
 lastResults.onclick=()=>{
  if(!results.hidden){hideResults();return;}
  showResults(current?.results);
  if(!results.hidden){results.scrollIntoView({block:'start'});resultsTitle.focus({preventScroll:true});}
 };
 function showCards(){
  if(!current||!['lobby','final'].includes(current.phase))return;
  for(const matchId of cardQueue){
   cardQueue.delete(matchId);
   if(notified.has(matchId))continue;
   notified.add(matchId);
   if(notified.size>100)notified.delete(notified.values().next().value);
   window.dispatchEvent(new CustomEvent('kekip:match-cards-ready',{detail:{game:'arena',matchId}}));
  }
 }
 socket.on('arena:card',({matchId})=>{
  if(typeof matchId==='string'){cardQueue.add(matchId);showCards();}
 });
 function renderGamePicker(data){
  const key=JSON.stringify(data.availableGames);
  if(key!==catalogKey){
   catalogKey=key;gameNames.clear();
   gameOptions.replaceChildren(...data.availableGames.map(game=>{
    gameNames.set(game.id,game.title);
    const label=node('label',''),input=document.createElement('input');
    input.type='checkbox';input.value=game.id;
    label.append(input,document.createTextNode(game.title));return label;
   }));
  }
  picker.hidden=data.phase!=='lobby'||data.host!==data.you;
  picker.disabled=savingGames;
  for(const input of gameOptions.querySelectorAll('input'))input.checked=data.settings.games.includes(input.value);
 }
 function refreshStart(data){
  const start=$('arenaStart');
  start.hidden=data.phase!=='lobby'||data.host!==data.you;
  start.disabled=savingGames||data.players.length<2||data.players.some(player=>!player.online);
 }
 socket.on('arena:state',data=>{
  const entering=!current;
  const previousPhase=current?.phase;
  const newRound=data.phase==='round'&&(current?.phase!=='round'||current.number!==data.number);
  if(entering||current.number!==data.number||current.code!==data.code){press=null;sending=false;}
  if(data.challenge?.press)press=data.challenge.press;
  offset=data.serverTime-Date.now();
  current=data;room.dataset.code=data.code;room.dataset.phase=data.phase;room.hidden=false;$('arenaEntry').hidden=true;
  stage.hidden=data.phase==='lobby'||data.phase==='final';$('arenaRoomTitle').textContent='Arena lobisi · '+data.code;
  renderGamePicker(data);
  $('arenaRoomInfo').textContent=data.players.length+'/8 oyuncu · '+(data.game?gameTitle(data.game):data.settings.games.map(gameTitle).join(' · '));
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
    const reaction=last?.kind==='hit'?last.ms+' ms':last?.kind==='early'?'Erken tıklama':last?.kind==='wrong'?'Yanlış cevap':'Süre doldu';
    card.score.textContent=(data.phase==='summary'&&last?reaction+' · +'+player.last+' · ':'')+player.total+' puan';
    if(list.children[index]!==card.item)list.insertBefore(card.item,list.children[index]||null);
   });
   while(list.children.length>players.length)list.lastElementChild.remove();
   rosterKey=displayKey;
   window.KEKIPPortraits?.refresh?.();
  }
  refreshStart(data);
  $('arenaInvite').hidden=data.party||data.phase!=='lobby';
  if(entering){status('');$('arenaRoomTitle').focus();}
  lastResults.hidden=data.phase!=='lobby'||!data.results;
  if(data.phase==='final'){
   showResults(data.results);
   if(previousPhase!=='final'){
    results.scrollIntoView({block:'start'});
    resultsTitle.focus({preventScroll:true});
   }
  }else if(previousPhase==='final'||data.phase!=='lobby'){
   hideResults();
   if(previousPhase==='final'&&!document.querySelector('dialog[open]')){
    $('arenaRoomTitle').scrollIntoView({block:'start'});
    $('arenaRoomTitle').focus({preventScroll:true});
   }
  }
  if(data.cardMatchId)cardQueue.add(data.cardMatchId);
  showCards();
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
 gameOptions.onchange=()=>run(async()=>{
  if(!current||savingGames)return;
  const games=[...gameOptions.querySelectorAll('input:checked')].map(input=>input.value);
  if(!games.length){renderGamePicker(current);status('En az bir mini oyun seç.');return;}
  savingGames=true;picker.disabled=true;refreshStart(current);
  try{await emit('games',{games});status('');}
  catch(error){if(current)renderGamePicker(current);throw error;}
  finally{savingGames=false;picker.disabled=false;if(current)refreshStart(current);}
 });
 $('arenaStart').onclick=()=>run(()=>emit('start'));
 $('arenaLeave').onclick=()=>run(async()=>{
  await emit('leave');hideResults();renderedResult=null;cardQueue.clear();current=null;press=null;sending=false;cueKey='';room.hidden=true;room.dataset.code='';$('arenaEntry').hidden=false;create.querySelector('button').focus();
 });
 $('arenaInvite').onclick=()=>run(async()=>{
  const link=new URL('/arena.html',location.origin);link.searchParams.set('room',current.code);
  await navigator.clipboard.writeText(link.toString());status('Davet bağlantısı kopyalandı.');
 });
 setInterval(()=>renderStage(serverNow()),100);
 socket.connect();
})();
