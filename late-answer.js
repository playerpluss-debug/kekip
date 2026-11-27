'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const game = require('./late-answer-game');
const CODE = /^[A-Z2-9]{5}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 120;
const IDLE_MS = 60 * 60_000;

function payload(value, allowed) {
  return value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(k => allowed.includes(k));
}

function signalPayload(data) {
  if (!payload(data, ['to','kind','description','candidate']) ||
      typeof data.to !== 'string' || !/^[a-z0-9_]{3,24}$/.test(data.to)) return null;
  if (data.kind === 'description' && data.candidate === undefined &&
      payload(data.description, ['type','sdp']) && ['offer','answer'].includes(data.description.type) &&
      typeof data.description.sdp === 'string' && data.description.sdp.length <= 12_000 &&
      /^m=audio /m.test(data.description.sdp) && !/^m=(?!audio )/m.test(data.description.sdp)) {
    return {kind:data.kind, description:{type:data.description.type,sdp:data.description.sdp}};
  }
  if (data.kind === 'candidate' && data.description === undefined &&
      payload(data.candidate, ['candidate','sdpMid','sdpMLineIndex','usernameFragment']) &&
      typeof data.candidate.candidate === 'string' && data.candidate.candidate.length <= 2048 &&
      (data.candidate.sdpMid == null || (typeof data.candidate.sdpMid === 'string' && data.candidate.sdpMid.length <= 80)) &&
      (data.candidate.sdpMLineIndex == null || (Number.isInteger(data.candidate.sdpMLineIndex) && data.candidate.sdpMLineIndex >= 0 && data.candidate.sdpMLineIndex <= 16)) &&
      (data.candidate.usernameFragment == null || (typeof data.candidate.usernameFragment === 'string' && data.candidate.usernameFragment.length <= 256))) {
    return {kind:data.kind,candidate:{candidate:data.candidate.candidate,sdpMid:data.candidate.sdpMid,
      sdpMLineIndex:data.candidate.sdpMLineIndex,usernameFragment:data.candidate.usernameFragment}};
  }
  return null;
}

function voiceConfig(env) {
  const iceServers = [{urls:'stun:stun.l.google.com:19302'}];
  const hasTurn = /^turns?:\S{1,512}$/i.test(env.TURN_URL || '') &&
    Boolean(env.TURN_USERNAME && env.TURN_CREDENTIAL);
  if (hasTurn) iceServers.push({urls:env.TURN_URL,username:env.TURN_USERNAME,credential:env.TURN_CREDENTIAL});
  return {iceServers,hasTurn};
}

function budget(map,key,max,now,windowMs=1000) {
  const prior=map.get(key);
  if (!prior || prior.until <= now) {
    map.set(key,{until:now+windowMs,count:1});
    return true;
  }
  if (prior.count >= max) return false;
  prior.count++;
  return true;
}

