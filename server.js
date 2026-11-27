const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const accounts = require('./accounts');

const app = express();
const server = http.createServer(app);

// 0.51.12.4: bounded, process-local request budgets before API parsing/database work.
// A syntactically valid session cookie is only a rate-limit key, never authentication.
function createBudget(maxKeys, windowMs, now=Date.now){
 const entries=new Map();let nextSweep=0;
 return function consume(key,maximum){
  const t=now();
  if(t>=nextSweep){for(const [k,v] of entries)if(v.until<=t)entries.delete(k);nextSweep=t+windowMs;}
  let item=entries.get(key);
  if(item&&item.until<=t){entries.delete(key);item=null;}
  if(!item){if(entries.size>=maxKeys)return Math.max(1,Math.ceil((nextSweep-t)/1000));item={count:0,until:t+windowMs};entries.set(key,item);}
  if(item.count>=maximum)return Math.max(1,Math.ceil((item.until-t)/1000));
  item.count++;return 0;
 };
}
const apiBudget=createBudget(4096,60000), globalApiBudget=createBudget(1,60000);
const activeApi=new Map();let apiInFlight=0;
function requestKey(req){
 const token=accounts.sessionToken(req);
 // Do not trust a browser-supplied forwarding header. Proxy peers may share an anonymous budget.
 return token?'session:'+crypto.createHash('sha256').update(token).digest('hex'):'peer:'+String(req.socket?.remoteAddress||'unknown');
}
function allowedApiOrigin(req){
 if(req.get('Sec-Fetch-Site')==='cross-site')return false;
 const origin=req.get('Origin');if(!origin)return true;
 try{const u=new URL(origin);return ['https:','http:'].includes(u.protocol)&&u.host===req.get('Host');}catch{return false;}
}
function apiGuard(req,res,next){
 res.set('Cache-Control','no-store');
 if(!allowedApiOrigin(req))return res.status(403).json({error:'İstek kaynağı geçersiz.'});
 const key=requestKey(req),active=activeApi.get(key)||0;
 const reject=(seconds)=>{res.set('Retry-After',String(seconds));return res.status(429).json({error:'Çok fazla istek. Biraz sonra tekrar dene.'});};
 if(apiInFlight>=48||active>=16)return reject(2);
 const localWait=apiBudget(key,key.startsWith('session:')?180:300);
 if(localWait)return reject(localWait);
 const globalWait=globalApiBudget('all',2400);if(globalWait)return reject(globalWait);
 apiInFlight++;activeApi.set(key,active+1);let released=false;
 const release=()=>{if(released)return;released=true;apiInFlight--;const n=(activeApi.get(key)||1)-1;if(n>0)activeApi.set(key,n);else activeApi.delete(key);};
 res.once('finish',release);res.once('close',release);return next();
}
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('X-Frame-Options','SAMEORIGIN');res.set('Referrer-Policy','same-origin');next();});
app.use('/api',apiGuard);

