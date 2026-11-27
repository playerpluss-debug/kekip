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
 let reflexLitAt=null;
 const timing=$('arenaTiming'),timingStop=$('arenaTimingStop'),timingLabel=$('arenaTimingLabel'),timingTarget=$('arenaTimingTarget'),timingClock=$('arenaTimingClock');
 const timingClockVisibleMs=1500,timingClockFadeMs=450;
 const seconds=(ms,digits=2)=>(ms/1000).toFixed(digits).replace('.',',')+' sn';
 const picker=$('arenaGamePicker'),gameOptions=$('arenaGameOptions');
 let savingGames=false,catalogKey='';
 const colors=$('arenaColors'),colorButtons=[...colors.querySelectorAll('button')];
 const length=$('arenaLength'),sample=$('arenaLengthSample'),lengthChoices=$('arenaLengthChoices');
 const cups=$('arenaCups'),cupBall=$('arenaCupBall'),cupButtons=[...cups.querySelectorAll('button')];
 let lengthKey='';
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
 function bar(width){
  const model=node('span','');model.className='arena-length-model';model.style.setProperty('--arena-bar-length',width+'%');model.setAttribute('aria-hidden','true');
  for(const face of ['front','top','cap']){
   const surface=node('i','');surface.className='arena-length-'+face;model.append(surface);
  }
  return model;
 }
 function paintLengths({target,lengths,disabled,choice,answer,wrong}){
  length.hidden=!Number.isFinite(target)&&!lengths;
  sample.hidden=!Number.isFinite(target);lengthChoices.hidden=!lengths;
  const key=JSON.stringify([target,lengths]);
  if(key!==lengthKey){
   lengthKey=key;
   sample.replaceChildren(...(Number.isFinite(target)?[bar(target)]:[]));
   lengthChoices.replaceChildren(...(lengths||[]).map((width,index)=>{
    const button=node('button','');button.type='button';button.className='arena-length-track';
    button.setAttribute('aria-label',(index+1)+'. çubuk');button.append(bar(width));
    button.onclick=()=>{if(!button.disabled)submit(index);};return button;
   }));
  }
  [...lengthChoices.children].forEach((button,index)=>{
   button.disabled=disabled;
   button.classList.toggle('selected',choice===index);
   button.classList.toggle('correct',answer===index);
   button.classList.toggle('wrong',wrong===index);
  });
 }
 function positionCups(challenge,t,reveal=null){
  const places=[0,1,2,3],lift=[0,0,0,0],depth=[2,2,2,2];
  let ball=reveal;
  if(challenge?.phase==='preview'){
   ball=challenge.ballSlot;lift[ball]=48;
  }else if(challenge?.phase==='mix'){
   const elapsed=t-challenge.mixStartsAt;
   if(elapsed<0){
    const cover=Math.max(1,challenge.mixStartsAt-challenge.coverStartsAt);
    const started=Math.max(0,1+elapsed/cover);
    lift[challenge.ballSlot]=48*(1-started);
    if(started<.82)ball=challenge.ballSlot;
   }else{
    let remaining=elapsed;
    for(const {from,to,duration,direction} of challenge.swaps){
     const first=places.indexOf(from),second=places.indexOf(to);
     if(remaining>=duration){
      places[first]=to;places[second]=from;remaining-=duration;continue;
     }
     const fraction=Math.max(0,remaining/duration),ease=fraction*fraction*(3-2*fraction);
     const arc=Math.sin(Math.PI*fraction)*27*direction;
     places[first]=from+(to-from)*ease;places[second]=to+(from-to)*ease;
     lift[first]=arc;lift[second]=-arc;depth[first]=direction>0?3:4;depth[second]=direction>0?4:3;
     break;
    }
   }
  }else if(reveal!==null)lift[reveal]=48;
  else if(challenge?.phase==='prepare')lift.fill(0);
  cupButtons.forEach((button,index)=>{
   button.style.left=(12.5+places[index]*25)+'%';
   button.style.setProperty('--cup-lift',-lift[index]+'px');
   button.style.zIndex=String(depth[index]);
  });
  cupBall.hidden=ball===null;
  if(ball!==null)cupBall.style.left=(12.5+ball*25)+'%';
 }
 function paintCups(challenge,t,{disabled,choice,answer=null}){
  cups.hidden=false;
  cups.classList.toggle('choosing',challenge?.phase==='lit'||answer!==null);
  cupButtons.forEach((button,index)=>{
   button.disabled=disabled;
   button.classList.toggle('selected',choice===index);
   button.classList.toggle('correct',answer===index);
  });
  positionCups(challenge,t,answer);
 }
 function paintTimingClock(challenge,t){
  const started=challenge?.startedAt;
  const elapsed=Number.isFinite(started)?Math.max(0,t-started):Infinity;
  const fade=Math.max(0,elapsed-timingClockVisibleMs)/timingClockFadeMs;
  timingClock.hidden=Boolean(press)||fade>=1||t>=challenge?.endsAt;
  if(timingClock.hidden)return false;
  const text=seconds(elapsed);
  if(timingClock.textContent!==text)timingClock.textContent=text;
  timingClock.style.opacity=String(1-fade);
  return true;
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
  reflex.hidden=!challenge||game!=='reflex';
  if(game!=='color')colors.hidden=true;
  if(game!=='length')length.hidden=true;
  if(game!=='cups')cups.hidden=true;
  if(game!=='timing')timing.hidden=true;
  if(!challenge){
   clock.textContent=current.deadline?Math.max(0,Math.ceil((current.deadline-t)/1000))+' sn':'';
   update(title,'Tur '+number+' sonuçları');
   if(game==='color'){
    const own=current.players.find(player=>player.username===current.you)?.reaction;
    const answer=current.colorAnswer;
    paintColors(answer?.colors,{disabled:true,choice:own?.choice,answer:answer?.odd});
    const result=own?.kind==='hit'?'Doğru cevap · '+own.points+' puan':own?.kind==='wrong'?'Yanlış cevap · 0 puan':'Cevap verilmedi · 0 puan';
    update(prompt,result+(answer?' · Farklı renk '+(answer.odd+1)+'. dairedeydi.':''));
   }else if(game==='length'){
    const own=current.players.find(player=>player.username===current.you)?.reaction,answer=current.lengthAnswer;
    paintLengths({lengths:answer?.lengths,disabled:true,choice:own?.choice,answer:answer?.odd,
     wrong:own?.kind==='wrong'?own.choice:undefined});
    const result=own?.kind==='hit'?'Doğru cevap · '+own.points+' puan':own?.kind==='wrong'?'Yanlış cevap · 0 puan':'Cevap verilmedi · 0 puan';
    update(prompt,result+(answer?' · Doğru çubuk '+(answer.odd+1)+'. sıradaydı.':''));
   }else if(game==='cups'){
    const own=current.players.find(player=>player.username===current.you)?.reaction;
    const answer=current.cupsAnswer;
    paintCups(null,t,{disabled:true,choice:own?.choice,answer});
    const result=own?.kind==='hit'?'Doğru cevap · '+own.points+' puan':own?.kind==='wrong'?'Yanlış cevap · 0 puan':'Cevap verilmedi · 0 puan';
    update(prompt,result+(answer===null?'':' · Top '+(answer+1)+'. bardağın altındaydı.'));
   }else if(game==='timing'){
    timing.hidden=false;timingClock.hidden=true;timingStop.disabled=true;timingStop.dataset.state='result';
    const own=current.players.find(player=>player.username===current.you)?.reaction;
    update(timingTarget,seconds(current.timingTarget,3));
    update(timingLabel,own?.kind==='hit'?seconds(own.ms,3):'Süre doldu');
    update(prompt,own?.kind==='hit'?'Hedeften '+seconds(own.errorMs,3)+' fark · '+own.points+' puan':'Cevap verilmedi · 0 puan');
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
  if(game==='length'){
   const preview=challenge.phase==='preview';
   const deadline=preview?challenge.previewEndsAt:lit?challenge.endsAt:challenge.startsAt;
   clock.textContent=Math.max(0,Math.ceil((deadline-t)/1000))+' sn';
   paintLengths({target:challenge.target,lengths:challenge.lengths,
    disabled:!lit||expired||Boolean(press)||sending||!socket.connected,choice:press?.choice,
    wrong:press?.wrong?press.choice:undefined});
   update(prompt,press?.wrong?'Yanlış cevap · 0 puan':press?'Seçimin kaydedildi.':expired?'Süre doldu.':preview?'Örnek çubuğun boyunu aklında tut.':lit?'Örnekle aynı boydaki çubuğu seç.':'Tur başlıyor.');
   return;
  }
  if(game==='cups'){
   const preview=challenge.phase==='preview',mixing=challenge.phase==='mix';
   clock.textContent=lit?Math.max(0,Math.ceil((challenge.endsAt-t)/1000))+' sn':!ready?Math.max(0,Math.ceil((challenge.startsAt-t)/1000))+' sn':'';
   paintCups(challenge,t,{disabled:!lit||expired||Boolean(press)||sending||!socket.connected,choice:press?.choice});
   update(prompt,press?'Seçimin kaydedildi.':expired?'Süre doldu.':preview?'Topun yerini aklında tut.':mixing?'Topu kapatan bardağı takip et.':lit?'Top hangi bardağın altında?':'Tur başlıyor.');
   return;
  }
  if(game==='timing'){
   const preview=challenge.phase==='preview';
   timing.hidden=!Number.isFinite(challenge.targetMs);
   paintTimingClock(challenge,t);
   if(!timing.hidden)update(timingTarget,seconds(challenge.targetMs));
   clock.textContent=preview?Math.max(0,Math.ceil((challenge.previewEndsAt-t)/1000))+' sn':'';
   timingStop.disabled=!lit||expired||Boolean(press)||sending||!socket.connected;
   timingStop.dataset.state=press?'result':lit&&!expired?'running':'waiting';
   update(timingLabel,press?seconds(press.ms,3):expired?'Süre doldu':lit?'Durdur':'Hazırlan');
   update(prompt,press?'Hedeften '+seconds(press.errorMs,3)+' fark.':expired?'Sonraki turu bekle.':preview?'Hedef süreyi aklında tut.':lit?'Hedef süre geçtiğinde durdur.':'Tur başlıyor.');
   const key=current.code+':'+number;
   if(lit&&!expired&&!press&&cueKey!==key){cueKey=key;tone(700,.13);}
   return;
  }
  clock.textContent=!ready?Math.max(0,Math.ceil((challenge.startsAt-t)/1000))+' sn':'';
  const reflexState=press?(press.kind==='hit'?'hit':'early'):lit&&!expired?'lit':'waiting';
  if(reflexState==='lit'&&reflexLitAt===null)reflexLitAt=performance.now();
  reflex.dataset.state=reflexState;
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
 async function submit(choice,reactionMs){
  if(sending||press||!current?.challenge)return;
  const {code,number}=current;
  const sameRound=()=>current?.code===code&&current.number===number;
  sending=true;renderStage(serverNow());
  try{
   const result=await emit('action',{round:number,choice,reactionMs});
   if(sameRound()){
    press=result.press;
    tone(press.kind==='early'?170:520,.15);
   }
  }catch(error){if(sameRound())status(error.message);}
  finally{if(sameRound()){sending=false;renderStage(serverNow());}}
 }
 reflex.onclick=event=>{
  if(reflex.disabled)return;
  const now=performance.now();
  const clickedAt=event.timeStamp>0&&event.timeStamp<=now?event.timeStamp:now;
  const reactionMs=reflexLitAt===null||clickedAt<reflexLitAt?null:Math.round(clickedAt-reflexLitAt);
  submit(undefined,reactionMs);
 };
 timingStop.onpointerdown=event=>{if(event.isPrimary&&event.button===0&&!timingStop.disabled)submit();};
 timingStop.onclick=()=>{if(!timingStop.disabled)submit();};
 for(const buttons of [colorButtons,cupButtons])buttons.forEach((button,index)=>{button.onclick=()=>{if(!button.disabled)submit(index);};});
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
   const hasReflex=result.games.includes('reflex'),hasChoice=result.games.some(game=>game!=='reflex');
   const parts=[player.hits+(hasReflex&&hasChoice?' başarılı':hasChoice?' doğru':' tepki')];
   if(hasChoice)parts.push(player.wrong+' yanlış');
   if(hasReflex)parts.push(player.early+' erken');
   parts.push(player.missed+' kaçan');
   const detail=node('small',parts.join(' · ')+
     (player.fastest===null?'':' · En hızlı '+player.fastest+' ms')+
     (player.bestError===null?'':' · En az sapma '+seconds(player.bestError,3)));
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
  if(newRound||current?.code!==data.code)reflexLitAt=null;
  if(data.challenge?.press)press=data.challenge.press;
  offset=data.serverTime-Date.now();
  current=data;room.dataset.code=data.code;room.dataset.phase=data.phase;room.hidden=false;$('arenaEntry').hidden=true;
  stage.hidden=data.phase==='lobby'||data.phase==='final';$('arenaRoomTitle').textContent='Arena lobisi · '+data.code;
  renderGamePicker(data);
  $('arenaRoomInfo').textContent=data.players.length+'/8 oyuncu · '+(data.game?gameTitle(data.game):data.settings.games.map(gameTitle).join(' · '));
  const players=[...data.players].sort((a,b)=>b.total-a.total||a.username.localeCompare(b.username));
  const roster=$('arenaPlayers'),inGame=data.phase==='round'||data.phase==='summary';
  const rosterTarget=$(inGame?'arenaInGameRoster':'arenaLobbyRoster');
  if(roster.parentElement!==rosterTarget)rosterTarget.append(roster);
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
     const name=node('strong',''),score=node('span',''),answered=node('span','');
     answered.className='arena-answered';answered.hidden=true;
     const icon=node('i','✓');icon.setAttribute('aria-hidden','true');answered.append(icon,document.createTextNode('Cevap verildi'));
     info.append(name,score,answered);item.append(portrait,info);
     card={item,name,score,answered};playerCards.set(player.username,card);
    }
    card.answered.hidden=!player.answered;
    card.name.textContent='@'+player.username+(player.online?'':' · Çevrimdışı');
    const last=player.reaction;
    const reaction=last?.kind==='hit'?(data.game==='timing'?seconds(last.ms,3):last.ms+' ms'):last?.kind==='early'?'Erken tıklama':last?.kind==='wrong'?'Yanlış cevap':'Süre doldu';
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
 let stageFrame=0;
 function animateStage(){
  const challenge=current?.challenge,t=serverNow();
  const mixing=challenge?.game==='cups'&&challenge.phase==='mix';
  if(mixing)positionCups(challenge,t);
  const ticking=challenge?.game==='timing'&&paintTimingClock(challenge,t);
  stageFrame=mixing||ticking?requestAnimationFrame(animateStage):0;
 }
 setInterval(()=>{
  renderStage(serverNow());
  if(!stageFrame&&(current?.challenge?.game==='cups'&&current.challenge.phase==='mix'||
      current?.challenge?.game==='timing'&&!timingClock.hidden))stageFrame=requestAnimationFrame(animateStage);
 },100);
 socket.connect();
})();
