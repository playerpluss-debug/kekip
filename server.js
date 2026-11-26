const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const accounts = require('./accounts');

const app = express();
const server = http.createServer(app);
// Same-origin browser connections only; non-browser clients still need a valid account.
function sameOriginSocket(req, done) {
  const origin=req.headers.origin;
  if (!origin) return done(null,true);
  try { const u=new URL(origin); return done(null,['http:','https:'].includes(u.protocol)&&u.host===req.headers.host); }
  catch { return done(null,false); }
}
const io = new Server(server, { allowRequest: sameOriginSocket });
// Check the HttpOnly session on every protected page. Rendering workers remain available during onboarding.
app.use(async (req,res,next)=>{
 if(!['GET','HEAD'].includes(req.method))return next();
 let pathname;try{pathname=decodeURIComponent(req.path).replace(/\\/g,'/');}catch{return res.sendStatus(400);}
 pathname=path.posix.normalize(pathname).toLowerCase();
 if(pathname!=='/'&&!pathname.endsWith('.html')&&!pathname.endsWith('/'))return next();
 if(pathname==='/admin.html')return next(); // Admin endpoints retain their separate administrator-key checks.
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
app.use(express.static(path.join(__dirname, 'public'),{redirect:false,setHeaders(res,file){if(file.endsWith('.html'))res.setHeader('Cache-Control','no-store');}}));
accounts.attachAccounts(app,{disconnectAccount:(id)=>{for(const room of [...rooms.values()])for(const p of [...room.players])if(p.accountId===id)io.sockets.sockets.get(p.id)?.disconnect(true);},battleInviteOpen:(code,sender,receiver)=>{const r=rooms.get(code);return !!(r&&r.phase==='waiting'&&r.players.length===1&&r.players.some(p=>p.accountId===sender)&&!r.players.some(p=>p.accountId===receiver));}});
require('./football-online').attachFootball(app);
app.get('/health', (_req, res) => res.json({ ok: true }));

const rooms = new Map();
require("./chat").attachChat(app,{battleRoom:(code,id)=>{const r=rooms.get(code);return r?.players.some(p=>p.accountId===id)?r.chatId:null;}});
const SHIPS = [5, 4, 3, 3, 2];
const makeCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
};
const publicState = room => ({
  code: room.code,
  visibility: room.visibility === 'public' ? 'public' : 'private',
  players: room.players.map(p => ({ id: p.id, name: p.name, ready: p.ready, avatarUsername: p.accountId ? p.name : null })),
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
const sendState = room => room.players.forEach((p, i) => io.to(p.id).emit('gameState', { ...publicState(room), you: i }));
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
function removePlayer(socket) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.id === socket.id);
    if (idx !== -1) {
      room.players.splice(idx, 1);
      socket.leave(code);
      if (room.players.length === 0) rooms.delete(code);
      else { room.phase = 'waiting'; room.turn = null; room.winner = null; room.lastShot = null; room.shotCount = 0; Object.assign(room.players[0], { ready: false, ships: [], shots: [], hits: [], sunk: [] }); io.to(room.players[0].id).emit('opponentLeft'); sendState(room); }
      break;
    }
  }
}
// Validate the envelope before destructuring and catch synchronous/asynchronous handler failures.
function gameHandler(handler) {
  return (payload, acknowledgement) => {
    const cb=typeof acknowledgement==='function'?acknowledgement:()=>{};
    if (!payload || typeof payload!=='object' || Array.isArray(payload)) return cb({ok:false,error:'Geçersiz oyun isteği.'});
    if (['name','code'].some(k=>payload[k]!==undefined&&typeof payload[k]!=='string')) return cb({ok:false,error:'Geçersiz oyun isteği.'});
    try { Promise.resolve(handler(payload,cb)).catch(err=>{console.error('KEKIP oyun isteği:',err.code||err.message);cb({ok:false,error:'Oyun isteği tamamlanamadı.'});}); }
    catch(err){console.error('KEKIP oyun isteği:',err.code||err.message);cb({ok:false,error:'Oyun isteği tamamlanamadı.'});}
  };
}
io.on('connection', socket => {
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
  const cancelMembership=()=>{membershipEpoch++;membershipPending=false;removePlayer(socket);};
  const accountInOtherSocket=account=>account&&[...rooms.values()].some(r=>r.players.some(p=>p.accountId===account.id&&p.id!==socket.id));
  socket.on('listPublicRooms', gameHandler(async (_payload, cb) => {
    const now=Date.now();
    if(now-lastPublicList<3000)return cb({ok:false,error:'Biraz sonra tekrar yenile.'});
    lastPublicList=now;
    let account;try{account=await accounts.socketAccount(socket);}catch(e){return cb({ok:false,error:e.status?e.message:'Hesap bağlantısı kurulamadı.'});}
    if(!socket.connected)return;
    if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
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
    if(accountInOtherSocket(account))return cb({ok:false,error:'Bu hesap başka bir sekmede odada. Önce oradan ayrıl.'});
    removePlayer(socket);
    const code = makeCode();
    const room = { code, visibility, chatId:crypto.randomUUID(), players: [{ id: socket.id, accountId: account?.id || null, name: account?.username || String(name || 'Oyuncu 1').slice(0, 18), ready: false, ships: [], shots: [], hits: [], sunk: [] }], phase: 'waiting', turn: null, winner: null, lastShot: null, shotCount: 0 };
    rooms.set(code, room); socket.join(code); cb({ ok: true, code }); sendState(room);
  }));
  const joinRoom = publicOnly => membershipHandler(async ({ code, name }, cb, stillValid) => {
    let account; try { account = await accounts.socketAccount(socket); } catch(e) { return cb({ok:false,error:e.status?e.message:'Hesap bağlantısı kurulamadı. Tekrar dene.'}); }
    if(!stillValid())return cb({ok:false,error:'Oda isteğinin süresi doldu veya iptal edildi.'});
    if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
    if(accountInOtherSocket(account))return cb({ok:false,error:'Bu hesap başka bir sekmede odada. Önce oradan ayrıl.'});
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if(publicOnly){
      if(!account)return cb({ok:false,error:'Önce hesabına giriş yap.'});
      if(!room||room.visibility!=='public')return cb({ok:false,error:'Bu açık oda artık katılıma uygun değil.'});
      if(!room.players.length||!io.sockets.sockets.get(room.players[0].id)?.connected)return cb({ok:false,error:'Oda sahibi ayrıldı.'});
      if([...rooms.values()].some(r=>r!==room&&r.players.some(p=>p.id===socket.id||p.accountId===account.id)))return cb({ok:false,error:'Önce mevcut odandan ayrıl.'});
    }
    if (!room) return cb({ ok: false, error: 'Bu oda koduyla bir oyun bulunamadı.' });
    if (room.players.some(p => p.id === socket.id)) return cb({ ok: true, code: room.code });
    if (account && room.players.some(p => p.accountId === account.id)) return cb({ok:false,error:'Aynı hesapla iki oyuncu olarak katılamazsın.'});
    if (room.players.length >= 2) return cb({ ok: false, error: 'Bu oda zaten dolu.' });
    if (room.phase !== 'waiting') return cb({ ok: false, error: 'Bu oyun başlamış.' });
    removePlayer(socket);
    room.players.push({ id: socket.id, accountId: account?.id || null, name: account?.username || String(name || 'Oyuncu 2').slice(0, 18), ready: false, ships: [], shots: [], hits: [], sunk: [] });
    socket.join(room.code); cb({ ok: true, code: room.code }); sendState(room);
  });
  socket.on('joinRoom',joinRoom(false));
  socket.on('joinPublicRoom',joinRoom(true));
  socket.on('ready', gameHandler(({ ships } = {}, cb = () => {}) => {
    const room = [...rooms.values()].find(r => r.players.some(p => p.id === socket.id));
    if (!room || room.players.length !== 2 || room.phase !== 'waiting') return cb({ ok: false, error: 'Önce iki oyuncunun da odaya katılması gerekiyor.' });
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
        const persist=async()=>{try{await accounts.recordBattle(matchId,players,winner);for(const p of players)if(p.accountId)io.to(p.id).emit('statsSaved',{ok:true});}catch(e){console.error('Battle stats:',e.code||e.message);throw e}};
        persist().catch(()=>setTimeout(()=>persist().catch(()=>{for(const p of players)if(p.accountId)io.to(p.id).emit('statsSaved',{ok:false});}),2000));
      }
    }
    else room.turn = foe.id;
    cb({ ok: true, hit, sunk: sunkNow }); sendState(room);
  }));
  socket.on('leaveRoom', cancelMembership);
  socket.on('disconnect', cancelMembership);
});
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`KEKIP server listening on ${port}`));
