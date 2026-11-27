'use strict';
const crypto=require('crypto');
const teams=['Kuzey FK','Ege SK','Başkent FK','Akdeniz FK','Bozkırspor','Marmara SK','Yıldız FK','Orman SK','Anadolu 1907','Liman United','Kapadokya FK','Trakya SK','Fırtına FK','Hisar Athletic','Zirve SK','Körfez FK','İstanbul United','Bosphorus City','Ankara Athletic','Ege Royal','Atlas FK','Akdeniz City','Marmara 1923','Kuzey Yıldızı'];
const levels=[52,48,56,59,45,57,60,54,62,65,60,67,73,69,75,71,80,88,82,78,90,77,85,75];
const clone=x=>JSON.parse(JSON.stringify(x));const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const token=()=>crypto.randomBytes(24).toString('hex'); const code=()=>crypto.randomBytes(5).toString('hex').toUpperCase();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));const int=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
const emptyTable=()=>teams.map(name=>({name,p:0,gf:0,ga:0,mp:0}));
const divisions=()=>Array.from({length:3},(_,i)=>Array.from({length:8},(_,j)=>i*8+j));
function fixtures(w){return w.divisions.flatMap(g=>{let o=g.slice();for(let n=1;n<(w.week-1)%7+1;n++)o.splice(1,0,o.pop());return Array.from({length:4},(_,i)=>w.week>7?[o[7-i],o[i]]:[o[i],o[7-i]])})}
function rank(w,t){return w.divisions[t].slice().sort((a,b)=>{let x=w.table[a],y=w.table[b];return y.p-x.p||(y.gf-y.ga)-(x.gf-x.ga)||y.gf-x.gf||a-b})}
function rng(seed){let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296}}
function baseScores(room){let w=room.world;return fixtures(w).map(([a,b])=>{let strength=i=>levels[i]+15*(w.divisions.findIndex(g=>g.includes(i))-Math.floor(i/8));let d=strength(a)-strength(b),r=rng((room.seed+w.season*100003+w.week*7919+a*173+b*41)>>>0);return [a,b,Math.min(3,Math.round(clamp(r()*3+d*.065,0,4))),Math.min(3,Math.round(clamp(r()*3-d*.065,0,4)))]})}
function advance(w,results){let n=clone(w);for(let [a,b,g,h] of results){let x=n.table[a],y=n.table[b];x.mp++;y.mp++;x.gf+=g;x.ga+=h;y.gf+=h;y.ga+=g;x.p+=g>h?3:g===h?1:0;y.p+=h>g?3:g===h?1:0;}if(n.week===14){let r=[0,1,2].map(t=>rank(n,t));n.divisions=[r[0].slice(2).concat(r[1].slice(-2)),r[1].slice(2,6).concat(r[0].slice(0,2),r[2].slice(-2)),r[2].slice(0,6).concat(r[1].slice(0,2))];n.season++;n.week=1;n.table=emptyTable()}else n.week++;return n}
function makePlayer(name,pos,team){if(typeof name!=='string'||!name.trim()||name.trim().length>30||!['ST','LW','CAM'].includes(pos)||!int(team,0,7))fail('İsim, mevki ve kulübü kontrol et.');let key=token();return {key,player:{id:crypto.randomBytes(8).toString('hex'),auth:hash(key),name:name.trim(),pos,team,save:null,rev:0,submitted:null,applied:false}}}
function create(body){let {player,key}=makePlayer(body.name,body.pos,body.team);let r={code:code(),seed:crypto.randomBytes(4).readUInt32LE(),host:player.id,stage:'lobby',visibility:body.visibility==='public'?'public':'private',players:[player],world:{season:1,week:1,table:emptyTable(),divisions:divisions()},round:null};return {room:r,key,player}}
function equal(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function matchWorld(s,w){return s.season===w.season&&s.week===w.week&&equal(s.divisions,w.divisions)&&Array.isArray(s.table)&&s.table.length===24&&s.table.every((r,i)=>['name','p','gf','ga','mp'].every(k=>r[k]===w.table[i][k]))}
function fresh(p,w){return {version:1,name:p.name,pos:p.pos,team:p.team,season:w.season,week:w.week,age:17,money:0,xp:0,games:0,goals:0,assists:0,passes:0,dribbles:0,energy:100,skill:55,table:clone(w.table),divisions:clone(w.divisions),history:[],match:null}}
function validateSave(s,p,w){if(!s||s.version!==1||s.name!==p.name||s.pos!==p.pos||!int(s.team,0,23)||!matchWorld(s,w)||!int(s.games,0,100000)||!int(s.goals,0,1000000)||!int(s.assists||0,0,1000000)||!int(s.skill,1,99)||!Number.isFinite(s.money)||!Number.isFinite(s.xp)||!Array.isArray(s.history)||JSON.stringify(s).length>1000000)fail('Kariyer verisi veya ortak lig tablosu geçersiz.');}
function findPlayer(r,key){let p=r.players.find(x=>x.auth===hash(key));if(!p)fail('Kariyer anahtarı geçersiz.',403);return p}
function summary(r,p){return {code:r.code,stage:r.stage,partyWaiting:r.partyPending?.length||0,host:r.host,you:p.id,world:r.world,base:r.stage==='playing'?baseScores(r):null,round:r.stage==='results'?r.round:null,rev:p.rev,linked:!!p.accountId,submitted:!!p.submitted,applied:p.applied,save:p.save,players:r.players.map(q=>({id:q.id,name:q.name,team:q.save?.team??q.team,skill:q.save?.skill??55,games:q.save?.games??0,goals:q.save?.goals??0,assists:q.save?.assists??0,status:r.stage==='lobby'?'Lobide':q.applied?'Sonuç işlendi':q.submitted?'Maç bitti':'Hazırlanıyor / oynuyor'}))}}
function operate(r,action,b,key,verified=null){if(action==='join'){if(r.partyPending)fail('Bu oda parti üyelerine ayrıldı.',403);if(r.stage!=='lobby')fail('Kariyer başladı; yeni oyuncu alınmıyor. Kendi anahtarınla devam et.');if(r.players.length>=8)fail('Oda dolu.');let {player,key}=makePlayer(b.name,b.pos,b.team);if(r.players.some(p=>p.name.toLocaleLowerCase('tr')===player.name.toLocaleLowerCase('tr')))fail('Bu isim kullanılıyor.');r.players.push(player);return {...summary(r,player),key};}
let p=verified||findPlayer(r,key);if(action==='state')return summary(r,p);
if(action==='start'){if(p.id!==r.host||r.stage!=='lobby'||r.players.length<2)fail('Oda sahibi en az iki oyuncuyla başlayabilir.');for(let q of r.players){q.save=fresh(q,r.world);q.rev++}r.stage='playing';return summary(r,p)}
if(!['save','submit','apply'].includes(action))fail('İşlem bulunamadı.',404);
if(r.stage==='lobby')fail('Kariyer henüz başlamadı.');if(b.rev!==p.rev)fail('Kayıt başka bir oturumda güncellendi. Sayfayı yenilemeden önce mevcut oturumu kapat.',409);
let s=b.save;
if(action==='save'){if(p.submitted&&!p.applied)fail('Maç sonucu bekleniyor.');validateSave(s,p,p.applied?r.round.next:r.world);let current=p.applied?r.round.next:r.world;if(s.team!==p.save.team&&(p.save.match||!(current.week===8||current.week===1&&current.season>1)))fail('Transfer dönemi dışında kulüp değiştirilemez.');p.save=clone(s);p.rev++;return summary(r,p)}
if(action==='submit'){if(r.stage!=='playing'||p.submitted)fail('Maç zaten gönderildi veya hafta tamamlandı.');validateSave(s,p,r.world);let m=s.match,l=m?.live,base=baseScores(r).find(x=>x[0]===s.team||x[1]===s.team);let own=base[0]===s.team,opp=own?base[1]:base[0];if(s.team!==p.save.team||!m||m.opponent!==opp||m.aiFor!==base[own?2:3]||m.aiAgainst!==base[own?3:2]||m.played!==3||l?.minute!==90||l.awaiting||!Array.isArray(l.results)||l.results.length!==3||!l.results.every(x=>['goal','assist','pass','saved','miss','lost'].includes(x))||m.goals!==l.results.filter(x=>x==='goal').length||(m.assists||0)!==l.results.filter(x=>x==='assist').length||!int(m.passes||0,0,3)||!int(m.dribbles||0,0,3))fail('Maç sonucu geçersiz veya tamamlanmamış.');p.save=clone(s);p.rev++;p.submitted={id:p.id,name:p.name,team:s.team,goals:m.goals,assists:m.assists||0,passes:m.passes||0,dribbles:m.dribbles||0,lost:l.results.filter(x=>x==='lost').length,trained:!!s.prep?.trained};if(r.players.every(q=>q.submitted)){let humans=r.players.map(q=>q.submitted),results=baseScores(r).map(([a,b,g,h])=>[a,b,g+humans.filter(x=>x.team===a).reduce((n,x)=>n+x.goals+x.assists,0),h+humans.filter(x=>x.team===b).reduce((n,x)=>n+x.goals+x.assists,0)]);for(let x of humans){let f=results.find(z=>z[0]===x.team||z[1]===x.team),own=f[0]===x.team,g=f[own?2:3],h=f[own?3:2];x.rating=Math.round(clamp(6+x.goals*.95+x.assists*.8+x.passes*.18+x.dribbles*.24-x.lost*.35+(g>h?.35:g<h?-.25:0)-(x.trained?.2:0),4,10)*10)/10}r.round={results,humans,next:advance(r.world,results)};r.stage='results'}return summary(r,p)}
if(action==='apply'){if(r.stage!=='results'||!p.submitted||p.applied)fail('İşlenecek maç sonucu bulunamadı.');validateSave(s,p,r.round.next);if(s.match||s.team!==p.save.team||s.games!==p.save.games+1||s.goals!==p.save.goals+p.submitted.goals||(s.assists||0)!==(p.save.assists||0)+p.submitted.assists)fail('Sonuç kaydı tutarsız.');p.save=clone(s);p.rev++;p.applied=true;if(r.players.every(q=>q.applied)){r.world=r.round.next;r.round=null;r.stage='playing';for(let q of r.players){q.applied=false;q.submitted=null;delete q.submittedAccountId}}return summary(r,p)}
}
// Account-bound operations use the signed-in KEKIP account.
const {database,getAccount,requireAccount,safeRequest,passwordHash,verifyPassword,recordGameResults}=require('./accounts');
function roomCode(b){const c=String(b.code||'').trim().toUpperCase();if(!/^[A-F0-9]{10}$/.test(c))fail('Oda kodu geçersiz.');return c}
function claimPlayer(room,p,a){if(p.accountId&&p.accountId!==a.id)fail('Bu kariyer başka bir hesaba bağlı.',409);if(room.players.some(x=>x.id!==p.id&&x.accountId===a.id))fail('Bu odada hesabına bağlı başka bir futbolcu var.',409);p.accountId=a.id;}
function accountPlayer(room,a,id){const p=room.players.find(x=>x.id===id&&x.accountId===a.id);if(!p)fail('Bu kariyer hesabına bağlı değil.',403);return p}
async function attachAvatarNames(db,room,result){if(!Array.isArray(result.players))return result;const ids=[...new Set(room.players.map(p=>p.accountId).filter(Boolean))];let names=new Map();if(ids.length){try{const q=await db.query('SELECT id,username FROM kekip_football_accounts WHERE id=ANY($1::text[]) AND blocked_at IS NULL',[ids]);names=new Map(q.rows.map(a=>[a.id,a.username]));}catch(e){console.error('Football avatar:',e.code||e.message);}}const byId=new Map(room.players.map(p=>[p.id,p.accountId]));return {...result,players:result.players.map(p=>({...p,avatarUsername:names.get(byId.get(p.id))||null}))};}
async function createPartyRoom(db,accounts,stable){
 if(accounts.length<2||accounts.length>8)fail('Ortak kariyer 2–8 oyuncu gerektirir.');
 const {room,player}=create({name:accounts[0].username,pos:'ST',team:0});
 claimPlayer(room,player,accounts[0]);
 for(let i=1;i<accounts.length;i++){
   const a=accounts[i];
   const joined=operate(room,'join',{name:a.username,pos:'ST',team:i},'');
   claimPlayer(room,room.players.find(p=>p.id===joined.you),a);
 }
 room.partyPending=room.players.map(p=>p.id);
 const client=await db.connect();
 try{
   await client.query('BEGIN');
   const active=await client.query('SELECT id FROM kekip_football_accounts WHERE id=ANY($1::text[]) AND blocked_at IS NULL ORDER BY id FOR UPDATE',[accounts.map(a=>a.id)]);
   if(active.rows.length!==accounts.length||!stable())fail('Parti değişti. Tekrar dene.',409);
   await client.query('INSERT INTO kekip_football_rooms(code,data) VALUES($1,$2)',[room.code,JSON.stringify(room)]);
   if(!stable())fail('Parti değişti. Tekrar dene.',409);
   await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
 finally{client.release();}
 return '/football.html?footballRoom='+room.code+'&party=1';
}
async function publicRooms(accountId){
  const db=await database();
  const {rows}=await db.query(`SELECT code,data->'players' AS players,data->>'host' AS host
    FROM kekip_football_rooms
    WHERE data @> '{"stage":"lobby","visibility":"public"}'::jsonb
      AND NOT (data ? 'partyPending')
      AND NOT (data @> $1::jsonb)
      AND jsonb_array_length(data->'players') BETWEEN 1 AND 7
    ORDER BY updated_at DESC LIMIT 50`,[JSON.stringify({players:[{accountId}]})]);
  return rows.flatMap(row=>{
    const host=row.players.find(player=>player.id===row.host);
    return host?[{code:row.code,game:'football',host:host.name,players:row.players.length,capacity:8}]:[];
  });
}
function attachFootball(app){const json=require('express').json;
app.post('/api/football/account/:action',json({limit:'16kb'}),async(req,res)=>{res.set('Cache-Control','no-store');let client;try{safeRequest(req);const db=await database(),b=req.body||{},action=req.params.action;
const a=await requireAccount(db,req);
if(action==='list'){const q=await db.query("SELECT code,data,updated_at FROM kekip_football_rooms WHERE data @> $1::jsonb ORDER BY updated_at DESC",[JSON.stringify({players:[{accountId:a.id}]})]);const careers=q.rows.flatMap(row=>row.data.players.filter(p=>p.accountId===a.id).map(p=>({code:row.code,player:p.id,name:p.name,team:teams[p.save?.team??p.team],skill:p.save?.skill??55,season:p.save?.season??row.data.world.season,week:p.save?.week??row.data.world.week,stage:row.data.stage,canDelete:p.id===row.data.host,updated:row.updated_at})));return res.json({careers})}
if(action==='delete'){
  const code=roomCode(b);
  // The single DELETE locks the row and checks its current owner before removal.
  const deleted=await db.query(`DELETE FROM kekip_football_rooms
    WHERE code=$1 AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(data->'players') AS member
      WHERE member->>'id'=data->>'host' AND member->>'accountId'=$2
    ) RETURNING code`,[code,a.id]);
  if(!deleted.rowCount)fail('Silinebilecek bir ortak kariyer bulunamadı.',404);
  return res.json({ok:true});
}
if(action==='claim'){const c=roomCode(b);client=await db.connect();await client.query('BEGIN');const q=await client.query('SELECT data FROM kekip_football_rooms WHERE code=$1 FOR UPDATE',[c]);if(!q.rows.length)fail('Oda bulunamadı.',404);const room=q.rows[0].data,p=findPlayer(room,req.get('Authorization')?.replace(/^Bearer /,'')||'');claimPlayer(room,p,a);await client.query('UPDATE kekip_football_rooms SET data=$2,updated_at=now() WHERE code=$1',[c,JSON.stringify(room)]);await client.query('COMMIT');return res.json({ok:true,player:p.id})}
fail('İşlem bulunamadı.',404)}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(!e.status)console.error('Football account:',e.code||e.message);res.status(e.status||503).json({error:e.status?e.message:'Hesap sunucusuna erişilemiyor. Tekrar dene.'})}finally{client?.release()}});
app.post('/api/football/:action',json({limit:'2mb'}),async(req,res)=>{res.set('Cache-Control','no-store');let db,client;try{safeRequest(req);db=await database();let b=req.body||{},action=req.params.action;if(action==='create'){let {room,key,player}=create(b);const a=await getAccount(db,req);if(a)claimPlayer(room,player,a);await db.query('INSERT INTO kekip_football_rooms(code,data) VALUES($1,$2)',[room.code,JSON.stringify(room)]);return res.json(await attachAvatarNames(db,room,{...summary(room,player),key,accountPlayer:a?player.id:null}))}let c=roomCode(b);client=await db.connect();await client.query('BEGIN');let q=await client.query('SELECT data FROM kekip_football_rooms WHERE code=$1 FOR UPDATE',[c]);if(!q.rows.length)fail('Oda bulunamadı.',404);let room=q.rows[0].data,result,partyArrived=false;
if(action==='join'){const a=await getAccount(client,req);if(a&&room.players.some(p=>p.accountId===a.id))fail('Bu odada kayıtlı futbolcun var. Kayıtlı kariyerlerden devam et.',409);result=operate(room,action,b,'');if(a){let p=room.players.find(p=>p.id===result.you);claimPlayer(room,p,a);result={...result,linked:true,accountPlayer:p.id}}}else{let p=null;if(b.accountPlayer){safeRequest(req);const a=await requireAccount(client,req);p=accountPlayer(room,a,b.accountPlayer)}const key=req.get('Authorization')?.replace(/^Bearer /,'')||'';
const verified=p||findPlayer(room,key);if(verified.accountId){const signedIn=await requireAccount(client,req);if(signedIn.id!==verified.accountId)fail('Bu kariyer hesabına bağlı değil.',403);}
partyArrived=action==='state'&&room.partyPending?.includes(verified.id);
if(partyArrived)room.partyPending=room.partyPending.filter(id=>id!==verified.id);
if(action==='start'&&room.partyPending?.length)fail('Tüm parti üyelerinin kariyere bağlanması bekleniyor.',409);
// Capture the authoritative submitted match before apply can advance/reset the shared round.
let matchRecord=null;
if(action==='apply'){const player=verified;if(player.accountId&&player.submitted){const eligible=room.stage==='results'&&room.players.every(q=>q.submitted)&&player.submittedAccountId===player.accountId&&new Set(room.players.filter(q=>q.accountId&&q.submittedAccountId===q.accountId).map(q=>q.accountId)).size>=2;matchRecord={id:room.code+':'+room.world.season+':'+room.world.week,eligible,row:{accountId:player.accountId,result:{goals:player.submitted.goals,assists:player.submitted.assists}}}}}
result=operate(room,action,b,key,p);
// Only a session verified by this route may mark a submission eligible for cards.
if(action==='submit')verified.submittedAccountId=verified.accountId||null;
// Same transaction as career save: no double credit and no orphan result on rollback.
if(matchRecord){await recordGameResults('football',matchRecord.id,[matchRecord.row],client,matchRecord.eligible);if(matchRecord.eligible)result.matchCardMatchId=matchRecord.id;}
if(p)result.accountPlayer=p.id;}
if(action!=='state'||partyArrived)await client.query('UPDATE kekip_football_rooms SET data=$2,updated_at=now() WHERE code=$1',[c,JSON.stringify(room)]);await client.query('COMMIT');res.json(await attachAvatarNames(client,room,result))}catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(!e.status)console.error('Football DB:',e.code||e.message);res.status(e.status||503).json({error:e.status?e.message:'Kariyer sunucusu/veritabanı erişilemiyor. Tekrar dene.'})}finally{client?.release()}})}
module.exports={attachFootball,publicRooms,createPartyRoom,create,operate,summary,baseScores,advance,passwordHash,verifyPassword,claimPlayer,accountPlayer};
