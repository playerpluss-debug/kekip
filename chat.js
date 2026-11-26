'use strict';
const crypto=require('crypto');
const {json}=require('express');
const accounts=require('./accounts');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
let init;const rate=new Map();
async function schema(db){if(!init)init=(async()=>{
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_chat_messages(id bigserial PRIMARY KEY, channel text NOT NULL, sender_id text NOT NULL REFERENCES kekip_football_accounts(id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz)`);
 await db.query('CREATE INDEX IF NOT EXISTS kekip_chat_channel ON kekip_chat_messages(channel,id)');
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_chat_reads(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,channel text NOT NULL,last_id bigint NOT NULL,PRIMARY KEY(account_id,channel))`);
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_chat_mutes(account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now())`);
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_notification_state(account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, data jsonb NOT NULL)`);

})().catch(e=>{init=null;throw e});await init;}
function limit(key,ms,n){const now=Date.now();for(const [k,v] of rate)if(v.until<=now)rate.delete(k);const r=rate.get(key)||{n:0,until:now+ms};if(r.n>=n||rate.size>10000)fail('Çok sık işlem yapıyorsun. Biraz bekle.',429);r.n++;rate.set(key,r)}
const dm=(a,b)=>'dm:'+JSON.stringify([a,b].sort());
async function channels(db,a,b,options){const q=await db.query(`SELECT u.id,u.username FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' AND u.blocked_at IS NULL ORDER BY u.username`,[a.id]);const list=[{key:'general',label:'Genel sohbet',kind:'general'},...q.rows.map(u=>({key:dm(a.id,u.id),label:'@'+u.username,kind:'dm'}))];
 const room=b.room;if(room&&typeof room==='object'&&typeof room.code==='string'){
 if(room.game==='battleship'&&/^[A-Z2-9]{5}$/.test(room.code)){const r=options.battleRoom(room.code,a.id);if(r)list.push({key:'room:battleship:'+r,label:'Amiral Battı odası',kind:'room'});}
 if(room.game==='football'&&/^[A-F0-9]{10}$/.test(room.code)){const q=await db.query('SELECT data FROM kekip_football_rooms WHERE code=$1',[room.code]);if(q.rows[0]?.data?.players?.some(p=>p.accountId===a.id))list.push({key:'room:football:'+room.code,label:'Futbol Kariyer odası',kind:'room'});}
 }return list;}
const messageSQL=`SELECT m.id::text AS id,a.username,m.channel,m.body,m.created_at,m.deleted_at,ce.item_id AS cosmetic_chat,ne.item_id AS cosmetic_name FROM kekip_chat_messages m JOIN kekip_football_accounts a ON a.id=m.sender_id LEFT JOIN kekip_cosmetic_equipped ce ON ce.account_id=m.sender_id AND ce.slot='chat' LEFT JOIN kekip_cosmetic_equipped ne ON ne.account_id=m.sender_id AND ne.slot='name'`;
function id(v){if(typeof v!=='string'||!/^\d{1,18}$/.test(v))fail('Mesaj numarası geçersiz.');return v}
async function member(db,a,action,b,options){const list=await channels(db,a,b,options);const mute=await db.query('SELECT 1 FROM kekip_chat_mutes WHERE account_id=$1',[a.id]);const muted=!!mute.rows.length;
 if(action==='inbox'){const q=await db.query(`SELECT m.channel,count(*)::int AS unread FROM kekip_chat_messages m LEFT JOIN kekip_chat_reads r ON r.account_id=$1 AND r.channel=m.channel WHERE m.channel=ANY($2::text[]) AND m.id>COALESCE(r.last_id,0) AND m.sender_id<>$1 AND m.deleted_at IS NULL GROUP BY m.channel`,[a.id,list.map(x=>x.key)]);const counts=new Map(q.rows.map(x=>[x.channel,x.unread]));return {username:a.username,muted,channels:list.map(x=>({...x,unread:counts.get(x.key)||0}))};}
 const key=list.find(x=>x.key===b.channel)?.key;if(!key)fail('Bu sohbete erişim iznin yok.',403);
 if(action==='history'){const before=b.before===undefined?null:id(b.before);const q=await db.query(messageSQL+` WHERE m.channel=$1 AND ($2::bigint IS NULL OR m.id<$2) ORDER BY m.id DESC LIMIT 50`,[key,before]);return {messages:q.rows.reverse(),muted};}
 if(action==='read'){const last=id(b.last);await db.query(`INSERT INTO kekip_chat_reads(account_id,channel,last_id) SELECT $1,$2,id FROM kekip_chat_messages WHERE channel=$2 AND id=$3 ON CONFLICT(account_id,channel) DO UPDATE SET last_id=GREATEST(kekip_chat_reads.last_id,EXCLUDED.last_id)`,[a.id,key,last]);return {ok:true};}
 if(action==='send'){if(muted)fail('Sohbet gönderme yetkin yönetici tarafından kapatıldı.',403);const text=typeof b.text==='string'?b.text.trim():'';if(!text||text.length>500||/\u0000/.test(text))fail('Mesaj 1–500 karakter olmalı.');limit('send:'+a.id,10000,5);const q=await db.query(`INSERT INTO kekip_chat_messages(channel,sender_id,body) SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM kekip_chat_mutes WHERE account_id=$2) RETURNING id::text`,[key,a.id,text]);if(!q.rows.length)fail('Sohbet gönderme yetkin kapatıldı.',403);return {ok:true,id:q.rows[0].id};}fail('İşlem bulunamadı.',404);}
