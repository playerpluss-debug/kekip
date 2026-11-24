'use strict';
const crypto=require('crypto');
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const token=()=>crypto.randomBytes(24).toString('hex');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
let pool,init;const attempts=new Map();let inFlight=0;
const scrypt=(password,salt)=>new Promise((resolve,reject)=>crypto.scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024},(e,k)=>e?reject(e):resolve(k)));
async function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+(await scrypt(password,salt)).toString('hex')}
async function verifyPassword(password,stored){const [salt,digest]=stored.split(':');const candidate=await scrypt(password,salt);const expected=Buffer.from(digest,'hex');return expected.length===candidate.length&&crypto.timingSafeEqual(candidate,expected)}
const sessionCookie='kekip_session';
function sessionToken(req){const found=(req.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(sessionCookie+'='));const value=found?.slice(sessionCookie.length+1)||'';return /^[a-f0-9]{48}$/.test(value)?value:null;}
function cookie(res,req,value,age){const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('Host')||'');res.append('Set-Cookie',`${sessionCookie}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local?'':'; Secure'}`)}
async function getAccount(db,req){const t=sessionToken(req);if(!t)return null;const q=await db.query('SELECT a.id,a.username FROM kekip_football_sessions s JOIN kekip_football_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(t)]);return q.rows[0]||null}
const requireAccount=async(db,req)=>{const a=await getAccount(db,req);if(!a)fail('Önce hesabına giriş yap.',401);return a};
async function database(){if(!process.env.DATABASE_URL)fail('Çevrimiçi kariyer için DATABASE_URL henüz ayarlanmadı.',503);if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:10000,enableChannelBinding:true});}if(!init)init=(async()=>{await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_rooms (code text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_accounts (id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_game_results (game text NOT NULL, match_id text NOT NULL, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(game,match_id,account_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_player_profiles (account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, data jsonb NOT NULL DEFAULT '{}'::jsonb)`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_friendships (low_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, high_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, requested_by text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(low_id,high_id), CHECK(low_id<>high_id), CHECK(requested_by IN (low_id,high_id)))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_friendships_high ON kekip_friendships(high_id)');await pool.query('CREATE INDEX IF NOT EXISTS kekip_game_results_account ON kekip_game_results(account_id,game)');await pool.query('CREATE INDEX IF NOT EXISTS kekip_game_results_date ON kekip_game_results(created_at,game)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_registration_invites (id text PRIMARY KEY, username text NOT NULL, code_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz)`);})().catch(e=>{init=null;throw e});await init;return pool;}
function throttle(req,name){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const ip=(req.get('X-Forwarded-For')||req.ip||'unknown').split(',').pop().trim();for(const [key,limit] of [['ip:'+ip,30],['user:'+name,8]]){let v=attempts.get(key)||{n:0,until:now+10*60*1000};if(v.n>=limit||attempts.size>10000)fail('Çok fazla deneme. Birkaç dakika sonra tekrar dene.',429);v.n++;attempts.set(key,v)}}
const json=require('express').json;
function safeRequest(req){if(!req.is('application/json'))fail('JSON isteği gerekli.',415);const origin=req.get('Origin');if(origin){let u;try{u=new URL(origin)}catch{fail('İstek kaynağı geçersiz.',403)}if(u.host!==req.get('Host'))fail('İstek kaynağı geçersiz.',403)}}

function clearLegacy(res,req){const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('Host')||'');res.append('Set-Cookie',`kekip_football_session=; Path=/api/football; HttpOnly; SameSite=Strict; Max-Age=0${local?'':'; Secure'}`)}
async function socketAccount(socket){const req={get:key=>socket.request.headers[key.toLowerCase()]};if(!sessionToken(req))return null;return getAccount(await database(),req)}
// Internal server-only interface for future game modules. Never accepts game results directly from browsers.
async function recordGameResults(game,matchId,rows,transaction=null){if(!/^[a-z0-9_-]{1,40}$/.test(game)||typeof matchId!=='string'||!matchId||matchId.length>100)throw Error('Invalid game/match identifier');if(!rows.length)return;const db=transaction||await database();const values=[],params=[];for(const row of rows){const i=params.length;values.push(`($${i+1},$${i+2},$${i+3},$${i+4}::jsonb)`);params.push(game,matchId,row.accountId,JSON.stringify(row.result));}await db.query(`INSERT INTO kekip_game_results(game,match_id,account_id,result) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`,params)}
async function recordBattle(matchId,players,winner){return recordGameResults('battleship',matchId,players.filter(p=>p.accountId).map(p=>({accountId:p.accountId,result:{win:p.id===winner,shots:p.shots.length,hits:p.shots.filter(s=>s.hit).length,shipsSunk:players.find(q=>q.id!==p.id)?.sunk.length||0}})))}
async function profileStats(db,a){const rows=await db.query('SELECT result FROM kekip_game_results WHERE account_id=$1 AND game=$2',[a.id,'battleship']);const battle={games:0,wins:0,losses:0,shots:0,hits:0,shipsSunk:0};for(const {result:r} of rows.rows){battle.games++;battle[r.win===true?'wins':'losses']++;battle.shots+=statNumber(r.shots);battle.hits+=statNumber(r.hits);battle.shipsSunk+=statNumber(r.shipsSunk)}const q=await db.query('SELECT code,data FROM kekip_football_rooms WHERE data @> $1::jsonb',[JSON.stringify({players:[{accountId:a.id}]})]);const football={careers:0,games:0,goals:0,assists:0};for(const row of q.rows){for(const p of row.data.players.filter(p=>p.accountId===a.id)){football.careers++;football.games+=statNumber(p.save?.games);football.goals+=statNumber(p.save?.goals);football.assists+=statNumber(p.save?.assists);}}return withProgress(battle,football)}
// Read-only member leaderboard. Numeric values are sanitized and no private account or career identifiers leave the server.
function statNumber(v){const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:0;}
// Platform XP is derived from persisted match/career aggregates, not a client-submitted XP value.
// To integrate another game, add its verified persisted stats and contribution here.
function accountProgress(battle,football){
  const battleXp=statNumber(battle.games)*20+Math.min(statNumber(battle.wins),statNumber(battle.games))*10;
  const footballXp=statNumber(football.games)*20+statNumber(football.goals)*5+statNumber(football.assists)*5;
  const xp=Math.min(Number.MAX_SAFE_INTEGER,battleXp+footballXp);
  // Level 1 starts at 0. Cost to advance: 100, 125, 150, ...
  const threshold=n=>100*n+25*n*(n-1)/2;
  let n=Math.max(0,Math.floor((Math.sqrt(87.5**2+50*xp)-87.5)/25));
  while(n>0&&threshold(n)>xp)n--;
  while(threshold(n+1)<=xp)n++;
  const level=n+1, levelXp=xp-threshold(n), nextLevelXp=100+25*n;
  return {xp,level,levelXp,nextLevelXp,remainingXp:nextLevelXp-levelXp,percent:Math.floor(100*levelXp/nextLevelXp),battleXp,footballXp};
}
// Central achievement registry. Add future games by extending verified stats and this registry.
const ACHIEVEMENTS = [
  {id:'first_match',name:'İlk Adım',icon:'🎮',group:'Genel',rarity:'normal',target:1,description:'İlk kayıtlı maçını tamamla.',value:s=>s.battle.games+s.football.games},
  {id:'first_win',name:'Zaferin Tadı',icon:'🏆',group:'Amiral Battı',rarity:'normal',target:1,description:'Amiral Battı’da ilk galibiyetini kazan.',value:s=>s.battle.wins},
  {id:'naval_admiral',name:'Denizlerin Amirali',icon:'⚓',group:'Amiral Battı',rarity:'epic',target:25,description:'Amiral Battı’da 25 galibiyet kazan.',value:s=>s.battle.wins},
  {id:'sharpshooter',name:'Keskin Nişancı',icon:'🎯',group:'Amiral Battı',rarity:'rare',target:100,description:'Amiral Battı’da 100 isabetli atış yap.',value:s=>s.battle.hits},
  {id:'goal_machine',name:'Gol Makinesi',icon:'⚽',group:'Futbol Kariyer',rarity:'epic',target:50,description:'Futbol Kariyer’de 50 gol at.',value:s=>s.football.goals},
  {id:'playmaker',name:'Oyun Kurucu',icon:'👟',group:'Futbol Kariyer',rarity:'rare',target:25,description:'Futbol Kariyer’de 25 asist yap.',value:s=>s.football.assists},
  {id:'game_fan',name:'Oyun Tutkunu',icon:'🔥',group:'Genel',rarity:'legendary',target:100,description:'Toplam 100 kayıtlı maç tamamla.',value:s=>s.battle.games+s.football.games},
  {id:'kekip_legend',name:'KEKIP Efsanesi',icon:'💎',group:'Genel',rarity:'mythic',target:50,description:'KEKIP hesabında 50. seviyeye ulaş.',value:s=>s.progress.level}
];
function accountAchievements(stats){
  return ACHIEVEMENTS.map(({value,...definition})=>{
    const current=Math.min(definition.target,statNumber(value(stats)));
    return {...definition,current,unlocked:current>=definition.target};
  });
}
function withProgress(battle,football){const stats={battle,football,progress:accountProgress(battle,football)};return {...stats,achievements:accountAchievements(stats)};}

async function leaderboardStats(db, viewer){
  const q=await db.query(`WITH battle AS (
    SELECT account_id, count(*) AS games,
      count(*) FILTER (WHERE result->'win' = 'true'::jsonb) AS wins,
      sum(CASE WHEN (result->>'shots') ~ '^[0-9]{1,9}$' THEN (result->>'shots')::bigint ELSE 0 END) AS shots,
      sum(CASE WHEN (result->>'hits') ~ '^[0-9]{1,9}$' THEN (result->>'hits')::bigint ELSE 0 END) AS hits,
      sum(CASE WHEN (result->>'shipsSunk') ~ '^[0-9]{1,9}$' THEN (result->>'shipsSunk')::bigint ELSE 0 END) AS ships_sunk
    FROM kekip_game_results WHERE game='battleship' GROUP BY account_id
  ), football AS (
    SELECT p->>'accountId' AS account_id, count(*) AS careers,
      sum(CASE WHEN (p->'save'->>'games') ~ '^[0-9]{1,9}$' THEN (p->'save'->>'games')::bigint ELSE 0 END) AS games,
      sum(CASE WHEN (p->'save'->>'goals') ~ '^[0-9]{1,9}$' THEN (p->'save'->>'goals')::bigint ELSE 0 END) AS goals,
      sum(CASE WHEN (p->'save'->>'assists') ~ '^[0-9]{1,9}$' THEN (p->'save'->>'assists')::bigint ELSE 0 END) AS assists
    FROM kekip_football_rooms r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.data->'players')='array' THEN r.data->'players' ELSE '[]'::jsonb END) AS players(p)
    WHERE p->>'accountId' IS NOT NULL GROUP BY p->>'accountId'
  ) SELECT a.username, b.games AS battle_games, b.wins, b.shots, b.hits, b.ships_sunk,
    f.careers, f.games AS football_games, f.goals, f.assists
    FROM kekip_football_accounts a LEFT JOIN battle b ON b.account_id=a.id LEFT JOIN football f ON f.account_id=a.id
    ORDER BY a.username`);
  return {viewer:viewer.username,players:q.rows.map(r=>{
    const games=statNumber(r.battle_games), wins=Math.min(games,statNumber(r.wins)), shots=statNumber(r.shots), hits=Math.min(shots,statNumber(r.hits));
    const battle={games,wins,losses:games-wins,shots,hits,shipsSunk:statNumber(r.ships_sunk)},football={careers:statNumber(r.careers),games:statNumber(r.football_games),goals:statNumber(r.goals),assists:statNumber(r.assists)};
    return {username:r.username,...withProgress(battle,football)};
  })};
}
// Periodic rankings use immutable server-side match records, not room update timestamps.
async function periodLeaderboard(db){
  const q=await db.query(`WITH local_clock AS (SELECT now() AT TIME ZONE 'Europe/Istanbul' AS t),
  local_bounds AS (SELECT 'week'::text AS period, date_trunc('week',t) AS start_local, date_trunc('week',t)+interval '1 week' AS end_local FROM local_clock
    UNION ALL SELECT 'month',date_trunc('month',t),date_trunc('month',t)+interval '1 month' FROM local_clock),
  bounds AS (SELECT period,start_local AT TIME ZONE 'Europe/Istanbul' AS starts_at,end_local AT TIME ZONE 'Europe/Istanbul' AS ends_at FROM local_bounds),
  totals AS (SELECT b.period,r.account_id,r.game,count(*) AS games,
    count(*) FILTER (WHERE r.result->'win'='true'::jsonb) AS wins,
    sum(CASE WHEN (r.result->>'shots') ~ '^[0-9]{1,9}$' THEN (r.result->>'shots')::bigint ELSE 0 END) AS shots,
    sum(CASE WHEN (r.result->>'hits') ~ '^[0-9]{1,9}$' THEN (r.result->>'hits')::bigint ELSE 0 END) AS hits,
    sum(CASE WHEN (r.result->>'shipsSunk') ~ '^[0-9]{1,9}$' THEN (r.result->>'shipsSunk')::bigint ELSE 0 END) AS ships_sunk,
    sum(CASE WHEN (r.result->>'goals') ~ '^[0-9]{1,9}$' THEN (r.result->>'goals')::bigint ELSE 0 END) AS goals,
    sum(CASE WHEN (r.result->>'assists') ~ '^[0-9]{1,9}$' THEN (r.result->>'assists')::bigint ELSE 0 END) AS assists
    FROM bounds b JOIN kekip_game_results r ON r.created_at>=b.starts_at AND r.created_at<b.ends_at AND r.created_at<=now()
    WHERE r.game IN ('battleship','football') GROUP BY b.period,r.account_id,r.game)
  SELECT b.period,b.starts_at,b.ends_at,a.username,t.game,t.games,t.wins,t.shots,t.hits,t.ships_sunk,t.goals,t.assists
  FROM bounds b LEFT JOIN totals t ON t.period=b.period LEFT JOIN kekip_football_accounts a ON a.id=t.account_id
  ORDER BY b.period,a.username,t.game`);
  const periods={};
  for(const r of q.rows){
    const period=periods[r.period]||(periods[r.period]={start:r.starts_at,end:r.ends_at,players:[],byName:new Map()});
    if(!r.username)continue;
    let p=period.byName.get(r.username);
    if(!p){p={username:r.username,battle:{games:0,wins:0,losses:0,shots:0,hits:0,shipsSunk:0},football:{games:0,goals:0,assists:0,careers:0}};period.byName.set(r.username,p);period.players.push(p)}
    const games=statNumber(r.games);
    if(r.game==='battleship'){const wins=Math.min(games,statNumber(r.wins)),shots=statNumber(r.shots);p.battle={games,wins,losses:games-wins,shots,hits:Math.min(shots,statNumber(r.hits)),shipsSunk:statNumber(r.ships_sunk)}}
    if(r.game==='football')Object.assign(p.football,{games,goals:statNumber(r.goals),assists:statNumber(r.assists)});
  }
  for(const p of Object.values(periods)){delete p.byName;for(const player of p.players){const x=accountProgress(player.battle,player.football);player.periodXp=x.xp;}}
  return periods;
}
// Administrator key is configured only in the hosting environment, never in client files.
function requireAdmin(req,b){const expected=process.env.KEKIP_ADMIN_KEY||'';if(expected.length<32)fail('Yönetici anahtarı sunucuda henüz ayarlanmadı.',503);const supplied=typeof b.adminKey==='string'?b.adminKey:'';if(supplied.length>256||!crypto.timingSafeEqual(Buffer.from(hash(supplied),'hex'),Buffer.from(hash(expected),'hex'))){throttle(req,'admin-access');fail('Yönetici anahtarı geçersiz.',403)}}
async function inviteAction(db,req,action,b){requireAdmin(req,b);if(action==='invite-list'){const q=await db.query('SELECT id,username,created_at,expires_at,used_at,revoked_at FROM kekip_registration_invites ORDER BY created_at DESC LIMIT 200');return {invites:q.rows};}if(action==='invite-create'){const name=typeof b.username==='string'?b.username.trim().toLowerCase():'';if(!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı 3–24 harf/rakam/alt çizgi olmalı.');const existing=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1',[name]);if(existing.rows.length)fail('Bu kullanıcı zaten kayıtlı.',409);const code=token(),id=crypto.randomBytes(12).toString('hex');await db.query("INSERT INTO kekip_registration_invites(id,username,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[id,name,hash(code)]);return {username:name,code};}if(action==='invite-revoke'){if(typeof b.id!=='string'||!/^[a-f0-9]{24}$/.test(b.id))fail('Davet geçersiz.');const q=await db.query('UPDATE kekip_registration_invites SET revoked_at=now() WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id',[b.id]);if(!q.rows.length)fail('Davet zaten kullanılmış veya iptal edilmiş.',409);return {ok:true};}fail('İşlem bulunamadı.',404)}

// Shared platform profile: private writes, member-only reads, no remote image URLs.
const PROFILE_COVERS=['violet','midnight','ocean','ember','forest','aurora'];
function profilePhoto(v){if(v==='')return '';if(typeof v!=='string'||v.length>44000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v))fail('Profil fotoğrafı geçersiz.');const encoded=v.slice(23),buf=Buffer.from(encoded,'base64');if(buf.length<12||buf.length>32768||buf.toString('base64')!==encoded||buf[0]!==255||buf[1]!==216||buf[buf.length-2]!==255||buf[buf.length-1]!==217)fail('Profil fotoğrafı geçersiz veya çok büyük.');return v}
function cleanProfile(b,stats){
 if(!b||typeof b!=='object'||Array.isArray(b))fail('Profil bilgileri geçersiz.');
 if(typeof b.bio!=='string'||b.bio.length>160)fail('Biyografi en fazla 160 karakter olabilir.');
 if(!PROFILE_COVERS.includes(b.cover))fail('Kapak teması geçersiz.');
 const earned=new Set(stats.achievements.filter(a=>a.unlocked).map(a=>a.id));
 if(typeof b.title!=='string'||(b.title!==''&&!earned.has(b.title)))fail('Bu unvan henüz kazanılmadı.');
 if(!Array.isArray(b.featured)||b.featured.length>3||new Set(b.featured).size!==b.featured.length||b.featured.some(x=>typeof x!=='string'||!earned.has(x)))fail('En fazla 3 kazanılmış rozet seçebilirsin.');
 return {bio:b.bio.trim(),cover:b.cover,title:b.title,featured:b.featured,photo:profilePhoto(b.photo)};
}
async function readPlayerProfile(db,username){
 const q=await db.query('SELECT a.username,p.data FROM kekip_football_accounts a LEFT JOIN kekip_player_profiles p ON p.account_id=a.id WHERE a.username=$1',[username]);
 if(!q.rows.length)fail('Oyuncu bulunamadı.',404);
 const d=q.rows[0].data||{};
 return {username:q.rows[0].username,profile:{bio:d.bio||'',cover:d.cover||'violet',title:d.title||'',featured:d.featured||[],photo:d.photo||''}};
}
async function savePlayerProfile(db,a,b){const data=cleanProfile(b,await profileStats(db,a));await db.query('INSERT INTO kekip_player_profiles(account_id,data) VALUES($1,$2::jsonb) ON CONFLICT(account_id) DO UPDATE SET data=EXCLUDED.data',[a.id,JSON.stringify(data)]);return {username:a.username,profile:data};}

// One canonical row per pair; only the receiver may accept/reject a pending request.
async function friendAction(db,a,action,b){
 const state=r=>!r.status?'none':r.status==='accepted'?'friend':r.requested_by===a.id?'outgoing':'incoming';
 const publicRow=r=>({username:r.username,state:state(r)});
 if(action==='friends-list'){
  const q=await db.query(`SELECT u.username,f.status,f.requested_by FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END WHERE f.low_id=$1 OR f.high_id=$1 ORDER BY u.username`,[a.id]);
  return {username:a.username,people:q.rows.map(publicRow)};
 }
 if(action==='friends-search'){
  const term=typeof b.query==='string'?b.query.trim().toLowerCase():'';
  if(!/^[a-z0-9_]{2,24}$/.test(term))fail('Aramak için en az 2 harf veya rakam yaz.');
  const q=await db.query(`SELECT u.username,f.status,f.requested_by FROM kekip_football_accounts u LEFT JOIN kekip_friendships f ON ((f.low_id=$1 AND f.high_id=u.id) OR (f.high_id=$1 AND f.low_id=u.id)) WHERE u.id<>$1 AND strpos(u.username,$2)>0 ORDER BY (u.username=$2) DESC,u.username LIMIT 30`,[a.id,term]);
  return {people:q.rows.map(publicRow)};
 }
 const name=typeof b.username==='string'?b.username.trim().toLowerCase():'';
 if(!/^[a-z0-9_]{3,24}$/.test(name)||name===a.username)fail('Geçerli başka bir oyuncu seç.');
 const q=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1',[name]);
 if(!q.rows.length)fail('Oyuncu bulunamadı.',404);
 const [low,high]=[a.id,q.rows[0].id].sort();
 let result;
 if(action==='friends-request')result=await db.query(`INSERT INTO kekip_friendships(low_id,high_id,requested_by) VALUES($1,$2,$3) ON CONFLICT(low_id,high_id) DO NOTHING RETURNING status`,[low,high,a.id]);
 else if(action==='friends-accept')result=await db.query(`UPDATE kekip_friendships SET status='accepted',updated_at=now() WHERE low_id=$1 AND high_id=$2 AND requested_by<>$3 AND status='pending' RETURNING status`,[low,high,a.id]);
 else if(action==='friends-reject')result=await db.query(`DELETE FROM kekip_friendships WHERE low_id=$1 AND high_id=$2 AND requested_by<>$3 AND status='pending' RETURNING status`,[low,high,a.id]);
 else if(action==='friends-cancel')result=await db.query(`DELETE FROM kekip_friendships WHERE low_id=$1 AND high_id=$2 AND requested_by=$3 AND status='pending' RETURNING status`,[low,high,a.id]);
 else if(action==='friends-remove')result=await db.query(`DELETE FROM kekip_friendships WHERE low_id=$1 AND high_id=$2 AND status='accepted' RETURNING status`,[low,high]);
 else fail('İşlem bulunamadı.',404);
 if(!result.rows.length)fail('Arkadaşlık durumu değişmiş. Listeyi yenile ve tekrar dene.',409);
 return {ok:true};
}

function attachAccounts(app){app.post(['/api/account/:action','/api/football/account/:action'],(req,res,next)=>json({limit:req.params.action==='profile-save'?'64kb':'16kb'})(req,res,next),async(req,res,next)=>{const action=req.params.action;if(req.path.startsWith('/api/football/')&&['list','claim'].includes(action))return next();res.set('Cache-Control','no-store');try{safeRequest(req);const b=req.body||{};if(action==='me'&&!sessionToken(req))return res.json({user:null});const db=await database();
if(['invite-list','invite-create','invite-revoke'].includes(action))return res.json(await inviteAction(db,req,action,b));
if(action==='me'){const a=await getAccount(db,req);return res.json({user:a?{username:a.username}:null})}
if(action==='logout'){const t=sessionToken(req);if(t)await db.query('DELETE FROM kekip_football_sessions WHERE token_hash=$1',[hash(t)]);cookie(res,req,'',0);clearLegacy(res,req);return res.json({ok:true})}
if(action==='register'||action==='login'){const name=typeof b.username==='string'?b.username.trim().toLowerCase():'',password=b.password;if(!/^[a-z0-9_]{3,24}$/.test(name)||typeof password!=='string'||password.length<10||password.length>128)fail('Kullanıcı adı 3–24 harf/rakam/alt çizgi, şifre 10–128 karakter olmalı.');throttle(req,name);if(inFlight>=4)fail('Sunucu yoğun. Biraz sonra tekrar dene.',429);let a;inFlight++;try{if(action==='register'){const code=typeof b.inviteCode==='string'?b.inviteCode.trim().toLowerCase():'';if(!/^[a-f0-9]{48}$/.test(code))fail('Üyelik davetlidir. Yönetici tarafından verilen davet kodunu gir.',403);const id=token(),digest=await passwordHash(password);let q;try{q=await db.query(`WITH claimed AS (UPDATE kekip_registration_invites SET used_at=now() WHERE username=$2 AND code_hash=$4 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id) INSERT INTO kekip_football_accounts(id,username,password_hash) SELECT $1,$2,$3 FROM claimed RETURNING id,username`,[id,name,digest,hash(code)])}catch(e){if(e.code==='23505')fail('Bu kullanıcı adı alınmış.',409);throw e}if(!q.rows.length)fail('Davet geçersiz, kullanılmış, iptal edilmiş, süresi dolmuş veya bu kullanıcı adına ait değil.',403);a=q.rows[0]}else{const q=await db.query('SELECT id,username,password_hash FROM kekip_football_accounts WHERE username=$1',[name]);a=q.rows[0];const ok=await verifyPassword(password,a?.password_hash||('0'.repeat(32)+':'+ '0'.repeat(128)));if(!a||!ok)fail('Kullanıcı adı veya şifre yanlış.',401)}}finally{inFlight--}const t=token(),old=sessionToken(req);if(old)await db.query('DELETE FROM kekip_football_sessions WHERE token_hash=$1',[hash(old)]);await db.query('DELETE FROM kekip_football_sessions WHERE expires_at<=now()');await db.query("INSERT INTO kekip_football_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash(t),a.id]);cookie(res,req,t,2592000);clearLegacy(res,req);return res.json({user:{username:a.username}})}

if(action.startsWith('friends-')){const a=await requireAccount(db,req);return res.json(await friendAction(db,a,action,b))}if(action==='profile'){const a=await requireAccount(db,req);const name=b.username===undefined?a.username:b.username;if(typeof name!=='string'||!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı geçersiz.');return res.json(await readPlayerProfile(db,name))}if(action==='profile-save'){const a=await requireAccount(db,req);return res.json(await savePlayerProfile(db,a,b))}if(action==='stats'){const a=await requireAccount(db,req);return res.json(await profileStats(db,a))}if(action==='leaderboard'){const a=await requireAccount(db,req);return res.json(await leaderboardStats(db,a))}if(action==='period-leaderboard'){await requireAccount(db,req);return res.json(await periodLeaderboard(db))}fail('İşlem bulunamadı.',404)}catch(e){if(!e.status)console.error('KEKIP account:',e.code||e.message);res.status(e.status||503).json({error:e.status?e.message:'Hesap sunucusuna erişilemiyor. Tekrar dene.'})}})}
module.exports={attachAccounts,database,getAccount,requireAccount,safeRequest,passwordHash,verifyPassword,socketAccount,recordBattle,recordGameResults,profileStats};
