'use strict';

const {signalPayload,voiceConfig}=require('./late-answer');
const membershipPeriod=3500;
const codes={battleship:/^[A-Z2-9]{5}$/,football:/^[A-F0-9]{10}$/,party:/^$/};

function attachLobbyVoice(io,accounts,resolvers,isDraining=()=>false){
 const namespace=io.of('/lobby-voice'),groups=new Map();
 const config=voiceConfig(process.env);
 const fail=(ack,error)=>ack({ok:false,error});
 const headers=socket=>({get:key=>socket.request.headers[key.toLowerCase()]});
 const authorized=async(socket,request)=>{
  const account=await accounts.socketAccount(socket);
  if(!account||account.id!==socket.data.account.id)return null;
  return resolvers[request.game](request.code,account.id);
 };
 namespace.use(async(socket,next)=>{
  try{
   const account=await accounts.socketAccount(socket);
   if(!account)return next(new Error('Lobi sesi için hesabına giriş yap.'));
   socket.data.account=account;
   socket.data.voiceSession=accounts.sessionToken(headers(socket));
   next();
  }catch{next(new Error('Lobi sesi için hesabına giriş yap.'));}
 });
 function publish(group){
  const players=[...group.sockets.values()].map(socket=>({username:socket.data.account.username,online:true}));
  for(const socket of group.sockets.values())socket.emit('voice:roster',players);
 }
 function leave(socket){
  const group=socket.data.voiceGroup;
  if(!group)return;
  socket.data.voiceGroup=null;
  group.sockets.delete(socket.data.account.username);
  if(group.sockets.size)publish(group);
  else groups.delete(group.key);
 }
 function revoke(socket){
  leave(socket);
  socket.emit('voice:closed','Lobi ses bağlantısı kapandı.');
 }
 namespace.on('connection',socket=>{
  let joining=false,checking=false,signalUntil=0,signals=0;
  socket.on('voice:join',async(data,ack)=>{
   if(typeof ack!=='function')return;
   if(joining||socket.data.voiceGroup||isDraining())return fail(ack,'Ses bağlantısı şu anda açılamıyor.');
   if(!data||!Object.hasOwn(codes,data.game)||typeof data.code!=='string'||!codes[data.game].test(data.code))
    return fail(ack,'Lobi bilgisi geçersiz.');
   joining=true;
   try{
    const request={game:data.game,code:data.code};
    const room=await authorized(socket,request);
    if(!socket.connected)return;
    if(!room||isDraining())return fail(ack,'Lobiye katıldıktan sonra sesi açabilirsin.');
    const key=request.game+':'+room,username=socket.data.account.username;
    const group=groups.get(key)||{key,room,sockets:new Map()};
    if(group.sockets.has(username))return fail(ack,'Ses bağlantın başka bir sekmede açık.');
    if(group.sockets.size>=8)return fail(ack,'Ses bağlantısı dolu.');
    groups.set(key,group);
    group.sockets.set(username,socket);
    socket.data.voiceGroup=group;
    socket.data.voiceRequest=request;
    ack({ok:true,me:username,config});
    publish(group);
   }catch{fail(ack,'Lobi ses bağlantısı kurulamadı.');}
   finally{joining=false;}
  });
  socket.on('voice:signal',(data,ack)=>{
   if(typeof ack!=='function')return;
   const group=socket.data.voiceGroup;
   if(!group||isDraining())return fail(ack,'Ses bağlantısı kapalı.');
   const now=Date.now();
   if(now>=signalUntil){signalUntil=now+1000;signals=0;}
   if(++signals>90)return fail(ack,'Ses bağlantısı çok hızlı yeniden deneniyor.');
   if(typeof data?.to!=='string')return fail(ack,'Ses hedefi geçersiz.');
   const target=group.sockets.get(data.to),message=signalPayload(data);
   if(!target?.connected||target===socket||!message)return fail(ack,'Ses hedefi geçersiz.');
   target.emit('voice:signal',{...message,from:socket.data.account.username});
   ack({ok:true});
  });
  const check=setInterval(async()=>{
   const group=socket.data.voiceGroup;
   if(!group||checking)return;
   checking=true;
   try{
    const room=isDraining()?null:await authorized(socket,socket.data.voiceRequest);
    if(socket.data.voiceGroup===group&&room!==group.room)revoke(socket);
   }catch{if(socket.data.voiceGroup===group)revoke(socket);}
   finally{checking=false;}
  },membershipPeriod);
  check.unref?.();
  socket.on('disconnect',()=>{clearInterval(check);leave(socket);});
 });
 return {
  disconnectAccount(id){for(const socket of namespace.sockets.values())if(socket.data.account.id===id)socket.disconnect(true);},
  disconnectSession(token){for(const socket of namespace.sockets.values())if(socket.data.voiceSession===token)socket.disconnect(true);}
 };
}

module.exports={attachLobbyVoice};