function attachLateAnswer(io, accounts, {
  now=Date.now, schedule=setInterval, cancel=clearInterval, rng=randomInt, uuid=randomUUID, env=process.env,
  logger=console
}={}) {
  const nsp=io.of('/late-answer');
  const rooms=new Map(), members=new Map();
  const voice=voiceConfig(env);
  const fail=(ack,error)=>ack({ok:false,error});
  const find=(room,id)=>room.players.find(p=>p.id===id&&!p.left);
  const current=socket=>{
    const room=members.get(socket.data.account.id);
    return room && find(room,socket.data.account.id)?.socketId===socket.id ? room : null;
  };
  function code() {
    for(let i=0;i<64;i++){
      const value=Array.from({length:5},()=>ALPHABET[rng(ALPHABET.length)]).join('');
      if(!rooms.has(value))return value;
    }
    return null;
  }
  function broadcast(room,t=now()) {
    for(const player of room.players)if(player.online&&!player.left)
      nsp.sockets.get(player.socketId)?.emit('late:state',game.snapshot(room,player.id,t));
  }
  function reconcilePause(room,t) {
    if(!['intro','answer'].includes(room.phase)){room.pausedRemaining=null;return;}
    const player=find(room,room.order[room.turn]);
    if(!player?.online&&room.deadline!==null){room.pausedRemaining=Math.max(1,room.deadline-t);room.deadline=null;}
    if(player?.online&&room.pausedRemaining!=null){room.deadline=t+room.pausedRemaining;room.pausedRemaining=null;}
  }
  function persist(room,t) {
    if(room.phase!=='final'||room.persisted||room.saving||room.retryAt>t)return;
    room.saving=true;
    room.finalRows??=game.rows(room);
    const result=room.finalRows;
    Promise.resolve().then(()=>accounts.recordGameResults('late_answer',room.matchId,result,null,true)).then(()=>{
      room.persisted=true;
      room.savingError=false;
      for(const row of result)if(row.result.complete){
        const player=find(room,row.accountId);
        nsp.sockets.get(player?.socketId)?.emit('late:recorded',{matchId:room.matchId});
      }
    }).catch(e=>{
      room.retryAt=now()+5000;
      room.savingError=true;
      logger.error('Late Answer match recording:',e.code||e.message);
    }).finally(()=>{room.saving=false;broadcast(room);});
  }
  function remove(room,id,t,reason) {
    const player=find(room,id);
    if(!player)return;
    const socket=nsp.sockets.get(player.socketId);
    members.delete(id);
    if(room.phase==='final')room.finalRows??=game.rows(room);
    game.removePlayer(room,id,t);
    reconcilePause(room,t);
    socket?.emit('late:left',{reason});
    broadcast(room,t);
    persist(room,t);
    if(!room.players.some(p=>!p.left)&&(!room.matchId||room.persisted))rooms.delete(room.code);
  }
  function reserve(room,player,t) {
    player.online=false;
    player.socketId=null;
    player.microphone=false;
    player.until=t+game.RESUME_MS;
    reconcilePause(room,t);
    broadcast(room,t);
  }
  function sweep() {
    const t=now();
    for(const room of rooms.values()){
      if((room.phase==='lobby'||room.phase==='turn_ready'||(room.phase==='final'&&room.persisted))&&t-room.touched>IDLE_MS){
        for(const p of [...room.players])remove(room,p.id,t,'Oda hareketsizlik nedeniyle kapandı.');
        continue;
      }
      for(const p of [...room.players])if(!p.left&&!p.online&&p.until<=t)
        remove(room,p.id,t,'Yeniden bağlanma süresi doldu.');
      if(game.advance(room,t)){reconcilePause(room,t);broadcast(room,t);}
      persist(room,t);
      if(room.persisted&&!room.players.some(p=>!p.left))rooms.delete(room.code);
    }
  }
  const timer=schedule(sweep,200);
  timer?.unref?.();
  nsp.use(async(socket,next)=>{
    try{socket.data.account=await accounts.socketAccount(socket);next();}
    catch{next(new Error('Bu oyun için KEKIP hesabına giriş yap.'));}
  });
  nsp.on('connection',socket=>{
    const who=socket.data.account, rates=new Map();
    const makePlayer=()=>({id:who.id,username:who.username,socketId:socket.id,online:true,ready:false,
      microphone:false,until:null,session:accounts.sessionToken({get:k=>socket.request.headers[k.toLowerCase()]})});
    function bind(event,keys,handler,{roomOnly=false,signal=false}={}){
      socket.on('late:'+event,(data,ack)=>{
        if(typeof ack!=='function')return;
        const t=now(),room=current(socket);
        const description=signal&&data?.kind==='description';
        const limitKey=signal?(description?'voice-description':'voice-candidate'):event;
        if(!budget(rates,limitKey,signal?(description?18:80):12,t)||
           (room&&!budget(room.rates,signal?limitKey:'events',signal?(description?145:420):80,t)))
          return fail(ack,'Çok hızlı işlem yaptın. Biraz bekle.');
        if(!payload(data,keys))return fail(ack,'Geçersiz istek.');
        if(roomOnly&&!room)return fail(ack,'Önce bir odaya katıl.');
        if(room){room.touched=t;if(game.advance(room,t)){reconcilePause(room,t);broadcast(room,t);persist(room,t);}}
        handler(data,ack,room,t);
      });
    }
    bind('list',[],(_,ack)=>ack({ok:true,rooms:[...rooms.values()].filter(r=>r.phase==='lobby'&&
      r.settings.visibility==='public'&&r.players.length<game.MAX_PLAYERS)
      .slice(0,50).map(r=>({code:r.code,host:find(r,r.host)?.username,players:r.players.length,settings:r.settings}))}));
    bind('create',['questions','seconds','visibility'],(data,ack,_,t)=>{
      const settings=game.validateSettings(data);
      if(!settings)return fail(ack,'Oda ayarları geçersiz.');
      if(members.has(who.id))return fail(ack,'Bu hesap zaten bir Gecikmeli Cevap odasında.');
      const key=rooms.size<MAX_ROOMS?code():null;
      if(!key)return fail(ack,'Şu anda yeni oda açılamıyor.');
      const room=game.createRoom(key,makePlayer(),settings);
      Object.assign(room,{rates:new Map(),touched:t,chatId:uuid(),retryAt:0,kicked:new Set()});
      rooms.set(key,room);members.set(who.id,room);
      ack({ok:true,code:key,voice});broadcast(room,t);
    });
    bind('join',['code'],(data,ack,_,t)=>{
      if(typeof data.code!=='string'||!CODE.test(data.code))return fail(ack,'Oda kodu geçersiz.');
      if(members.has(who.id))return fail(ack,'Bu hesap zaten bir Gecikmeli Cevap odasında.');
      const room=rooms.get(data.code);
      if(!room||room.phase!=='lobby'||room.players.length>=game.MAX_PLAYERS||room.kicked.has(who.id))
        return fail(ack,'Odaya katılınamıyor. Oda kapanmış, başlamış veya dolu olabilir.');
      room.players.push(makePlayer());room.touched=t;members.set(who.id,room);
      ack({ok:true,code:room.code,voice});broadcast(room,t);
    });
    bind('resume',['code'],(data,ack,_,t)=>{
      const room=members.get(who.id);
      if(typeof data.code!=='string'||room?.code!==data.code)return fail(ack,'Oda oturumu bulunamadı.');
      const p=find(room,who.id);
      if(!p||p.online||p.until<=t)return fail(ack,'Bu oda oturumu açık veya yeniden bağlanma süresi dolmuş.');
      Object.assign(p,makePlayer(),{ready:p.ready});room.touched=t;
      reconcilePause(room,t);ack({ok:true,code:room.code,voice});broadcast(room,t);
    });
    bind('sync',[],(_,ack,room,t)=>ack({ok:true,state:game.snapshot(room,who.id,t)}),{roomOnly:true});
    bind('leave',[],(_,ack,room,t)=>{ack({ok:true});remove(room,who.id,t,'Odadan ayrıldın.');},{roomOnly:true});
    bind('settings',['questions','seconds','visibility'],(data,ack,room,t)=>{
      const settings=game.validateSettings(data);
      if(!settings||room.phase!=='lobby'||room.host!==who.id)return fail(ack,'Oda ayarları değiştirilemedi.');
      room.settings=settings;ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('ready',['ready'],(data,ack,room,t)=>{
      if(room.phase!=='lobby'||typeof data.ready!=='boolean')return fail(ack,'Hazır durumu geçersiz.');
      find(room,who.id).ready=data.ready;ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('start',[],(_,ack,room,t)=>{
      if(room.host!==who.id||!game.canStart(room))
        return fail(ack,'Başlamak için en az 3 oyuncu hazır olmalı.');
      if(game.needsNewRoom(room)){
        const next=code();
        if(!next)return fail(ack,'Yeni soru havuzu için oda kodu oluşturulamadı.');
        rooms.delete(room.code);room.code=next;room.chatId=uuid();room.usedQuestions.clear();rooms.set(next,room);
      }
      game.start(room,t,uuid(),rng);
      ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('turn-ready',['sequence'],(data,ack,room,t)=>{
      if(!game.readyTurn(room,who.id,data.sequence,t))return fail(ack,'Hazırım düğmesini yalnızca sıradaki yarışmacı kullanabilir.');
      ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('vote',['correct','sequence'],(data,ack,room,t)=>{
      if(!game.vote(room,who.id,data,t))return fail(ack,'Oy kaydedilemedi. Cevap süresi veya sıran değişmiş olabilir.');
      reconcilePause(room,t);ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('microphone',['enabled'],(data,ack,room,t)=>{
      if(typeof data.enabled!=='boolean')return fail(ack,'Mikrofon durumu geçersiz.');
      find(room,who.id).microphone=data.enabled;ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('kick',['username'],(data,ack,room,t)=>{
      const target=room.players.find(p=>!p.left&&p.username===data.username);
      if(room.host!==who.id||!target||target.id===who.id)return fail(ack,'Oyuncu çıkarılamadı.');
      room.kicked.add(target.id);ack({ok:true});remove(room,target.id,t,'Oda sahibi seni odadan çıkardı.');
    },{roomOnly:true});
    bind('rematch',[],(_,ack,room,t)=>{
      if(room.host!==who.id||room.phase!=='final'||!room.persisted)return fail(ack,'Maç kaydı tamamlanınca yeniden oynayabilirsin.');
      const players=room.players.filter(p=>!p.left);
      Object.assign(room,game.createRoom(room.code,players[0],room.settings),{players,host:who.id,usedQuestions:room.usedQuestions,
        finalRows:null,pausedRemaining:null,retryAt:0,savingError:false});
      for(const player of players)player.ready=false;
      ack({ok:true});broadcast(room,t);
    },{roomOnly:true});
    bind('signal',['to','kind','description','candidate'],(data,ack,room)=>{
      const message=signalPayload(data);
      const target=room.players.find(p=>p.online&&!p.left&&p.username===data.to&&p.id!==who.id);
      if(!message||!target)return fail(ack,'Ses bağlantısı isteği geçersiz.');
      nsp.sockets.get(target.socketId)?.emit('late:signal',{from:who.username,...message});ack({ok:true});
    },{roomOnly:true,signal:true});
    socket.on('disconnect',()=>{
      const room=current(socket);
      if(room){const t=now();game.advance(room,t);reserve(room,find(room,who.id),t);persist(room,t);}
    });
  });

  return {
    inviteOpen(code,sender,recipient){
      const room=rooms.get(code);
      return Boolean(room?.phase==='lobby'&&room.players.length<game.MAX_PLAYERS&&find(room,sender)?.online&&
        !find(room,recipient)&&!room.kicked.has(recipient)&&!members.has(recipient));
    },
    chatRoom(code,id){
      const room=rooms.get(code);
      return room&&find(room,id)?.online?room.chatId:null;
    },
    disconnectAccount(id){
      const room=members.get(id);
      if(!room)return;
      const socket=nsp.sockets.get(find(room,id)?.socketId);
      remove(room,id,now(),'Hesap erişimi kapatıldı.');
      socket?.disconnect();
    },
    disconnectSession(token){
      if(!token)return;
      for(const [id,room] of [...members]){
        const p=find(room,id);
        if(p?.session!==token)continue;
        const socket=nsp.sockets.get(p.socketId);
        remove(room,id,now(),'Oturum sona erdi.');
        socket?.disconnect();
      }
    },
    close(){cancel(timer);}
  };
}

module.exports = {attachLateAnswer,signalPayload,voiceConfig};
