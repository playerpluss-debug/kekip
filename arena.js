'use strict';

const {randomInt,randomUUID}=require('node:crypto');
const {openRound,advanceRound,visibleRound,registerPress,settleRound,responseWindow}=require('./arena-games');
const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern=/^[A-Z2-9]{5}$/;
const roomLimit=150;
const reconnectMs=90_000;
const resultsMs=9000;

function attachArena(io,accounts,{isDraining=()=>false,now=Date.now,random=randomInt,schedule=setInterval}={}){
 const namespace=io.of('/arena'),rooms=new Map(),membership=new Map(),pending=new Map();
 const fail=(ack,error)=>ack({ok:false,error});
 const member=(account,socket)=>({id:account.id,username:account.username,socketId:socket?.id||null,until:socket?null:now()+reconnectMs,total:0,last:0,reaction:null,played:0,fastest:null,early:0,missed:0});
 function makeRoom(players,settings,party=false){
  if(rooms.size>=roomLimit)throw Error('Şu anda yeni lobi açılamıyor.');
  let code;
  do{code=Array.from({length:5},()=>chars[random(chars.length)]).join('');}while(rooms.has(code));
  const room={code,players,host:players[0].id,settings,party,phase:'lobby',number:0,round:null,deadline:0};
  rooms.set(code,room);
  for(const player of players)membership.set(player.id,room);
  return room;
 }
 function state(room,player,t){
  const result=room.lastResult;
  const challenge=room.phase==='round'?visibleRound(room.round,player.id):null;
  return {
   code:room.code,phase:room.phase,settings:room.settings,party:room.party,number:room.number,deadline:room.deadline,
   serverTime:t,
   results:result?{id:result.id,standings:result.standings,cancelled:result.cancelled}:null,
   cardMatchId:result?.cards.has(player.id)?result.id:null,
   host:room.players.find(p=>p.id===room.host)?.username,you:player.username,
   players:room.players.map(p=>({username:p.username,online:!!p.socketId,total:p.total,last:p.last,reaction:p.reaction})),
   challenge
  };
 }
 function publish(room,t=now()){
  for(const player of room.players)namespace.sockets.get(player.socketId)?.emit('arena:state',state(room,player,t));
 }
 function remove(room,player){
  room.players=room.players.filter(p=>p!==player);
  membership.delete(player.id);
  if(!room.players.length){rooms.delete(room.code);return;}
  if(room.host===player.id)room.host=room.players.find(p=>p.socketId)?.id||room.players[0].id;
  if(room.phase!=='lobby'&&room.phase!=='final'&&room.players.length<2){finish(room,now(),true);return;}
  publish(room);
 }
 function nextRound(room,t){
  room.round=openRound(t,random);
  room.number++;
  room.phase='round';
  room.deadline=0;
  publish(room,t);
 }
 function finish(room,t,cancelled=false){
  room.phase='final';room.deadline=t+resultsMs;
  const sorted=[...room.players].sort((a,b)=>b.total-a.total||a.username.localeCompare(b.username));
  const standings=sorted.map(player=>({
   username:player.username,rank:sorted.findIndex(other=>other.total===player.total)+1,total:player.total,
   hits:player.played,fastest:player.fastest,early:player.early,missed:player.missed
  }));
  const result={id:room.matchId,standings,cards:new Set(),cancelled};
  room.lastResult=result;
  const eligible=room.players.filter(player=>player.played>=4);
  if(!cancelled&&eligible.length>=2){
   const uniqueWinner=standings.filter(player=>player.rank===1).length===1?sorted[0]:null;
   const rows=eligible.map(player=>({accountId:player.id,result:{
    complete:true,win:uniqueWinner===player,score:player.total,rounds:player.played
   }}));
   pending.set(result.id,{room,result,rows,nextAttempt:t,expires:t+300_000,busy:false});
  }
  publish(room,t);
 }
 function returnToLobby(room,t){
  room.phase='lobby';room.deadline=0;room.number=0;room.round=null;room.matchId=null;
  for(const player of room.players)Object.assign(player,{total:0,last:0,reaction:null,played:0,fastest:null,early:0,missed:0});
  publish(room,t);
 }
 function saveRewards(t){
  for(const [matchId,record] of pending){
   if(record.busy||record.nextAttempt>t)continue;
   if(t>=record.expires){pending.delete(matchId);continue;}
   record.busy=true;
   Promise.resolve().then(()=>accounts.recordGameResults('arena',matchId,record.rows,null,true)).then(result=>{
    pending.delete(matchId);
    for(const id of result?.cards||[]){
     record.result.cards.add(id);
     const player=record.room.players.find(member=>member.id===id);
     namespace.sockets.get(player?.socketId)?.emit('arena:card',{matchId});
    }
   }).catch(error=>{
    record.busy=false;record.nextAttempt=now()+5000;
    console.error('Arena match rewards:',error.code||error.message);
   });
  }
 }
 function update(){
  const t=now();
  for(const room of rooms.values()){
   for(const player of room.players)if(!player.socketId&&player.until<=t)remove(room,player);
   if(!rooms.has(room.code))continue;
   if(room.phase==='round'){
    if(advanceRound(room.round,t))publish(room,t);
    const litAt=room.round.litAt;
    if(litAt!==null&&(t>=litAt+responseWindow||
      (t>=litAt+200&&room.players.every(player=>room.round.presses.has(player.id))))){
     const results=settleRound(room.round,room.players.map(player=>player.id));
     for(const player of room.players){
      const result=results.get(player.id);
      player.last=result.points;
      player.reaction=result;
      player.total+=result.points;
      if(result.kind==='hit'){
       player.played++;
       player.fastest=player.fastest===null?result.ms:Math.min(player.fastest,result.ms);
      }else if(result.kind==='early')player.early++;
      else player.missed++;
     }
     room.phase='summary';room.deadline=t+3500;publish(room,t);
    }
   }else if(room.phase==='summary'&&t>=room.deadline){
    if(room.number<room.settings.rounds)nextRound(room,t);
    else finish(room,t);
   }else if(room.phase==='final'&&t>=room.deadline){
    returnToLobby(room,t);
   }
  }
  saveRewards(t);
 }
 const timer=schedule(update,40);
 timer?.unref?.();
 namespace.use(async(socket,next)=>{
  try{
   const account=await accounts.socketAccount(socket);
   if(!account)return next(Error('Arena için hesabına giriş yap.'));
   socket.data.account=account;
   socket.data.session=accounts.sessionToken({get:key=>socket.request.headers[key.toLowerCase()]});
   next();
  }catch{next(Error('Arena için hesabına giriş yap.'));}
 });
 namespace.on('connection',socket=>{
  const account=socket.data.account;
  let bucket=0,requests=0;
  function bind(event,handler){
   socket.on('arena:'+event,(data,ack)=>{
    if(typeof ack!=='function')return;
    if(isDraining())return fail(ack,'Sunucu yeniden başlatılıyor.');
    const t=now();
    if(t>=bucket){bucket=t+1000;requests=0;}
    if(++requests>15)return fail(ack,'Çok hızlı işlem yaptın.');
    if(!data||typeof data!=='object'||Array.isArray(data))return fail(ack,'Geçersiz istek.');
    const room=membership.get(account.id),player=room?.players.find(p=>p.id===account.id);
    try{handler(data,ack,room,player,t);}catch(error){fail(ack,error.message);}
   });
  }
  bind('resume',(_data,ack,room,player)=>{
   if(!player)return fail(ack,'Kayıtlı lobi yok.');
   if(player.socketId&&player.socketId!==socket.id)return fail(ack,'Lobi başka bir sekmede açık.');
   player.socketId=socket.id;player.until=null;
   ack({ok:true});publish(room);
  });
  bind('create',(data,ack,existing)=>{
   if(existing)return fail(ack,'Önce mevcut lobiden ayrıl.');
   const settings={visibility:data.visibility==='public'?'public':'private',rounds:6};
   const room=makeRoom([member(account,socket)],settings);
   ack({ok:true});publish(room);
  });
  bind('join',(data,ack,existing)=>{
   if(existing)return fail(ack,'Önce mevcut lobiden ayrıl.');
   if(typeof data.code!=='string'||!codePattern.test(data.code))return fail(ack,'Oda kodu geçersiz.');
   const room=rooms.get(data.code);
   if(!room||room.party||room.phase!=='lobby'||room.players.length>=8)return fail(ack,'Lobi kapanmış, dolmuş veya başlamış.');
   room.players.push(member(account,socket));membership.set(account.id,room);
   ack({ok:true});publish(room);
  });
  bind('start',(_data,ack,room,player,t)=>{
   if(!player||player.socketId!==socket.id||room.host!==player.id||room.phase!=='lobby')return fail(ack,'Maçı oda sahibi başlatabilir.');
   if(room.players.length<2||room.players.some(p=>!p.socketId))return fail(ack,'En az iki oyuncu çevrimiçi olmalı.');
   room.matchId=randomUUID();
   ack({ok:true});nextRound(room,t);
  });
  bind('action',(data,ack,room,player,t)=>{
   if(!player||player.socketId!==socket.id||room.phase!=='round'||data.round!==room.number)
    return fail(ack,'Bu tur artık geçerli değil.');
   const press=registerPress(room.round,player.id,t);
   if(!press)return fail(ack,'Bu turda yeni bir tıklama yapılamaz.');
   ack({ok:true,press});
  });
  bind('leave',(_data,ack,room,player)=>{
   if(!player||player.socketId!==socket.id)return fail(ack,'Bu sekmede açık lobi yok.');
   remove(room,player);ack({ok:true});
  });
  socket.on('disconnect',()=>{
   const room=membership.get(account.id),player=room?.players.find(p=>p.id===account.id);
   if(player?.socketId===socket.id){player.socketId=null;player.until=now()+reconnectMs;publish(room);}
  });
 });
 function disconnectAccount(id){
  const room=membership.get(id),player=room?.players.find(p=>p.id===id);
  if(player)remove(room,player);
  for(const socket of namespace.sockets.values())if(socket.data.account.id===id)socket.disconnect(true);
 }
 return {
  publicRooms(accountId){
   return [...rooms.values()].reverse().filter(room=>!room.party&&room.phase==='lobby'&&
    room.settings.visibility==='public'&&room.players.length<8&&!room.players.some(p=>p.id===accountId)&&
    room.players.some(p=>p.id===room.host&&p.socketId)).slice(0,50).map(room=>({
     code:room.code,game:'arena',host:room.players.find(p=>p.id===room.host).username,players:room.players.length,capacity:8
    }));
  },
  voiceRoom(code,id){
   const room=membership.get(id);
   return room?.code===code&&room.phase==='lobby'&&room.players.some(p=>p.id===id&&p.socketId)?code:null;
  },
  reserveParty(members){
   if(members.length<2||members.length>8||members.some(p=>membership.has(p.id)))throw Error('Parti üyeleri mevcut Arena lobilerinden ayrılmalı.');
   const room=makeRoom(members.map(account=>member(account,null)),{visibility:'private',rounds:6},true);
   return '/arena.html?partyRoom='+room.code;
  },
  disconnectAccount,
  disconnectSession(token){
   if(!token)return;
   for(const socket of namespace.sockets.values())if(socket.data.session===token){
    const room=membership.get(socket.data.account.id),player=room?.players.find(p=>p.socketId===socket.id);
    if(player)remove(room,player);
    socket.disconnect(true);
   }
  },
  close(){clearInterval(timer);}
 };
}

module.exports={attachArena};