// 0.51.6.4: progression events and an account-scoped archive of observed live increases.
// Archive acknowledgements never change the underlying messages, invitations or requests.
function mergeHistory(previous,counts,now=new Date().toISOString(),observedAt=Date.now()){
 if(Number(previous.historyObservedAt)>observedAt)return {history:previous.history||[],historyCounts:previous.historyCounts,historyObservedAt:previous.historyObservedAt};
 const old=previous.historyCounts||null,history=Array.isArray(previous.history)?previous.history.slice():[];
 const definitions={requests:['users','social','Arkadaşlık isteği'],invites:['game','social','Oyun daveti'],chat:['message','messages','Oyun sohbeti mesajı'],direct:['message','messages','Özel mesaj']};
 if(old)for(const [key,[kind,category,label]] of Object.entries(definitions)){
  const delta=Math.max(0,counts[key]-(Number(old[key])||0));
  if(delta)history.unshift({id:crypto.randomUUID(),kind,category,title:label,detail:delta+' yeni bildirim algılandı.',at:now,read:false});
 }
 return {history:history.slice(0,100),historyCounts:counts,historyObservedAt:observedAt};
}
function mergeProgress(previous,stats,now=new Date().toISOString()){
 const level=stats.progress.level,earned=stats.achievements.filter(x=>x.unlocked);
 if(!previous)return {level,earned:earned.map(x=>x.id),events:[]};
 const next={level:Math.max(previous.level,level),earned:[...new Set([...previous.earned,...earned.map(x=>x.id)])],events:[...previous.events]};
 const add=(kind,title,detail)=>next.events.unshift({id:crypto.randomUUID(),kind,title,detail,at:now,read:false});
 if(level>previous.level)add('level','Seviye '+level+'!','KEKIP hesabın yeni seviyeye ulaştı.');
 for(const a of earned)if(!previous.earned.includes(a.id))add('badge','Yeni rozet: '+a.name,a.description);
 next.events=next.events.slice(0,50);return next;
}
async function progressNotifications(db,a,readIds,counts=null,observedAt=Date.now()){
 // Compute the current progress outside the lock, then merge monotonically under a row lock.
 const stats=readIds===null?await accounts.profileStats(db,a):null;
 const c=await db.connect();try{await c.query('BEGIN');
 if(stats)await c.query('INSERT INTO kekip_notification_state(account_id,data) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[a.id,JSON.stringify({...mergeProgress(null,stats),...mergeHistory({},counts,undefined,observedAt)})]);
 const q=await c.query('SELECT data FROM kekip_notification_state WHERE account_id=$1 FOR UPDATE',[a.id]);
 const previous=q.rows[0]?.data;if(!previous){await c.query('COMMIT');return {events:[],history:[]};}
 const readSet=new Set(readIds||[]);const acknowledge=e=>readSet.has(e.id)&&!e.read?{...e,read:true}:e;
 const next=stats?{...previous,...mergeProgress(previous,stats),...mergeHistory(previous,counts,undefined,observedAt)}:{...previous,events:previous.events.map(acknowledge),history:(previous.history||[]).map(acknowledge)};
 if(JSON.stringify(previous)!==JSON.stringify(next))await c.query('UPDATE kekip_notification_state SET data=$2::jsonb WHERE account_id=$1',[a.id,JSON.stringify(next)]);
 await c.query('COMMIT');return {events:next.events,history:next.history||[]};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
}
async function notifications(db,a,action,b,options){
 if(action==='notifications-read'){
  if(!Array.isArray(b.ids)||b.ids.length>150||b.ids.some(x=>typeof x!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x)))fail('Bildirim numarası geçersiz.');
  return {username:a.username,...await progressNotifications(db,a,b.ids)};
 }
 const observedAt=Date.now();
 const list=await channels(db,a,{},options);
 const [f,i,m,d]=await Promise.all([
  db.query(`SELECT u.username FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=f.requested_by WHERE (f.low_id=$1 OR f.high_id=$1) AND f.requested_by<>$1 AND f.status='pending' AND u.blocked_at IS NULL ORDER BY f.created_at DESC`,[a.id]),
  db.query(`SELECT u.username AS sender,i.game FROM kekip_social_invites i JOIN kekip_football_accounts u ON u.id=i.sender_id JOIN kekip_friendships f ON f.low_id=LEAST(i.sender_id,i.receiver_id) AND f.high_id=GREATEST(i.sender_id,i.receiver_id) AND f.status='accepted' WHERE i.receiver_id=$1 AND i.status='pending' AND i.expires_at>now() AND u.blocked_at IS NULL ORDER BY i.created_at DESC LIMIT 30`,[a.id]),
  db.query(`SELECT count(*)::int AS unread FROM kekip_chat_messages m LEFT JOIN kekip_chat_reads r ON r.account_id=$1 AND r.channel=m.channel WHERE m.channel=ANY($2::text[]) AND m.id>COALESCE(r.last_id,0) AND m.sender_id<>$1 AND m.deleted_at IS NULL`,[a.id,list.map(x=>x.key)]),
  db.query(`SELECT count(*) AS n FROM kekip_direct_messages d JOIN kekip_friendships f ON f.low_id=d.low_id AND f.high_id=d.high_id AND f.status='accepted' JOIN kekip_football_accounts u ON u.id=d.sender_id AND u.blocked_at IS NULL WHERE d.receiver_id=$1 AND d.read_at IS NULL`,[a.id])
 ]);
 const counts={requests:f.rows.length,invites:i.rows.length,chat:Number(m.rows[0]?.unread||0),direct:Number(d.rows[0]?.n||0)};
 const archive=await progressNotifications(db,a,null,counts,observedAt);
 return {username:a.username,requests:counts.requests,requestNames:f.rows.slice(0,5).map(x=>x.username),invites:i.rows,unreadMessages:counts.chat,directUnread:counts.direct,...archive};
}
async function moderation(db,action,b){if(action==='admin-list'){const q=await db.query(messageSQL+` WHERE (m.channel='general' OR m.channel LIKE 'room:%') ORDER BY m.id DESC LIMIT 100`);const m=await db.query(`SELECT a.username FROM kekip_chat_mutes m JOIN kekip_football_accounts a ON a.id=m.account_id ORDER BY a.username`);return {messages:q.rows,mutes:m.rows};}
 if(action==='admin-delete'){const q=await db.query(`WITH changed AS (UPDATE kekip_chat_messages SET body='',deleted_at=now() WHERE id=$1 AND (channel='general' OR channel LIKE 'room:%') AND deleted_at IS NULL RETURNING sender_id) INSERT INTO kekip_admin_audit(username,action) SELECT a.username,'admin-delete' FROM changed c JOIN kekip_football_accounts a ON a.id=c.sender_id RETURNING id`,[id(b.id)]);if(!q.rows.length)fail('Mesaj bulunamadı veya zaten silindi.',404);return {ok:true};}
 if(action==='admin-mute'||action==='admin-unmute'){if(typeof b.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(b.username))fail('Kullanıcı adı geçersiz.');const q=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1',[b.username]);if(!q.rows.length)fail('Üye bulunamadı.',404);if(action==='admin-mute')await db.query(`WITH changed AS (INSERT INTO kekip_chat_mutes(account_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING account_id) INSERT INTO kekip_admin_audit(username,action) SELECT $2,'admin-mute' FROM changed`,[q.rows[0].id,b.username]);else await db.query(`WITH changed AS (DELETE FROM kekip_chat_mutes WHERE account_id=$1 RETURNING account_id) INSERT INTO kekip_admin_audit(username,action) SELECT $2,'admin-unmute' FROM changed`,[q.rows[0].id,b.username]);return {ok:true};}fail('İşlem bulunamadı.',404);}
function attachChat(app,options){app.post('/api/chat/:action',json({limit:'8kb'}),async(req,res)=>{res.set('Cache-Control','no-store');try{accounts.safeRequest(req);const b=req.body||{},action=req.params.action;const db=await accounts.database();if(action.startsWith('admin-')){limit('admin:'+req.ip,60000,60);accounts.requireAdmin(req,b);await schema(db);return res.json(await moderation(db,action,b));}const a=await accounts.requireAccount(db,req);await schema(db);if(action==='notifications'||action==='notifications-read'){limit('notify:'+a.id,60000,30);return res.json(await notifications(db,a,action,b,options));}return res.json(await member(db,a,action,b,options));}catch(e){if(!e.status)console.error('Chat:',e.code||e.message);res.status(e.status||503).json({error:e.status?e.message:'Sohbet bağlantısı kurulamadı. Tekrar dene.'})}})}
module.exports={attachChat,mergeProgress,mergeHistory};