// Same-origin browser connections only; non-browser clients still need a valid account.
function sameOriginSocket(req, done) {
  const origin=req.headers.origin;
  if (!origin) return done(null,true);
  try { const u=new URL(origin); return done(null,['http:','https:'].includes(u.protocol)&&u.host===req.headers.host); }
  catch { return done(null,false); }
}
const io = new Server(server, { allowRequest: sameOriginSocket, maxHttpBufferSize: 64 * 1024 });
// Check the HttpOnly session on every protected page. Rendering workers remain available during onboarding.
app.use(async (req,res,next)=>{
 if(!['GET','HEAD'].includes(req.method))return next();
 let pathname;try{pathname=decodeURIComponent(req.path).replace(/\\/g,'/');}catch{return res.sendStatus(400);}
 pathname=path.posix.normalize(pathname).toLowerCase();
 if(pathname!=='/'&&!pathname.endsWith('.html')&&!pathname.endsWith('/'))return next();
 if(pathname==='/admin.html')return next(); // Admin endpoints retain their separate administrator-key checks.
 if(pathname==='/late-answer.html')res.set('Permissions-Policy','microphone=(self), camera=()');
 const welcome=pathname==='/welcome.html';
 const worker=['/avatar-portrait-gece.html','/avatar-portrait-golge.html'].includes(pathname);
 res.set('Cache-Control','no-store');
 if(!accounts.sessionToken(req))return welcome?next():res.redirect(302,'/welcome.html');
 try{const a=await accounts.getAccount(await accounts.database(),req);
 if(!a)return welcome?next():res.redirect(302,'/welcome.html');
 if(!a.onboarded)return welcome||worker?next():res.redirect(302,'/welcome.html');
 if(welcome)return res.redirect(302,'/');return next();
 }catch(e){if(welcome)return next();return res.status(503).send('Hesap bağlantısı kurulamadı. Sayfayı yenile.');}
});
// Career endpoints formerly accepted guests with room keys. Require a completed account now.
app.use('/api/football',async(req,res,next)=>{
 if(req.path.startsWith('/account/'))return next();
 try{if(!accounts.sessionToken(req))return res.status(401).json({error:'Önce hesabına giriş yap.'});await accounts.requireAccount(await accounts.database(),req);return next();}catch(e){return res.status(e.status||503).json({error:e.status?e.message:'Hesap bağlantısı kurulamadı.'});}
});
app.get(["/avatar-core-lab.html", "/avatar-original-workshop.html", "/avatar-premium-fullbody.html", "/avatar-premium-modular.html", "/avatar-premium-preview.html"], (_req,res)=>res.redirect(302,'/avatar.html'));
// Content-addressed avatar assets: use original folder first, then the earlier flat
// upload layout, then the bundled byte-identical fallback. No account or database I/O.
const avatarAssetOptions={maxAge:'1y',immutable:true,index:false,redirect:false,fallthrough:true};
app.use('/avatar-assets-v1',express.static(path.join(__dirname,'public','avatar-assets-v1'),avatarAssetOptions));
let avatarFallback;
app.use('/avatar-assets-v1',(req,res,next)=>{
 if(!['GET','HEAD'].includes(req.method))return next();
 const match=/^\/(part-[1-4]\/[a-f0-9]{64}\.(webp|png|jpg|jpeg))$/.exec(req.path);
 if(!match)return res.sendStatus(404);
 const key=match[1],ext=match[2];
 try{
  const fs=require('fs');const flat=path.join(__dirname,'public',key);
  if(fs.existsSync(flat)&&fs.statSync(flat).isFile())return res.sendFile(flat,{maxAge:'1y',immutable:true});
  if(!avatarFallback)avatarFallback=require('./avatar-assets-fallback.json');
  if(!Object.hasOwn(avatarFallback,key))return res.sendStatus(404);
  const data=Buffer.from(avatarFallback[key],'base64');
  res.set('Cache-Control','public, max-age=31536000, immutable');
  res.type(ext==='jpg'?'jpeg':ext);return res.send(data);
 }catch(err){console.error('KEKIP avatar asset fallback:',err.code||err.message);return res.sendStatus(503);}
});
// 0.51.12.1 — Compress public text assets only, after page authorization.
// No new npm dependency. Keep API, Socket.IO, avatar binaries and room logic unchanged.
const staticFs = require('fs').promises;
const gzipStatic = require('util').promisify(require('zlib').gzip);
const publicRoot = path.join(__dirname, 'public');
const compressedAssets = new Map(), compressionPending = new Map();
let compressedBytes = 0;
const COMPRESSED_CACHE_LIMIT = 8 * 1024 * 1024;
const MAX_COMPRESS_FILE = 6 * 1024 * 1024;
const MAX_PENDING_COMPRESSIONS = 3;
function forgetCompressed(name) {
 const item = compressedAssets.get(name);
 if(item){compressedBytes -= item.data.length; compressedAssets.delete(name);}
}
function storeCompressed(name, item){
 forgetCompressed(name);
 if(item.data.length>COMPRESSED_CACHE_LIMIT)return;
 while(compressedBytes+item.data.length>COMPRESSED_CACHE_LIMIT && compressedAssets.size){
  forgetCompressed(compressedAssets.keys().next().value);
 }
 compressedAssets.set(name,item);compressedBytes+=item.data.length;
}
async function readCompressedAsset(name, stat){
 const signature=stat.size+':'+stat.mtimeMs;
 const cached=compressedAssets.get(name);
 if(cached?.signature===signature){compressedAssets.delete(name);compressedAssets.set(name,cached);return cached.data;}
 if(cached)forgetCompressed(name);
 const pending=compressionPending.get(name);
 if(pending)return pending.signature===signature?pending.promise:null;
 if(compressionPending.size>=MAX_PENDING_COMPRESSIONS)return null;
 const promise=(async()=>{
  const raw=await staticFs.readFile(path.join(publicRoot,name));
  if(raw.length!==stat.size || raw.length>MAX_COMPRESS_FILE)return null;
  const data=await gzipStatic(raw,{level:4});
  if(data.length>=raw.length)return null;
  storeCompressed(name,{signature,data});return data;
 })();
 compressionPending.set(name,{signature,promise});
 try{return await promise;}finally{compressionPending.delete(name);}
}
app.use(async (req,res,next)=>{
 if(!['GET','HEAD'].includes(req.method))return next();
 // Root-level HTML, JS and CSS only; never resolve user-controlled directories.
 const pathname=req.path;
 const name=pathname==='/'?'index.html':/^\/[a-zA-Z0-9_-]+\.(?:html|js|css)$/.test(pathname)?pathname.slice(1):null;
 if(!name)return next();
 res.vary('Accept-Encoding');
 if(req.headers.range || req.headers['if-range'] || req.acceptsEncodings('gzip','identity')!=='gzip')return next();
 try{
  const stat=await staticFs.stat(path.join(publicRoot,name));
  if(!stat.isFile() || stat.size<1024 || stat.size>MAX_COMPRESS_FILE)return next();
  const data=await readCompressedAsset(name,stat);
  if(!data)return next();
  res.set('Cache-Control',name.endsWith('.html')?'no-store':'public, max-age=0, must-revalidate');
  res.set('Content-Encoding','gzip');
  res.type(path.extname(name));
  return res.send(data); // Express supplies Content-Length, ETag and HEAD handling.
 }catch(err){
  if(err.code!=='ENOENT'&&err.code!=='ENOTDIR')console.warn('KEKIP static compression:',err.code||err.message);
  if(!res.headersSent){res.removeHeader('Content-Encoding');res.removeHeader('Content-Length');res.removeHeader('ETag');return next();}
  return next(err);
 }
});
app.use(express.static(path.join(__dirname, 'public'),{redirect:false,setHeaders(res,file){if(file.endsWith('.html'))res.setHeader('Cache-Control','no-store');}}));
// Admin monitoring: sanitized snapshot only; no private room codes, player IDs or board data.
function adminBattleSnapshot(){
 const result={total:0,waiting:0,playing:0,finished:0,public:0,private:0,players:0,rooms:[]};
 for(const room of rooms.values()){
  result.total++;if(['waiting','playing','finished'].includes(room.phase))result[room.phase]++;
  const visibility=room.visibility==='public'?'public':'private';result[visibility]++;
  const players=room.players.length;result.players+=players;
  if(result.rooms.length<100)result.rooms.push({visibility,phase:['waiting','playing','finished'].includes(room.phase)?room.phase:'unknown',players,capacity:2});
 }
 return result;
}
// 0.51.12.5: invalidating a session also closes its existing game connections.
// Match the exact revoked session, not every device of the same account.
const lateAnswer = require('./late-answer').attachLateAnswer(io, accounts);
const football = require('./football-online');
const parties = require('./party').attachParty(app,accounts,{
 battleship:(_db,members)=>reserveBattleParty(members),
 late_answer:(_db,members)=>lateAnswer.reserveParty(members),
 football:football.createPartyRoom
});
function disconnectSession(token){
 if(!token)return;
 lateAnswer.disconnectSession(token);
 for(const sock of [...io.sockets.sockets.values()]){
  if(accounts.sessionToken({get:k=>sock.request.headers[k.toLowerCase()]})===token)sock.disconnect(true);
 }
}
require('./favorites').attachFavorites(app);
accounts.attachAccounts(app,{adminBattleSnapshot,disconnectSession,lateInviteOpen:lateAnswer.inviteOpen,disconnectAccount:(id)=>{parties.removeAccount(id);lateAnswer.disconnectAccount(id);for(const room of [...rooms.values()])for(const p of [...room.players])if(p.accountId===id){const sock=io.sockets.sockets.get(p.id);if(sock?.connected)sock.disconnect(true);else removeRoomPlayer(room,p,'left');}},battleInviteOpen:(code,sender,receiver)=>{const r=rooms.get(code);return !!(r&&!r.party&&r.phase==='waiting'&&r.players.length===1&&r.players.some(p=>p.accountId===sender&&connectedPlayer(p))&&!r.players.some(p=>p.accountId===receiver));}});
football.attachFootball(app);
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const REJOIN_GRACE_MS = 90000;
const connectedPlayer = p => !!p && !p.disconnectedUntil && !!io.sockets.sockets.get(p.id)?.connected;
require("./chat").attachChat(app,{lateRoom:lateAnswer.chatRoom,battleRoom:(code,id)=>{const r=rooms.get(code);return r?.players.some(p=>p.accountId===id&&connectedPlayer(p))?r.chatId:null;}});
const SHIPS = [5, 4, 3, 3, 2];
const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[crypto.randomInt(chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
};
function reserveBattleParty(members){
  expireReservations();
  if(members.length!==2||members.some(member=>[...rooms.values()].some(room=>room.players.some(p=>p.accountId===member.id))))
    throw Object.assign(new Error('En az bir parti üyesi başka bir Amiral Battı odasında.'),{status:409});
  const code=makeCode(), until=Date.now()+REJOIN_GRACE_MS;
  const players=members.map(member=>({id:crypto.randomUUID(),accountId:member.id,name:member.username,
    disconnectedUntil:until,ready:false,ships:[],shots:[],hits:[],sunk:[]}));
  const room={code,party:true,visibility:'private',chatId:crypto.randomUUID(),players,
    phase:'waiting',turn:null,winner:null,lastShot:null,shotCount:0};
  rooms.set(code,room);
  for(const player of players){
    player.rejoinTimer=setTimeout(()=>{if(player.disconnectedUntil)removeRoomPlayer(room,player,'rejoin_expired');},REJOIN_GRACE_MS+25);
    player.rejoinTimer.unref?.();
  }
  return '/?partyRoom='+code;
}
const publicState = room => ({
  code: room.code,
  serverNow: Date.now(),
  visibility: room.visibility === 'public' ? 'public' : 'private',
  players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, disconnectedUntil: p.disconnectedUntil || null, avatarUsername: p.accountId ? p.name : null })),
  phase: room.phase,
  turn: room.turn,
  winner: room.winner,
  lastShot: room.lastShot || null,
  boards: room.players.map((p, i) => ({
    shots: p.shots,
    ownHits: p.hits,
    sunk: p.sunk,
    // Ship coordinates are intentionally never sent to clients.
    opponentShots: room.players[1 - i] ? room.players[1 - i].shots : []
  }))
});
const sendState = room => room.players.forEach((p, i) => {if(connectedPlayer(p))io.to(p.id).emit('gameState', { ...publicState(room), you: i });});
const validFleet = ships => {
  if (!Array.isArray(ships) || ships.length !== SHIPS.length) return false;
  const occupied = new Set();
  for (let i = 0; i < SHIPS.length; i++) {
    const cells = ships[i];
    if (!Array.isArray(cells) || cells.length !== SHIPS[i]) return false;
    const coords = new Set();
    for (const c of cells) {
      if (!c || !Number.isInteger(c.r) || !Number.isInteger(c.c) || c.r < 0 || c.r > 9 || c.c < 0 || c.c > 9) return false;
      const key = `${c.r},${c.c}`;
      if (coords.has(key) || occupied.has(key)) return false;
      coords.add(key); occupied.add(key);
    }
    const rows = cells.map(c => c.r), cols = cells.map(c => c.c);
    const sameRow = rows.every(r => r === rows[0]);
    const sameCol = cols.every(c => c === cols[0]);
    if (!sameRow && !sameCol) return false;
    const sorted = (sameRow ? cols : rows).slice().sort((a,b) => a-b);
    if (sorted.some((v, j) => j && v !== sorted[j-1] + 1)) return false;
  }
  return true;
};
// Reserved seats remain in the original room; no shots or ready changes while paused.
function removeRoomPlayer(room, player, departure='left') {
 if(rooms.get(room.code)!==room || !room.players.includes(player))return;
 clearTimeout(player.rejoinTimer);delete player.rejoinTimer;
 room.players.splice(room.players.indexOf(player),1);
 io.sockets.sockets.get(player.id)?.leave(room.code);
 if(!room.players.length){rooms.delete(room.code);return;}
 room.phase='waiting';room.turn=null;room.winner=null;room.lastShot=null;room.shotCount=0;delete room.matchId;
 Object.assign(room.players[0],{ready:false,ships:[],shots:[],hits:[],sunk:[]});
 if(connectedPlayer(room.players[0]))io.to(room.players[0].id).emit('opponentLeft',{reason:departure});
 sendState(room);
}
function removePlayer(socket, departure='left'){
 for(const room of rooms.values()){
  const p=room.players.find(p=>p.id===socket.id);
  if(p){removeRoomPlayer(room,p,departure);break;}
 }
}
// Timer callbacks can run late under load. Membership checks must enforce the deadline too.
function expireReservations(now=Date.now()){
 for(const room of [...rooms.values()])for(const p of [...room.players]){
  if(p.disconnectedUntil&&p.disconnectedUntil<=now)removeRoomPlayer(room,p,'rejoin_expired');
 }
}
function reservePlayer(socket){
 for(const room of rooms.values()){
  const p=room.players.find(p=>p.id===socket.id);
  if(!p)continue;
  if(!p.accountId||room.phase==='finished'){removeRoomPlayer(room,p,'connection_lost');return;}
  if(p.disconnectedUntil)return;
  p.disconnectedUntil=Date.now()+REJOIN_GRACE_MS;
  p.rejoinTimer=setTimeout(()=>{if(p.disconnectedUntil&&p.disconnectedUntil<=Date.now())removeRoomPlayer(room,p,'rejoin_expired');},REJOIN_GRACE_MS+25);
  p.rejoinTimer.unref?.();sendState(room);return;
 }
}
// Validate the envelope before destructuring and catch synchronous/asynchronous handler failures.
function validateGameHandler(handler) {
  return (payload, acknowledgement) => {
    const cb=typeof acknowledgement==='function'?acknowledgement:()=>{};
    if (!payload || typeof payload!=='object' || Array.isArray(payload)) return cb({ok:false,error:'Geçersiz oyun isteği.'});
    if (['name','code','username'].some(k=>payload[k]!==undefined&&(typeof payload[k]!=='string'||payload[k].length>64))) return cb({ok:false,error:'Geçersiz oyun isteği.'});
    try { Promise.resolve(handler(payload,cb)).catch(err=>{console.error('KEKIP oyun isteği:',err.code||err.message);cb({ok:false,error:'Oyun isteği tamamlanamadı.'});}); }
    catch(err){console.error('KEKIP oyun isteği:',err.code||err.message);cb({ok:false,error:'Oyun isteği tamamlanamadı.'});}
  };
}
const socketSessionBudget=createBudget(4096,60000);
io.on('connection', socket => {
  // Limit game commands before any room scan or database work. Leave/disconnect always remain available.
  const commandBudget=createBudget(1,10000);
  const sessionKey=requestKey({get:k=>socket.request.headers[k.toLowerCase()],socket:socket.request.socket});
  const gameHandler=handler=>{
    const validated=validateGameHandler(handler);
    return (payload,ack)=>{
      const cb=typeof ack==='function'?ack:()=>{};
      if(commandBudget('commands',60)||socketSessionBudget(sessionKey,sessionKey.startsWith('session:')?240:480))return cb({ok:false,error:'Çok sık oyun isteği gönderiyorsun. Biraz sonra tekrar dene.'});
      return validated(payload,cb);
    };
  };

  // Only authenticated members can discover joinable public Battleship rooms.
  // Never serialize private rooms, account IDs, socket IDs or game boards.
  let lastPublicList=-Infinity;
  let membershipEpoch=0, membershipPending=false;
  const membershipHandler=handler=>gameHandler(async (payload,cb)=>{
    if(membershipPending)return cb({ok:false,error:'Oda işlemi zaten sürüyor.'});
    membershipPending=true;
    const epoch=++membershipEpoch, started=Date.now();
    const stillValid=()=>socket.connected&&epoch===membershipEpoch&&Date.now()-started<=8000;
    const done=result=>{if(epoch===membershipEpoch)membershipPending=false;cb(result);};
    try{await handler(payload,done,stillValid);}finally{if(epoch===membershipEpoch)membershipPending=false;}
  });
  const cancelMembership=(departure='left')=>{membershipEpoch++;membershipPending=false;removePlayer(socket,departure);};
  const accountInOtherSocket=account=>account&&[...rooms.values()].some(r=>r.players.some(p=>p.accountId===account.id&&p.id!==socket.id));
  socket.on('listPublicRooms', gameHandler(async (_payload, cb) => {
    const now=Date.now();
    if(now-lastPublicList<3000)return cb({ok:false,error:'Biraz sonra tekrar yenile.'});
    lastPublicList=now;
    let account;try{account=await accounts.socketAccount(socket);}catch(e){return cb({ok:false,error:e.status?e.message:'Hesap bağlantısı kurulamadı.'});}
    if(!socket.connected)return;
    if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
    expireReservations();
    const open=[];
    let total=0;
    for(const room of [...rooms.values()].reverse()){
      if(room.visibility!=='public'||room.phase!=='waiting'||room.players.length!==1)continue;
      const host=room.players[0];
      if(!host.accountId||host.accountId===account.id||!io.sockets.sockets.get(host.id)?.connected)continue;
      total++;
      if(open.length<40)open.push({code:room.code,game:'battleship',host:host.name,players:room.players.length,capacity:2});
    }
    cb({ok:true,rooms:open,total});
  }));
  socket.on('createRoom', membershipHandler(async ({ name, visibility = 'private' }, cb, stillValid) => {
    if (!['public','private'].includes(visibility)) return cb({ok:false,error:'Geçersiz oda türü.'});
    let account; try { account = await accounts.socketAccount(socket); } catch(e) { return cb({ok:false,error:e.status?e.message:'Hesap bağlantısı kurulamadı. Tekrar dene.'}); }
    if(!stillValid())return cb({ok:false,error:'Oda isteğinin süresi doldu veya iptal edildi.'});
    if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
    expireReservations();
    if(accountInOtherSocket(account))return cb({ok:false,error:'Bu hesap başka bir sekmede odada. Önce oradan ayrıl.'});
    removePlayer(socket);
    const code = makeCode();
    const room = { code, visibility, chatId:crypto.randomUUID(), players: [{ id: socket.id, accountId: account?.id || null, name: account?.username || String(name || 'Oyuncu 1').slice(0, 18), ready: false, ships: [], shots: [], hits: [], sunk: [] }], phase: 'waiting', turn: null, winner: null, lastShot: null, shotCount: 0 };
    rooms.set(code, room); socket.join(code); cb({ ok: true, code, username:account.username }); sendState(room);
  }));
  const joinRoom = publicOnly => membershipHandler(async ({ code, name }, cb, stillValid) => {
    let account; try { account = await accounts.socketAccount(socket); } catch(e) { return cb({ok:false,error:e.status?e.message:'Hesap bağlantısı kurulamadı. Tekrar dene.'}); }
    if(!stillValid())return cb({ok:false,error:'Oda isteğinin süresi doldu veya iptal edildi.'});
    if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
    expireReservations();
    if(accountInOtherSocket(account))return cb({ok:false,error:'Bu hesap başka bir sekmede odada. Önce oradan ayrıl.'});
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if(room?.party)return cb({ok:false,error:'Bu oda parti üyelerine ayrıldı. Parti sayfasından geçiş yap.'});
    if(room?.players.some(p=>p.disconnectedUntil))return cb({ok:false,error:'Odada bağlantısı kesilmiş oyuncu bekleniyor.'});
    if(publicOnly){
      if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
      if(!room||room.visibility!=='public')return cb({ok:false,error:'Bu açık oda artık katılıma uygun değil.'});
      if(!room.players.length||!io.sockets.sockets.get(room.players[0].id)?.connected)return cb({ok:false,error:'Oda sahibi ayrıldı.'});
      if([...rooms.values()].some(r=>r!==room&&r.players.some(p=>p.id===socket.id||p.accountId===account.id)))return cb({ok:false,error:'Önce mevcut odandan ayrıl.'});
    }
    if (!room) return cb({ ok: false, error: 'Bu oda koduyla bir oyun bulunamadı.' });
    const seat=room.players.find(p=>p.id===socket.id);
    if(seat)return seat.accountId===account.id?cb({ok:true,code:room.code,username:account.username}):cb({ok:false,error:'Bu bağlantı farklı bir hesapla odada. Önce odadan ayrıl.'});
    if (account && room.players.some(p => p.accountId === account.id)) return cb({ok:false,error:'Aynı hesapla iki oyuncu olarak katılamazsın.'});
    if (room.players.length >= 2) return cb({ ok: false, error: 'Bu oda zaten dolu.' });
    if (room.phase !== 'waiting') return cb({ ok: false, error: 'Bu oyun başlamış.' });
    removePlayer(socket);
    room.players.push({ id: socket.id, accountId: account?.id || null, name: account?.username || String(name || 'Oyuncu 2').slice(0, 18), ready: false, ships: [], shots: [], hits: [], sunk: [] });
    socket.join(room.code); cb({ ok: true, code: room.code, username:account.username }); sendState(room);
  });
  // Manual reattachment for the same authenticated account, not a fresh room join.
  socket.on('resumeRoom',membershipHandler(async ({code,username},cb,stillValid)=>{
    let a;try{a=await accounts.socketAccount(socket);}catch(e){return cb({ok:false,error:'Hesap bağlantısı kurulamadı. Tekrar dene.'});}
    if(!stillValid())return cb({ok:false,error:'Oda isteğinin süresi doldu.'});
    if(!a)return cb({ok:false,expired:true,error:'Maça dönmek için aynı hesabına giriş yap.'});
    if(username!==undefined&&(typeof username!=='string'||username!==a.username))return cb({ok:false,expired:true,error:'Oda oturumu farklı bir hesaba ait.'});
    const room=rooms.get(String(code||'').trim().toUpperCase());
    const p=room?.players.find(p=>p.accountId===a.id);
    if(!p)return cb({ok:false,expired:true,error:'Korunan oda oturumu bulunamadı.'});
    if(p.disconnectedUntil&&p.disconnectedUntil<=Date.now()){removeRoomPlayer(room,p,'rejoin_expired');return cb({ok:false,expired:true,error:'Oda koruma süresi doldu.'});}
    expireReservations();
    if(!room.players.includes(p))return cb({ok:false,expired:true,error:'Oda koruma süresi doldu.'});
    if(room.players.some(x=>x!==p&&x.id===socket.id))return cb({ok:false,error:'Bu bağlantı farklı bir oyuncu yerine bağlı. Önce odadan ayrıl.'});
    if([...rooms.values()].some(r=>r!==room&&r.players.some(x=>x.id===socket.id||x.accountId===a.id)))return cb({ok:false,error:'Başka bir oda oturumun var.'});
    if(p.id!==socket.id){
      if(!p.disconnectedUntil)return cb({ok:false,error:'Bu hesap başka bir bağlantıyla odada.'});
      if(p.disconnectedUntil<=Date.now()){removeRoomPlayer(room,p,'rejoin_expired');return cb({ok:false,expired:true,error:'Oda koruma süresi doldu.'});}
      const oldId=p.id;clearTimeout(p.rejoinTimer);delete p.rejoinTimer;delete p.disconnectedUntil;p.id=socket.id;
      if(room.turn===oldId)room.turn=socket.id;
      if(room.winner===oldId)room.winner=socket.id;
      if(room.lastShot?.playerId===oldId)room.lastShot.playerId=socket.id;
    }
    socket.join(room.code);
    cb({ok:true,code:room.code,username:a.username,phase:room.phase,ready:p.ready,ownFleet:p.ships.map(ship=>ship.cells),state:{...publicState(room),you:room.players.indexOf(p)}});sendState(room);
  }));
  socket.on('joinRoom',joinRoom(false));
  socket.on('joinPublicRoom',joinRoom(true));
  socket.on('ready', gameHandler(({ ships } = {}, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.players.length !== 2 || room.phase !== 'waiting') return cb({ ok: false, error: 'Önce iki oyuncunun da odaya katılması gerekiyor.' });
    if(!room.players.every(connectedPlayer))return cb({ok:false,error:'Rakibinin bağlantısı bekleniyor.'});
    const player = room.players.find(p => p.id === socket.id);
    if (player.ready) return cb({ ok: false, error: 'Zaten hazırsın.' });
    if (!validFleet(ships)) return cb({ ok: false, error: 'Gemilerin yerleşimi geçersiz.' });
    player.ships = ships.map((cells, i) => ({ id: i, cells })); player.ready = true;
    if (room.players.every(p => p.ready)) { room.phase = 'playing'; room.turn = room.players[0].id; room.matchId = crypto.randomUUID(); }
    cb({ ok: true }); sendState(room);
  }));
  socket.on('fire', gameHandler(({ r, c } = {}, cb = () => {}) => {
    const room = [...rooms.values()].find(rm => rm.players.some(p => p.id === socket.id));
    if (!room || room.phase !== 'playing') return cb({ ok: false, error: 'Oyun şu anda atışa hazır değil.' });
    if(!room.players.every(connectedPlayer))return cb({ok:false,error:'Rakibinin bağlantısı bekleniyor.'});
    if (room.turn !== socket.id) return cb({ ok: false, error: 'Şu anda sıra sende değil.' });
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 9 || c < 0 || c > 9) return cb({ ok: false, error: 'Geçersiz koordinat.' });
    const me = room.players.find(p => p.id === socket.id);
    const foe = room.players.find(p => p.id !== socket.id);
    if (me.shots.some(s => s.r === r && s.c === c)) return cb({ ok: false, error: 'Bu kareye zaten ateş ettin.' });
    const ship = foe.ships.find(s => s.cells.some(cell => cell.r === r && cell.c === c));
    const hit = !!ship;
    me.shots.push({ r, c, hit });
    room.shotCount += 1;
    if (hit) {
      foe.hits.push({ r, c });
      const sunk = ship.cells.every(cell => foe.hits.some(h => h.r === cell.r && h.c === cell.c));
      if (sunk && !foe.sunk.includes(ship.id)) foe.sunk.push(ship.id);
    }
    const allSunk = foe.ships.every(s => s.cells.every(cell => foe.hits.some(h => h.r === cell.r && h.c === cell.c)));
    const sunkNow = hit && foe.sunk.includes(ship.id);
    room.lastShot = { seq: room.shotCount, playerId: socket.id, playerName: me.name, r, c, hit, sunk: sunkNow };
    if (allSunk) { room.phase = 'finished'; room.winner = socket.id;
      const players=JSON.parse(JSON.stringify(room.players)), matchId=room.matchId, winner=socket.id;
      if(players.some(p=>p.accountId)) {
        const persist=async()=>{try{await accounts.recordBattle(matchId,players,winner);for(const p of players)if(p.accountId)io.to(p.id).emit('statsSaved',{ok:true,matchId});}catch(e){console.error('Battle stats:',e.code||e.message);throw e}};
        persist().catch(()=>setTimeout(()=>persist().catch(()=>{for(const p of players)if(p.accountId)io.to(p.id).emit('statsSaved',{ok:false});}),2000));
      }
    }
    else room.turn = foe.id;
    cb({ ok: true, hit, sunk: sunkNow }); sendState(room);
  }));
  socket.on('leaveRoom', () => cancelMembership('left'));
  socket.on('disconnect', reason => {membershipEpoch++;membershipPending=false;if(reason==='server namespace disconnect'||reason==='client namespace disconnect')removePlayer(socket,'left');else reservePlayer(socket);});
});
app.use('/api',(err,_req,res,next)=>{
 if(res.headersSent)return next(err);
 if(err.type==='entity.too.large')return res.status(413).json({error:'İstek boyutu çok büyük.'});
 if(err.type==='entity.parse.failed')return res.status(400).json({error:'Geçersiz JSON isteği.'});
 if(err.status===415)return res.status(415).json({error:'Desteklenmeyen istek biçimi.'});
 return next(err);
});
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`KEKIP server listening on ${port}`));
