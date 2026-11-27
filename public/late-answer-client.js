'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const socket=io('/late-answer');
  const cards=new Map();
  const codePattern=/^[A-Z2-9]{5}$/;
  const params=new URLSearchParams(location.search);
  const invite=params.get('room')?.toUpperCase();
  const partyRoom=params.get('partyRoom');
  const storageKey='kekip.late-answer.room';
  const readRoom=()=>{try{return sessionStorage.getItem(storageKey)}catch{return null}};
  const remember=code=>{try{if(code)sessionStorage.setItem(storageKey,code);else sessionStorage.removeItem(storageKey)}catch{}};
  const node=(tag,content)=>{const el=document.createElement(tag);if(content)el.textContent=content;return el};
  const text=(id,value)=>{const n=$(id);if(n.textContent!==value)n.textContent=value};
  const emit=(event,data={})=>new Promise((resolve,reject)=>{
    socket.timeout(5000).emit('late:'+event,data,(error,result)=>{
      if(error||!result?.ok)reject(new Error(result?.error||'Sunucuya ulaşılamadı.'));
      else resolve(result);
    });
  });
  const voice=new window.LateAnswerVoice(
    (to,kind,data)=>emit('signal',{to,kind,...data}).catch(()=>{}),
    status=>text('voiceStatus',status),
    (name,speaking)=>{const card=cards.get(name);if(card)card.dataset.speaking=String(speaking)}
  );
  let state=null, config=null, offset=0, sequence=-1, announced=null, pending=false, microphonePending=false, microphoneEpoch=0, lastSettings='';
  const note=message=>text('notice',message);
  const settings=form=>({visibility:form.elements.visibility.value});
  window.KEKIPLateAnswer={
    room(){return state&&socket.connected?{game:'late_answer',code:state.code}:null},
    lobby(){return state?.phase==='lobby'&&state.players.length<8?this.room():null}
  };
  function entryEnabled(enabled) {
    for(const b of $('entry').querySelectorAll('button'))b.disabled=!enabled;
  }
  function setConnected(value){
    entryEnabled(value&&!pending);
    if(!value) $('timer').textContent='Bağlantı bekleniyor';
  }
  async function run(fn){
    if(pending||!socket.connected)return;
    pending=true;entryEnabled(false);
    try{note('');await fn();}
    catch(error){note(error.message);}
    finally{pending=false;entryEnabled(socket.connected);}
  }
  async function publicRooms(){
    const result=await emit('list');
    $('publicRooms').replaceChildren(...result.rooms.map(r=>{
      const row=node('div');row.className='row';
      row.append(node('span','@'+r.host+' · '+r.players+'/8 · 60 sn / oyuncu'));
      const button=node('button','Katıl');button.type='button';button.onclick=()=>run(()=>enter('join',{code:r.code}));row.append(button);
      return row;
    }));
    if(!result.rooms.length)$('publicRooms').append(node('p','Şu anda açık oda yok.'));
  }
  async function enter(event,data){
    const result=await emit(event,data);
    remember(result.code);
    if(params.has('partyRoom')){params.delete('partyRoom');const url=new URL(location.href);url.search=params.toString();history.replaceState(history.state,'',url);}
    config=result.voice;
    $('voiceNetwork').hidden=false;
    text('voiceNetwork',config?.hasTurn===true?'TURN yapılandırıldı. Gerekirse ses rölesi kullanılabilir.':'TURN yapılandırılmadı. Oyun doğrudan ses bağlantısı kurmayı dener.');
    if(state){voice.initialize(state.me,config);voice.sync(state.players);}
    if(voice.track&&!voice.muted)voice.onMicrophone(true);
  }
  function clearRoom(){
    remember(null);state=null;config=null;$('voiceNetwork').hidden=true;sequence=-1;lastSettings='';microphoneEpoch++;
    voice.stop();voice.onMicrophone?.(false);cards.clear();$('players').replaceChildren();
    $('room').hidden=true;$('entry').hidden=false;
    $('roomCode').focus();
    if(socket.connected)publicRooms().catch(()=>{});
  }
  function playerCard(p){
    const card=node('li');card.className='player';
    const actor=node('div');actor.className='actor';
    const portrait=node('div',p.username.slice(0,2).toUpperCase());portrait.className='late-portrait';
    portrait.dataset.kpAvatar=p.username;portrait.dataset.kpAvatarMode='body';portrait.setAttribute('aria-hidden','true');
    const podium=node('span');
    podium.className='studio-podium';
    podium.setAttribute('aria-hidden','true');
    actor.append(podium,portrait);
    const role=node('span');role.className='seat-role';role.hidden=true;
    const name=node('strong','@'+p.username), status=node('small');
    status.className='player-status';
    const controls=node('div');controls.className='voice-controls';
    const label=node('label','Ses ');
    const range=node('input');range.type='range';range.min='0';range.max='100';range.value=String((voice.volumes.get(p.username)??1)*100);
    range.setAttribute('aria-label','@'+p.username+' ses seviyesi');
    range.oninput=()=>voice.volume(p.username,Number(range.value)/100);label.append(range);
    const mute=node('button',voice.mutes.has(p.username)?'Sesi aç':'Sustur');mute.type='button';
    mute.setAttribute('aria-label','@'+p.username+' sesini sustur');mute.setAttribute('aria-pressed',String(voice.mutes.has(p.username)));
    mute.onclick=()=>{const muted=!voice.mutes.has(p.username);voice.mutePeer(p.username,muted);mute.textContent=muted?'Sesi aç':'Sustur';mute.setAttribute('aria-pressed',String(muted));};
    controls.append(label,mute);
    const kick=node('button','Odadan çıkar');kick.type='button';
    kick.setAttribute('aria-label','@'+p.username+' oyuncusunu odadan çıkar');
    kick.onclick=()=>{if(confirm('@'+p.username+' odadan çıkarılsın mı?'))run(()=>emit('kick',{username:p.username}));};
    const identity=node('div');identity.className='seat-identity';identity.append(name,role);
    card.append(actor,identity,status,controls,kick);
    card.parts={status,controls,kick,role};
    return card;
  }
  function paintPlayers(){
    const sorted=state.phase==='final'?[...state.players].sort((a,b)=>Number(b.complete)-Number(a.complete)||(a.rank??Infinity)-(b.rank??Infinity)||b.correct-a.correct):state.players;
    for(const [name,card] of cards)if(!sorted.some(p=>p.username===name)){cards.delete(name);card.remove();}
    let i=0;
    for(const p of sorted){
      let card=cards.get(p.username);
      if(!card){card=playerCard(p);cards.set(p.username,card);}
      const onStage=['turn_ready','intro','answer'].includes(state.phase)&&!p.left;
      const contestant=onStage&&p.username===state.contestant;
      card.dataset.contestant=String(contestant);
      const reading=onStage&&p.username===state.reader;
      card.dataset.jury=String(reading);
      card.dataset.seat=String(i);
      card.parts.role.hidden=!contestant&&!reading;
      const role=contestant?'Yarışmacı':'Soru okuyan';
      if(card.parts.role.textContent!==role)card.parts.role.textContent=role;
      card.dataset.online=String(p.online);
      const status=p.left?'Ayrıldı':!p.online?'Bağlantı bekleniyor':p.win?'Kazanan':state.phase==='lobby'?(p.ready?'Hazır':'Hazırlanıyor'):(p.microphone?'Mikrofon açık':'Mikrofon kapalı');
      const points=state.phase==='final'?' · '+(p.rank?p.rank+'. sıra · ':'')+p.score+' puan':'';
      const line=status+(state.phase==='lobby'?'':' · '+p.correct+' doğru')+points+(p.username===state.host?' · Oda sahibi':'');
      if(card.parts.status.textContent!==line)card.parts.status.textContent=line;
      card.parts.controls.hidden=p.username===state.me||!p.online;
      card.parts.kick.hidden=state.host!==state.me||p.username===state.me||p.left||state.phase==='final';
      if($('players').children[i]!==card)$('players').insertBefore(card,$('players').children[i]||null);
      i++;
    }
  }
  function paintQuestion(){
    const isContestant=state.contestant===state.me,isReader=state.reader===state.me;
    const playing=['intro','answer'].includes(state.phase),waiting=state.phase==='turn_ready';
    $('play').hidden=state.phase==='lobby';
    text('role',state.phase==='final'?'Maç sonucu':state.phase==='summary'?'Tur özeti':waiting?'Sıradaki tur':
      isContestant?'Yarışmacısın':isReader?'Soruyu sen okuyorsun':'İzliyorsun');
    text('questionMeta',state.phase==='final'?'':state.turn+' / '+state.turns+' tur'+(state.category?' · '+state.category:''));
    text('prompt',state.phase==='final'?'Final sıralaması':state.phase==='summary'?(state.last?.kind==='cancelled'?'Tur iptal edildi':'Tur tamamlandı'):
      waiting?'Sıra @'+state.contestant+' oyuncusunda':(state.question??'Soru hazırlanıyor'));
    let instruction='';
    if(waiting)instruction=isContestant?'Hazır olduğunda Hazırım düğmesine bas. 60 saniyen başlayacak.':
       '@'+state.contestant+' hazır olduğunda tur başlayacak. Soruları @'+state.reader+' okuyacak.';
    if(state.phase==='intro')instruction=isReader?'İlk soruyu sesli oku, ardından İlk soruyu okudum’a bas.':
       'İlk soruyu aklında tut. Henüz cevap verme.';
    if(state.phase==='answer')instruction=isContestant?'Bir önceki sorunun cevabını sesli söyle.':
       isReader?'Tahtadaki yeni soruyu sesli oku. Önceki cevap doğruysa Doğru’ya bas.':
       '@'+state.reader+' soruları okuyor ve cevapları değerlendiriyor.';
    if(playing&&state.pausedFor)instruction=state.pausedFor==='reader'?'Soruyu okuyan oyuncunun bağlantısı bekleniyor.':'Yarışmacının bağlantısı bekleniyor.';
    if(state.phase==='final')instruction=state.persisted?'Sıralama 60 saniyedeki doğru cevap sayısına göre hesaplandı.':
       state.savingError?'Sonuç kaydedilemedi. Sunucu tekrar deniyor.':'Sonuç kaydediliyor…';
    text('instruction',instruction);
    const readerAnswer=isReader&&state.phase==='answer'?state.answers?.join(' / '):'';
    $('answer').hidden=!readerAnswer;
    text('answer',readerAnswer||'');
    $('votes').hidden=!playing||!isReader;
    $('no').hidden=state.phase==='intro';
    text('yes',state.phase==='intro'?'İlk soruyu okudum':'Doğru');
    const disabled=!state.deadline||Date.now()+offset>=state.deadline;
    $('yes').disabled=disabled;$('no').disabled=disabled;
    const last=state.last;
    text('lastResult',state.phase==='final'||!last?'':last.kind==='cancelled'?'Bu turdaki doğru cevaplar geri alındı.':
      last.kind==='turn'?last.correct+' doğru cevap':last.correct?'Önceki cevap doğru.':'Önceki cevap geçildi.');
    $('turnReady').hidden=!waiting||!isContestant;
    $('turnReady').disabled=!socket.connected;
    $('rematch').hidden=state.phase!=='final'||state.host!==state.me;
    $('rematch').disabled=!state.persisted;
  }
  function receive(next){
    const joined=!state, previous=state?.phase, oldCode=state?.code;
    state=next;offset=next.now-Date.now();
    remember(next.code);
    if(oldCode&&oldCode!==next.code)note('Yeni soru havuzu için oda kodu yenilendi.');
    $('entry').hidden=true;$('room').hidden=false;
    const lobby=next.phase==='lobby', host=next.host===next.me, me=next.players.find(p=>p.username===next.me);
    $('gameStudio').dataset.active=String(!lobby);
    $('gameStudio').dataset.phase=next.phase;
    $('players').dataset.count=String(next.players.length);
    $('lobbyActions').hidden=!lobby;$('settingsForm').hidden=!lobby||!host;$('inviteAnchor').hidden=!lobby;
    text('roomTitle','Oda '+next.code);
    text('roomInfo',next.players.filter(p=>!p.left).length+'/8 oyuncu · 60 sn / oyuncu · '+(next.settings.visibility==='public'?'Açık':'Özel'));
    const key=JSON.stringify(next.settings);
    if(key!==lastSettings){lastSettings=key;for(const [name,value] of Object.entries(next.settings))$('settingsForm').elements[name].value=String(value);}
    text('ready',me?.ready?'Hazır değilim':'Hazırım');
    $('start').hidden=!host;$('start').disabled=next.players.length<3||next.players.some(p=>!p.ready||!p.online);
    paintQuestion();paintPlayers();
    if(config){voice.initialize(next.me,config);voice.sync(next.players);}
    if(joined)$('roomTitle').focus();
    else if(previous!==next.phase&&['turn_ready','intro','summary','final'].includes(next.phase)) {
      const selected=document.activeElement;
      if(next.phase==='turn_ready'&&!$('turnReady').hidden)$('turnReady').focus();
      else if(selected===document.body||selected=== $('yes')||selected===$('no')||selected===$('start')||selected===$('turnReady'))$('prompt').focus();
    }
    if(sequence!==next.sequence||previous!==next.phase){sequence=next.sequence;announced=null;}
    countdown();
  }
  function countdown(){
    if(!state||!socket.connected)return;
    const remaining=state.deadline===null?null:Math.max(0,Math.ceil((state.deadline-Date.now()-offset)/1000));
    text('timer',remaining==null?'':remaining+' sn');
    const board=$('play');
    board.dataset.urgent=String(state.phase==='answer'&&remaining!==null&&remaining<=3);
    if(remaining===0&&['intro','answer'].includes(state.phase)){$('yes').disabled=true;$('no').disabled=true;}
    if(remaining!==null&&remaining!==announced&&[10,5,3,0].includes(remaining)){
      announced=remaining;text('timerLive',remaining===0?'Süre doldu.':remaining+' saniye kaldı.');
    }
  }
  socket.on('connect',()=>{
    setConnected(true);note('');const saved=params.has('partyRoom')?partyRoom:readRoom();
    if(saved&&codePattern.test(saved))enter('resume',{code:saved}).catch(()=>{clearRoom();note('Önceki odaya yeniden bağlanılamadı.');});
    else publicRooms().catch(e=>note(e.message));
  });
  socket.on('connect_error',e=>{setConnected(false);note(e.message==='Bu oyun için KEKIP hesabına giriş yap.'?e.message:'Sunucu bağlantısı kurulamadı.');});
  socket.on('disconnect',()=>{voice.disconnect();setConnected(false);note('Bağlantı kesildi. Yeniden bağlanılıyor…');});
  socket.on('late:state',receive);
  socket.on('late:signal',d=>voice.receive(d));
  socket.on('late:left',d=>{clearRoom();setConnected(socket.connected);note(d.reason);});
  socket.on('late:recorded',d=>window.dispatchEvent(new CustomEvent('kekip:match-cards-ready',{detail:{game:'late_answer',matchId:d.matchId}})));
  $('createForm').onsubmit=e=>{e.preventDefault();run(()=>enter('create',settings(e.currentTarget)));};
  $('joinForm').onsubmit=e=>{e.preventDefault();run(()=>enter('join',{code:$('roomCode').value.trim().toUpperCase()}));};
  $('refresh').onclick=()=>run(publicRooms);
  $('settingsForm').onsubmit=e=>{e.preventDefault();run(()=>emit('settings',settings(e.currentTarget)));};
  $('leave').onclick=()=>{if(state&&(['lobby','final'].includes(state.phase)||confirm('Şimdi ayrılırsan bu maçın ödüllerini alamazsın. Ayrıl?')))run(()=>emit('leave'));};
  $('ready').onclick=()=>run(()=>emit('ready',{ready:!state?.players.find(p=>p.username===state.me)?.ready}));
  $('start').onclick=()=>run(()=>emit('start'));
  $('rematch').onclick=()=>run(()=>emit('rematch'));
  $('turnReady').onclick=()=>run(()=>emit('turn-ready',{sequence:state.sequence}));
  for(const [id,correct] of [['yes',true],['no',false]])$(id).onclick=()=>run(()=>emit('vote',{correct,sequence:state.sequence}));
  $('copyInvite').onclick=async()=>{const url=new URL('/late-answer.html',location.origin);url.searchParams.set('room',state.code);try{await navigator.clipboard.writeText(url.href);note('Davet bağlantısı kopyalandı.');}catch{note('Oda kodunu paylaş: '+state.code);}};
  voice.onMicrophone=enabled=>{
    $('microphone').setAttribute('aria-pressed',String(enabled));text('microphone',enabled?'Mikrofonu kapat':'Mikrofonu aç');
    if(state&&socket.connected)emit('microphone',{enabled}).catch(e=>text('voiceStatus',e.message));
  };
  $('microphone').onclick=async()=>{
    if(microphonePending)return;
    microphonePending=true;
    const epoch=microphoneEpoch;
    try{if(voice.muted)await voice.microphone();else voice.setMuted(true);}
    catch(e){
      if(epoch!==microphoneEpoch)return;
      const errors={NotAllowedError:'Mikrofon izni verilmedi. Tarayıcı izinlerinden yeniden açabilir veya dinleyici kalabilirsin.',NotFoundError:'Mikrofon bulunamadı.',NotReadableError:'Mikrofon kullanımda veya erişilemiyor.'};
      text('voiceStatus',errors[e.name]||e.message);
    }finally{if(epoch!==microphoneEpoch&&!state)voice.stop();microphonePending=false;}
  };
  $('listen').onclick=()=>voice.unlock().catch(()=>text('voiceStatus','Ses oynatma başlatılamadı.'));
  $('deaf').onclick=()=>{voice.setDeaf(!voice.deaf);$('deaf').setAttribute('aria-pressed',String(voice.deaf));text('deaf',voice.deaf?'Herkesin sesini aç':'Herkesi sustur');};
  document.addEventListener('visibilitychange',()=>{
    document.documentElement.dataset.pageHidden=String(document.hidden);
    if(!document.hidden&&state&&socket.connected)emit('sync').then(r=>receive(r.state)).catch(e=>note(e.message));
  });
  if(invite&&codePattern.test(invite))$('roomCode').value=invite;
  setInterval(countdown,150);
})();
