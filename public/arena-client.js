'use strict';
(()=>{
 const $=id=>document.getElementById(id);
 const create=$('arenaCreate'),join=$('arenaJoin'),room=$('arenaRoom'),stage=$('arenaStage');
 const titles={
  lock:'Kilit Hattı',route:'Hayalet Rota',reaction:'Tepki Protokolü',color:'Renk Şifresi',
  rhythm:'Nabız Dizisi',missing:'Eksik Parça',orbit:'Yörünge Atışı',circuit:'Devre Hattı',
  words:'İpucu Zinciri','co-op':'Çift Kumanda',vault:'Kasa Kararı',move:'Son Hamle'
 };
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
  if(key==='answer')button.dataset.roundAnswer='';
  if(color){button.className='arena-tile';button.dataset.color=color.toLocaleLowerCase('tr');}
  button.onclick=async()=>{
   const number=current.number;
   if(submitted.has(key))return;
   submitted.add(key);button.disabled=true;
   try{
    await emit('action',{round:number,input:typeof input==='function'?input():input});
    if(key==='answer'&&current?.number===number)for(const option of $('arenaMoves').querySelectorAll('[data-round-answer]'))option.disabled=true;
   }catch(error){
    if(current?.number===number){submitted.delete(key);button.disabled=false;status(error.message);}
   }
  };
  return button;
 }
 function choiceGrid(count,render){
  const grid=node('div','');grid.className='arena-choice-grid';
  for(let i=0;i<count;i++)grid.append(render(i));
  return grid;
 }
 function tip(parent,message){parent.append(node('p',message));}
 function buildExtra(game,prompt,moves){
  const data=game.prompt;
  if(game.id==='lock'){
   tip(prompt,'Gösterge hedef aralığına gelince etkin kilidi durdur.');
   const meter=node('div','');meter.className='arena-lock-meter';meter.setAttribute('aria-hidden','true');
   const target=node('i',''),cursor=node('b','');
   target.id='arenaLockTarget';cursor.id='arenaLockCursor';meter.append(target,cursor);prompt.append(meter);
   data.targets.forEach((_,index)=>{const button=action((index+1)+'. kilidi durdur',index);button.dataset.lock=index;moves.append(button);});
  }else if(game.id==='route'){
   tip(prompt,data.path?'Işıkların numara sırasını hatırla.':'Panoyu saat yönünde '+data.turns*90+'° döndürülmüş düşün. Yeni sırayı gir.');
   const picked=[];
   const grid=choiceGrid(9,index=>{
    const button=node('button',data.path?.includes(index)?String(data.path.indexOf(index)+1):'·');
    button.type='button';button.setAttribute('aria-label',(Math.floor(index/3)+1)+'. sıra, '+(index%3+1)+'. sütun');
    if(data.path){button.disabled=true;button.classList.toggle('lit',data.path.includes(index));}
    else button.onclick=()=>{
     if(picked.length>=data.length||picked.includes(index)||submitted.has('answer'))return;
     picked.push(index);button.textContent=String(picked.length);button.classList.add('lit');send.disabled=picked.length!==data.length;
    };
    return button;
   });
   moves.append(grid);
   if(data.path)return;
   const send=action('Rotayı gönder',()=>[...picked],'answer');send.disabled=true;
   const reset=node('button','Temizle');reset.type='button';
   reset.onclick=()=>{
    if(submitted.has('answer'))return;
    picked.length=0;send.disabled=true;
    for(const button of grid.children){button.classList.remove('lit');button.textContent='·';}
   };
   moves.append(send,reset);
  }else if(game.id==='rhythm'){
   tip(prompt,'Dört ışık vuruşunu izle. Işıklar sönünce ritmi aynı aralıkla üç kez sürdür.');
   const light=node('span','Ritim ışığı');light.id='arenaBeat';prompt.append(light);
   for(let index=0;index<3;index++){const button=action((index+1)+'. vuruş',index);button.dataset.beat=index;moves.append(button);}
  }else if(game.id==='orbit'){
   tip(prompt,'Hedef '+data.target+' m. Engel '+data.wall+' m uzaklıkta ve '+data.height+' m yüksekliğinde.');
   const controls=node('div','');controls.className='arena-fields';
   const field=(label,values)=>
    {const wrap=node('label',label),select=document.createElement('select');for(const [value,text] of values){const option=node('option',text);option.value=value;select.append(option);}wrap.append(select);controls.append(wrap);return select;};
   const angle=field('Atış açısı',Array.from({length:9},(_,i)=>[i+1,(i+1)*10+'°']));
   const power=field('Atış gücü',Array.from({length:10},(_,i)=>[i+1,String(i+1)]));
   angle.value='4';power.value='6';prompt.append(controls);
   moves.append(action('Enerji topunu fırlat',()=>[Number(angle.value),Number(power.value)],'answer'));
  }else if(game.id==='circuit'){
   const wires=new Set();
   tip(prompt,data.source+' kaynağından '+data.targets.join(' ve ')+' çıkışlarına en fazla '+data.budget+' bağlantıyla enerji götür.');
   for(const [index,wire] of data.links.entries()){
    const button=node('button',wire.split('').join(' ↔ '));button.type='button';button.setAttribute('aria-pressed','false');
    button.onclick=()=>{
     if(submitted.has('answer'))return;
     if(wires.has(index))wires.delete(index);
     else if(wires.size<data.budget)wires.add(index);
     button.setAttribute('aria-pressed',String(wires.has(index)));
    };
    moves.append(button);
   }
   moves.append(action('Devreyi çalıştır',()=>[...wires],'answer'));
  }else if(game.id==='co-op'){
   if(!data.options){tip(prompt,'Bu tur için eş bulunamadı.');return;}
   tip(prompt,(data.role==='direction'?'Yönü':'Hızı')+' sen seçiyorsun. Takım arkadaşına göndereceğin ipucu: '+data.hint+'.');
   if(data.received)tip(prompt,'Takım arkadaşının ipucu: '+data.received);
   moves.append(action('İpucunu eşime gönder','hint'));
   data.options.forEach((choice,index)=>moves.append(action(choice,index,'answer')));
  }else if(game.id==='vault'){
   if(data.decision){
    tip(prompt,'55 puanı kasaya koy veya bir görevle 100 puanı dene.');
    const risk=action('Riske gir','risk');risk.dataset.roundAnswer='';
    moves.append(action('55 puanı kasaya koy','bank','answer'),risk);
   }else{
    tip(prompt,'Şifre: '+data.base+' '+data.operator+' '+data.delta+' kaç eder?');
    for(const value of data.options)moves.append(action(String(value),value,'answer'));
   }
  }else if(game.id==='move'){
   tip(prompt,'Bir hedef seç. Aynı hedefi bir başkası da seçerse ikiniz de o hedeften puan alamazsınız.');
   data.tiles.forEach((tile,index)=>moves.append(action(tile.name+' · '+tile.value+' puan',index,'answer')));
  }
 }
 function animateExtra(game,t){
  if(!game?.prompt||t<game.startsAt)return;
  const {prompt}=game,elapsed=t-game.startsAt;
  if(game.id==='lock'){
   const active=Math.floor(elapsed/prompt.period),phase=(elapsed%prompt.period)/prompt.period;
   const marker=$('arenaLockTarget'),cursor=$('arenaLockCursor');
   if(marker&&cursor){
    marker.style.left=(prompt.targets[active]??100)+'%';
    cursor.style.left=(phase<.5?phase*200:(1-phase)*200)+'%';
   }
   for(const button of document.querySelectorAll('[data-lock]')){
    const index=Number(button.dataset.lock);button.disabled=index!==active||submitted.has(index)||!socket.connected;
   }
  }
  if(game.id==='rhythm'){
   const light=$('arenaBeat');
   if(light)light.classList.toggle('lit',elapsed<prompt.beat*prompt.previewBeats&&elapsed%prompt.beat<180);
   for(const button of document.querySelectorAll('[data-beat]')){
    const index=Number(button.dataset.beat);
    button.disabled=elapsed<prompt.beat*prompt.previewBeats||index!==submitted.size||!socket.connected;
   }
  }
 }
 function renderStage(t){
  if(!current||current.phase==='lobby')return;
  const game=current.challenge,phase=current.phase;
  const before=game&&(t<game.startsAt||!game.prompt);
  const key=JSON.stringify([current.number,phase,before,game?.prompt]);
  const remaining=before?game.startsAt-t:current.deadline-t;
  $('arenaClock').textContent=current.deadline?Math.max(0,Math.ceil(remaining/1000))+' sn':'';
  if(key===viewKey){animateExtra(game,t);return;}
  viewKey=key;
  const prompt=$('arenaPrompt'),moves=$('arenaMoves');
  prompt.replaceChildren();moves.replaceChildren();
  if(!game){
   const top=Math.max(...current.players.map(player=>player.total));
   const names=current.players.filter(player=>player.total===top).map(player=>'@'+player.username);
   $('arenaRoundTitle').textContent=phase==='final'?'Maç tamamlandı':'Tur sonuçları';
   prompt.append(node('p',current.cancelled?'Maç, yeterli oyuncu kalmadığı için sona erdi.':
    phase==='final'?(names.length>1?'Berabere · ':'Kazanan · ')+names.join(', '):'Puanlar güncellendi.'));
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
  }else buildExtra(game,prompt,moves);
  animateExtra(game,t);
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
