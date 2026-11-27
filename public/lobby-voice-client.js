'use strict';
(()=>{
 const root=document.querySelector('[data-lobby-voice]');
 if(!root||typeof window.io!=='function'||!window.LateAnswerVoice)return;
 const game=root.dataset.lobbyVoice;
 const listen=root.querySelector('[data-voice-listen]');
 const mic=root.querySelector('[data-voice-mic]');
 const status=root.querySelector('[data-voice-status]');
 const notice=text=>{status.textContent=text;};
 const socket=io('/lobby-voice',{autoConnect:false,reconnection:false});
 let active=false,busy=false,current=null,config=null,epoch=0;
 const voice=new window.LateAnswerVoice((to,kind,payload)=>{
  if(!active||!socket.connected)return Promise.resolve();
  return socket.timeout(6000).emitWithAck('voice:signal',{to,kind,...payload}).catch(()=>{});
 },text=>{if(text&&active)notice(text);},()=>{});
 function setMicrophone(on){
  mic.setAttribute('aria-pressed',String(on));
  mic.textContent=on?'Mikrofonu kapat':'Mikrofonu aç';
 }
 voice.onMicrophone=setMicrophone;
 function room(){
  if(game==='party')return root.closest('#party').hidden?null:'';
  if(game==='football'){
   const panel=root.closest('#onlinePanel');
   if(panel.hidden||panel.dataset.lobby!=='true'||root.closest('#onlineRoom').hidden)return null;
   const code=document.getElementById('onlineCode').textContent.trim();
   return /^[A-F0-9]{10}$/.test(code)?code:null;
  }
  if(!root.closest('#gameOverlay').classList.contains('show')||
    root.closest('#roomArea').classList.contains('game-hidden')||
    document.getElementById('playArea')?.classList.contains('game-hidden')===false)return null;
  const code=document.getElementById('roomCode').textContent.trim();
  return /^[A-Z2-9]{5}$/.test(code)?code:null;
 }
 function connectedText(){
  return config?.hasTurn?'Ses bağlantısı açık.':'Ses bağlantısı açık. Bu ağda TURN gerekebilir.';
 }
 function stop(message='Dinlemek için bağlan.'){
  epoch++;
  active=false;busy=false;current=null;config=null;
  socket.disconnect();
  voice.stop();
  setMicrophone(false);
  listen.disabled=false;mic.disabled=false;
  listen.textContent='Ses bağlantısını aç';
  notice(message);
 }
 function syncRoom(){
  const code=room();
  root.hidden=code===null;
  if((active||busy)&&code!==current)stop();
 }
 async function open(microphone){
  if(busy)return;
  if(active&&!microphone){stop();return;}
  if(microphone&&active&&!voice.muted){voice.setMuted(true);return;}
  const code=room();
  if(code===null)return;
  current=code;
  const attempt=++epoch;
  busy=true;listen.disabled=true;mic.disabled=true;
  try{
   if(!active){
    if(!window.RTCPeerConnection)throw Error('Bu tarayıcı lobi sesini desteklemiyor.');
    await voice.unlock();
    if(attempt!==epoch)return;
    notice('Ses bağlantısı kuruluyor…');
    if(!socket.connected){
     await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>done(Error('Ses sunucusuna ulaşılamadı.')),6500);
      const success=()=>done();
      const error=e=>done(e);
      const done=e=>{
       clearTimeout(timer);socket.off('connect',success);socket.off('connect_error',error);
       if(e)reject(e);else resolve();
      };
      socket.once('connect',success);socket.once('connect_error',error);socket.connect();
     });
    }
    if(attempt!==epoch)return;
    await new Promise((resolve,reject)=>{
     socket.timeout(6500).emit('voice:join',{game,code},(error,result)=>{
      if(error||!result?.ok)return reject(Error(result?.error||'Ses bağlantısı kurulamadı.'));
      if(attempt===epoch){
       active=true;config=result.config;voice.initialize(result.me,config);
       listen.textContent='Ses bağlantısını kapat';notice(connectedText());
      }
      resolve();
     });
    });
   }
   if(attempt!==epoch||!microphone)return;
   try{await voice.microphone();}
   catch{if(attempt===epoch)notice('Mikrofon açılamadı. Dinlemeye devam edebilirsin.');}
  }catch(error){if(attempt===epoch)stop(error.message);}
  finally{if(attempt===epoch){busy=false;listen.disabled=false;mic.disabled=false;}}
 }
 socket.on('voice:roster',players=>{if(active)voice.sync(players);});
 socket.on('voice:signal',signal=>{if(active)voice.receive(signal);});
 socket.on('voice:closed',message=>stop(message));
 socket.on('disconnect',()=>{if(active)stop('Ses bağlantısı kesildi. Tekrar bağlanabilirsin.');});
 listen.addEventListener('click',()=>open(false));
 mic.addEventListener('click',()=>open(true));
 const watch=game==='party'?['party']:game==='football'?['onlinePanel','onlineRoom','onlineCode']:['gameOverlay','roomArea','roomCode','playArea'];
 const observer=new MutationObserver(syncRoom);
 for(const id of watch){
  const node=document.getElementById(id);
  if(node)observer.observe(node,{attributes:true,attributeFilter:['hidden','class','data-lobby'],childList:true});
 }
 window.addEventListener('pagehide',()=>stop());
 syncRoom();
})();
