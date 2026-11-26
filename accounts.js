'use strict';
const crypto=require('crypto');
const GeceCollection=require('./gece-catalog.json');
const Wardrobe=require('./wardrobe.js');
const GolgeCollection=require('./golge-catalog.json');
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
async function getAccount(db,req){const t=sessionToken(req);if(!t)return null;const q=await db.query('SELECT a.id,a.username FROM kekip_football_sessions s JOIN kekip_football_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.blocked_at IS NULL',[hash(t)]);return q.rows[0]||null}
const requireAccount=async(db,req)=>{const a=await getAccount(db,req);if(!a)fail('Önce hesabına giriş yap.',401);return a};
async function database(){if(!process.env.DATABASE_URL)fail('Çevrimiçi kariyer için DATABASE_URL henüz ayarlanmadı.',503);if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:10000,enableChannelBinding:true});}if(!init)init=(async()=>{await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_rooms (code text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_accounts (id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');await pool.query('ALTER TABLE kekip_football_accounts ADD COLUMN IF NOT EXISTS blocked_at timestamptz');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_admin_audit (id bigserial PRIMARY KEY, username text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_game_results (game text NOT NULL, match_id text NOT NULL, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(game,match_id,account_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_player_avatars(account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, preset_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);await pool.query(`ALTER TABLE kekip_player_avatars ADD COLUMN IF NOT EXISTS appearance jsonb NOT NULL DEFAULT '{}'::jsonb`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_modular_avatars(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,character text NOT NULL,appearance jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,character))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_avatar_outfits(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,character text NOT NULL,slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 5),name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 40),appearance jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,character,slot),CHECK(character IN ('gece','golge')))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_player_profiles (account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, data jsonb NOT NULL DEFAULT '{}'::jsonb)`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_friendships (low_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, high_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, requested_by text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(low_id,high_id), CHECK(low_id<>high_id), CHECK(requested_by IN (low_id,high_id)))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_friendships_high ON kekip_friendships(high_id)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_presence (token_hash text PRIMARY KEY REFERENCES kekip_football_sessions(token_hash) ON DELETE CASCADE, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, activity text NOT NULL CHECK(activity IN ('home','battleship','football')), seen_at timestamptz NOT NULL DEFAULT now())`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_presence_account ON kekip_presence(account_id,seen_at)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_social_invites (id text PRIMARY KEY, sender_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, receiver_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, game text NOT NULL CHECK(game IN ('battleship','football')), room_code text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, UNIQUE(sender_id,receiver_id,game,room_code), CHECK(sender_id<>receiver_id))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_social_invites_receiver ON kekip_social_invites(receiver_id,expires_at)');await pool.query('CREATE INDEX IF NOT EXISTS kekip_game_results_account ON kekip_game_results(account_id,game)');await pool.query('CREATE INDEX IF NOT EXISTS kekip_game_results_date ON kekip_game_results(created_at,game)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_mission_claims (account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, mission_id text NOT NULL, period_start date NOT NULL, xp integer NOT NULL CHECK(xp>0), claimed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,mission_id,period_start))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_mission_claims_date ON kekip_mission_claims(claimed_at)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_coin_ledger (id bigserial PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, source_kind text NOT NULL, source_id text NOT NULL, label text NOT NULL, amount integer NOT NULL CHECK(amount<>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,source_kind,source_id))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_coin_ledger_recent ON kekip_coin_ledger(account_id,id DESC)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_cosmetic_inventory(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,item_id text NOT NULL,purchased_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,item_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_cosmetic_equipped(account_id text NOT NULL,slot text NOT NULL,item_id text NOT NULL,PRIMARY KEY(account_id,slot),FOREIGN KEY(account_id,item_id) REFERENCES kekip_cosmetic_inventory(account_id,item_id) ON DELETE CASCADE)`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_registration_invites (id text PRIMARY KEY, username text NOT NULL, code_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz)`);})().catch(e=>{init=null;throw e});await init;return pool;}
function throttle(req,name){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const ip=(req.get('X-Forwarded-For')||req.ip||'unknown').split(',').pop().trim();for(const [key,limit] of [['ip:'+ip,30],['user:'+name,8]]){let v=attempts.get(key)||{n:0,until:now+10*60*1000};if(v.n>=limit||attempts.size>10000)fail('Çok fazla deneme. Birkaç dakika sonra tekrar dene.',429);v.n++;attempts.set(key,v)}}
const json=require('express').json;
function safeRequest(req){if(!req.is('application/json'))fail('JSON isteği gerekli.',415);const origin=req.get('Origin');if(origin){let u;try{u=new URL(origin)}catch{fail('İstek kaynağı geçersiz.',403)}if(u.host!==req.get('Host'))fail('İstek kaynağı geçersiz.',403)}}

function clearLegacy(res,req){const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('Host')||'');res.append('Set-Cookie',`kekip_football_session=; Path=/api/football; HttpOnly; SameSite=Strict; Max-Age=0${local?'':'; Secure'}`)}
async function socketAccount(socket){const req={get:key=>socket.request.headers[key.toLowerCase()]};if(!sessionToken(req))return null;return getAccount(await database(),req)}
// Internal server-only interface for future game modules. Never accepts game results directly from browsers.
async function recordGameResults(game,matchId,rows,transaction=null){if(!/^[a-z0-9_-]{1,40}$/.test(game)||typeof matchId!=='string'||!matchId||matchId.length>100)throw Error('Invalid game/match identifier');if(!rows.length)return;const db=transaction||await database();const values=[],params=[];for(const row of rows){const i=params.length;values.push(`($${i+1},$${i+2},$${i+3},$${i+4}::jsonb)`);params.push(game,matchId,row.accountId,JSON.stringify(row.result));}// Award only newly inserted, server-recorded results; both records share one SQL statement/transaction.
await db.query(`WITH fresh AS (INSERT INTO kekip_game_results(game,match_id,account_id,result) VALUES ${values.join(',')} ON CONFLICT DO NOTHING RETURNING game,match_id,account_id,result)
INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount)
SELECT account_id,'match',jsonb_build_array(game,match_id)::text,
 CASE WHEN game='battleship' AND result->'win'='true'::jsonb THEN 'Amiral Battı · Galibiyet' WHEN game='battleship' THEN 'Amiral Battı · Maç' WHEN game='football' THEN 'Futbol Kariyer · Maç' ELSE 'Oyun · Maç' END,
 10+CASE WHEN game='battleship' AND result->'win'='true'::jsonb THEN 5 ELSE 0 END FROM fresh WHERE true ON CONFLICT(account_id,source_kind,source_id) DO NOTHING`,params)}
async function recordBattle(matchId,players,winner){return recordGameResults('battleship',matchId,players.filter(p=>p.accountId).map(p=>({accountId:p.accountId,result:{win:p.id===winner,shots:p.shots.length,hits:p.shots.filter(s=>s.hit).length,shipsSunk:players.find(q=>q.id!==p.id)?.sunk.length||0}})))}
async function profileStats(db,a){const rows=await db.query('SELECT result FROM kekip_game_results WHERE account_id=$1 AND game=$2',[a.id,'battleship']);const battle={games:0,wins:0,losses:0,shots:0,hits:0,shipsSunk:0};for(const {result:r} of rows.rows){battle.games++;battle[r.win===true?'wins':'losses']++;battle.shots+=statNumber(r.shots);battle.hits+=statNumber(r.hits);battle.shipsSunk+=statNumber(r.shipsSunk)}const q=await db.query('SELECT code,data FROM kekip_football_rooms WHERE data @> $1::jsonb',[JSON.stringify({players:[{accountId:a.id}]})]);const football={careers:0,games:0,goals:0,assists:0};for(const row of q.rows){for(const p of row.data.players.filter(p=>p.accountId===a.id)){football.careers++;football.games+=statNumber(p.save?.games);football.goals+=statNumber(p.save?.goals);football.assists+=statNumber(p.save?.assists);}}const bonus=await db.query('SELECT COALESCE(sum(xp),0) AS xp FROM kekip_mission_claims WHERE account_id=$1',[a.id]);return withProgress(battle,football,statNumber(bonus.rows[0]?.xp))}
// Read-only member leaderboard. Numeric values are sanitized and no private account or career identifiers leave the server.
function statNumber(v){const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:0;}
// Platform XP is derived from persisted match/career aggregates, not a client-submitted XP value.
// To integrate another game, add its verified persisted stats and contribution here.
function accountProgress(battle,football,bonus=0){
  const battleXp=statNumber(battle.games)*20+Math.min(statNumber(battle.wins),statNumber(battle.games))*10;
  const footballXp=statNumber(football.games)*20+statNumber(football.goals)*5+statNumber(football.assists)*5;
  const missionXp=statNumber(bonus);const xp=Math.min(Number.MAX_SAFE_INTEGER,battleXp+footballXp+missionXp);
  // Level 1 starts at 0. Cost to advance: 100, 125, 150, ...
  const threshold=n=>100*n+25*n*(n-1)/2;
  let n=Math.max(0,Math.floor((Math.sqrt(87.5**2+50*xp)-87.5)/25));
  while(n>0&&threshold(n)>xp)n--;
  while(threshold(n+1)<=xp)n++;
  const level=n+1, levelXp=xp-threshold(n), nextLevelXp=100+25*n;
  return {xp,level,levelXp,nextLevelXp,remainingXp:nextLevelXp-levelXp,percent:Math.floor(100*levelXp/nextLevelXp),battleXp,footballXp,missionXp};
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
function withProgress(battle,football,bonus=0){const stats={battle,football,progress:accountProgress(battle,football,bonus)};return {...stats,achievements:accountAchievements(stats)};}

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
    f.careers, f.games AS football_games, f.goals, f.assists, COALESCE(m.xp,0) AS mission_xp
    FROM kekip_football_accounts a LEFT JOIN battle b ON b.account_id=a.id LEFT JOIN football f ON f.account_id=a.id LEFT JOIN (SELECT account_id,sum(xp) AS xp FROM kekip_mission_claims GROUP BY account_id) m ON m.account_id=a.id
    ORDER BY a.username`);
  return {viewer:viewer.username,players:q.rows.map(r=>{
    const games=statNumber(r.battle_games), wins=Math.min(games,statNumber(r.wins)), shots=statNumber(r.shots), hits=Math.min(shots,statNumber(r.hits));
    const battle={games,wins,losses:games-wins,shots,hits,shipsSunk:statNumber(r.ships_sunk)},football={careers:statNumber(r.careers),games:statNumber(r.football_games),goals:statNumber(r.goals),assists:statNumber(r.assists)};
    return {username:r.username,...withProgress(battle,football,statNumber(r.mission_xp))};
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
    WHERE r.game IN ('battleship','football') GROUP BY b.period,r.account_id,r.game), mission_totals AS (SELECT b.period,c.account_id,sum(c.xp) AS xp FROM bounds b JOIN kekip_mission_claims c ON c.claimed_at>=b.starts_at AND c.claimed_at<b.ends_at AND c.claimed_at<=now() GROUP BY b.period,c.account_id), entries AS (SELECT period,account_id,game,games,wins,shots,hits,ships_sunk,goals,assists,0::bigint AS mission_xp FROM totals UNION ALL SELECT period,account_id,'mission',0,0,0,0,0,0,0,xp FROM mission_totals)
  SELECT b.period,b.starts_at,b.ends_at,a.username,t.game,t.games,t.wins,t.shots,t.hits,t.ships_sunk,t.goals,t.assists,t.mission_xp
  FROM bounds b LEFT JOIN entries t ON t.period=b.period LEFT JOIN kekip_football_accounts a ON a.id=t.account_id
  ORDER BY b.period,a.username,t.game`);
  const periods={};
  for(const r of q.rows){
    const period=periods[r.period]||(periods[r.period]={start:r.starts_at,end:r.ends_at,players:[],byName:new Map()});
    if(!r.username)continue;
    let p=period.byName.get(r.username);
    if(!p){p={username:r.username,battle:{games:0,wins:0,losses:0,shots:0,hits:0,shipsSunk:0},football:{games:0,goals:0,assists:0,careers:0}};period.byName.set(r.username,p);period.players.push(p)}
    const games=statNumber(r.games);
    if(r.game==='battleship'){const wins=Math.min(games,statNumber(r.wins)),shots=statNumber(r.shots);p.battle={games,wins,losses:games-wins,shots,hits:Math.min(shots,statNumber(r.hits)),shipsSunk:statNumber(r.ships_sunk)}}
    if(r.game==='football')Object.assign(p.football,{games,goals:statNumber(r.goals),assists:statNumber(r.assists)});if(r.game==='mission')p.missionXp=statNumber(r.mission_xp);
  }
  for(const p of Object.values(periods)){delete p.byName;for(const player of p.players){const x=accountProgress(player.battle,player.football,player.missionXp);player.periodXp=x.xp;}}
  return periods;
}
// Administrator key is configured only in the hosting environment, never in client files.
function requireAdmin(req,b){const expected=process.env.KEKIP_ADMIN_KEY||'';if(expected.length<32)fail('Yönetici anahtarı sunucuda henüz ayarlanmadı.',503);const supplied=typeof b.adminKey==='string'?b.adminKey:'';if(supplied.length>256||!crypto.timingSafeEqual(Buffer.from(hash(supplied),'hex'),Buffer.from(hash(expected),'hex'))){throttle(req,'admin-access');fail('Yönetici anahtarı geçersiz.',403)}}
async function inviteAction(db,req,action,b){requireAdmin(req,b);if(action==='invite-list'){const q=await db.query('SELECT id,username,created_at,expires_at,used_at,revoked_at FROM kekip_registration_invites ORDER BY created_at DESC LIMIT 200');return {invites:q.rows};}if(action==='invite-create'){const name=typeof b.username==='string'?b.username.trim().toLowerCase():'';if(!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı 3–24 harf/rakam/alt çizgi olmalı.');const existing=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1',[name]);if(existing.rows.length)fail('Bu kullanıcı zaten kayıtlı.',409);const code=token(),id=crypto.randomBytes(12).toString('hex');await db.query("INSERT INTO kekip_registration_invites(id,username,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[id,name,hash(code)]);return {username:name,code};}if(action==='invite-revoke'){if(typeof b.id!=='string'||!/^[a-f0-9]{24}$/.test(b.id))fail('Davet geçersiz.');const q=await db.query('UPDATE kekip_registration_invites SET revoked_at=now() WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id',[b.id]);if(!q.rows.length)fail('Davet zaten kullanılmış veya iptal edilmiş.',409);return {ok:true};}fail('İşlem bulunamadı.',404)}


// Admin-only management. No password hashes, session tokens or career secrets are returned.
async function adminAction(db,req,action,b,options){
 requireAdmin(req,b);
 if(action==='admin-members'){
  const search=typeof b.search==='string'?b.search.trim().toLowerCase():'';
  if(!/^[a-z0-9_]{0,24}$/.test(search))fail('Arama geçersiz.');
  const q=await db.query(`SELECT a.username,a.created_at,a.blocked_at,(SELECT count(*)::int FROM kekip_football_sessions s WHERE s.account_id=a.id AND s.expires_at>now()) AS sessions FROM kekip_football_accounts a WHERE strpos(a.username,$1)>0 OR $1='' ORDER BY a.username LIMIT 200`,[search]);
  const totals=await db.query('SELECT count(*)::int AS total,count(*) FILTER (WHERE blocked_at IS NOT NULL)::int AS blocked FROM kekip_football_accounts');
  const audit=await db.query('SELECT username,action,created_at FROM kekip_admin_audit ORDER BY id DESC LIMIT 50');
  return {members:q.rows,totals:totals.rows[0],audit:audit.rows};
 }
 if(!['admin-block','admin-unblock','admin-reset','admin-revoke-sessions'].includes(action))fail('İşlem bulunamadı.',404);
 if(typeof b.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(b.username))fail('Kullanıcı adı geçersiz.');
 let password=null,digest=null;
 if(action==='admin-reset'){password=crypto.randomBytes(18).toString('base64url');digest=await passwordHash(password);}
 const c=await db.connect();let id;
 try{await c.query('BEGIN');const q=await c.query('SELECT id,blocked_at FROM kekip_football_accounts WHERE username=$1 FOR UPDATE',[b.username]);if(!q.rows.length)fail('Üye bulunamadı.',404);id=q.rows[0].id;
 if(action==='admin-block')await c.query('UPDATE kekip_football_accounts SET blocked_at=now() WHERE id=$1',[id]);
 if(action==='admin-unblock')await c.query('UPDATE kekip_football_accounts SET blocked_at=NULL WHERE id=$1',[id]);
 if(action==='admin-reset')await c.query('UPDATE kekip_football_accounts SET password_hash=$2 WHERE id=$1',[id,digest]);
 if(action!=='admin-unblock'){await c.query('DELETE FROM kekip_football_sessions WHERE account_id=$1',[id]);await c.query("DELETE FROM kekip_social_invites WHERE (sender_id=$1 OR receiver_id=$1) AND status='pending'",[id]);}
 await c.query('INSERT INTO kekip_admin_audit(username,action) VALUES($1,$2)',[b.username,action]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
 if(action!=='admin-unblock')options.disconnectAccount?.(id);
 return {ok:true,...(password?{password}:{})};
}
async function changePassword(db,req,res,b,options){
 const a=await requireAccount(db,req);const old=b.oldPassword,next=b.newPassword;
 if(typeof old!=='string'||typeof next!=='string'||old.length<10||old.length>128||next.length<10||next.length>128||old===next)fail('Yeni şifre farklı ve 10–128 karakter olmalı.');
 throttle(req,a.username);if(inFlight>=4)fail('Sunucu yoğun.',429);inFlight++;let c;
 try{c=await db.connect();await c.query('BEGIN');const q=await c.query('SELECT password_hash,blocked_at FROM kekip_football_accounts WHERE id=$1 FOR UPDATE',[a.id]);if(!q.rows.length||q.rows[0].blocked_at||!await verifyPassword(old,q.rows[0].password_hash))fail('Mevcut şifre yanlış veya hesap kapalı.',403);
 await c.query('UPDATE kekip_football_accounts SET password_hash=$2 WHERE id=$1',[a.id,await passwordHash(next)]);await c.query('DELETE FROM kekip_football_sessions WHERE account_id=$1',[a.id]);await c.query('COMMIT');
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});throw e}finally{c?.release();inFlight--}
 options.disconnectAccount?.(a.id);cookie(res,req,'',0);clearLegacy(res,req);return {ok:true};
}

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
 const q=await db.query('SELECT a.id,a.username,p.data FROM kekip_football_accounts a LEFT JOIN kekip_player_profiles p ON p.account_id=a.id WHERE a.username=$1',[username]);
 if(!q.rows.length)fail('Oyuncu bulunamadı.',404);
 const d=q.rows[0].data||{};
 return {username:q.rows[0].username,profile:{bio:d.bio||'',cover:d.cover||'violet',title:d.title||'',featured:d.featured||[],photo:d.photo||'',modularAvatar:await Wardrobe.readSaved(db,q.rows[0].id),cosmetics:await equippedCosmetics(db,q.rows[0].id)}};
}
async function savePlayerProfile(db,a,b){const data=cleanProfile(b,await profileStats(db,a));await db.query('INSERT INTO kekip_player_profiles(account_id,data) VALUES($1,$2::jsonb) ON CONFLICT(account_id) DO UPDATE SET data=EXCLUDED.data',[a.id,JSON.stringify(data)]);return {username:a.username,profile:{...data,modularAvatar:await Wardrobe.readSaved(db,a.id),cosmetics:await equippedCosmetics(db,a.id)}};}

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

// Friend-only presence and short-lived lobby invites. Never disclose room codes in presence.
async function socialRoomOpen(db,game,code,sender,receiver,options){
 if(game==='battleship')return !!options.battleInviteOpen?.(code,sender,receiver);
 const q=await db.query('SELECT data FROM kekip_football_rooms WHERE code=$1',[code]);const r=q.rows[0]?.data;
 return !!(r?.stage==='lobby'&&Array.isArray(r.players)&&r.players.length<8&&r.players.some(p=>p.accountId===sender)&&!r.players.some(p=>p.accountId===receiver));
}
async function socialAction(db,req,a,action,b,options){
 if(action==='social-pulse'){
  if(!['home','battleship','football'].includes(b.activity))fail('Geçersiz durum.');
  await db.query(`INSERT INTO kekip_presence(token_hash,account_id,activity) SELECT token_hash,account_id,$3 FROM kekip_football_sessions WHERE token_hash=$1 AND account_id=$2 AND expires_at>now() ON CONFLICT(token_hash) DO UPDATE SET activity=EXCLUDED.activity,seen_at=now()`,[hash(sessionToken(req)),a.id,b.activity]);
  const f=await db.query(`SELECT u.username,coalesce(p.activity,'offline') AS activity FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END LEFT JOIN LATERAL (SELECT pr.activity FROM kekip_presence pr JOIN kekip_football_sessions s ON s.token_hash=pr.token_hash WHERE pr.account_id=u.id AND pr.seen_at>now()-interval '80 seconds' AND s.expires_at>now() ORDER BY (pr.activity<>'home') DESC,pr.seen_at DESC LIMIT 1) p ON true WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' ORDER BY u.username`,[a.id]);
  const i=await db.query(`SELECT i.id,u.username AS sender,i.game,i.expires_at FROM kekip_social_invites i JOIN kekip_football_accounts u ON u.id=i.sender_id JOIN kekip_friendships f ON f.low_id=LEAST(i.sender_id,i.receiver_id) AND f.high_id=GREATEST(i.sender_id,i.receiver_id) AND f.status='accepted' WHERE i.receiver_id=$1 AND i.status='pending' AND i.expires_at>now() ORDER BY i.created_at DESC LIMIT 30`,[a.id]);
  return {username:a.username,friends:f.rows,invites:i.rows};
 }
 if(action==='social-invite'){
  const game=b.game,code=typeof b.code==='string'?b.code.toUpperCase():'',username=b.username;
  if(!['battleship','football'].includes(game)||!(game==='battleship'?/^[A-Z2-9]{5}$/:/^[A-F0-9]{10}$/).test(code)||typeof username!=='string'||!/^[a-z0-9_]{3,24}$/.test(username)||username===a.username)fail('Davet bilgileri geçersiz.');
  const f=await db.query(`SELECT u.id FROM kekip_football_accounts u JOIN kekip_friendships f ON f.low_id=LEAST(u.id,$1) AND f.high_id=GREATEST(u.id,$1) AND f.status='accepted' WHERE u.username=$2`,[a.id,username]);
  const receiver=f.rows[0]?.id;if(!receiver)fail('Yalnızca arkadaşlarını davet edebilirsin.',403);
  if(!await socialRoomOpen(db,game,code,a.id,receiver,options))fail('Davet için hesabına bağlı, boş yeri olan açık bir lobi gerekli.',409);
  const count=await db.query(`SELECT count(*) AS n FROM kekip_social_invites WHERE sender_id=$1 AND created_at>now()-interval '1 minute'`,[a.id]);if(Number(count.rows[0].n)>=10)fail('Çok fazla davet gönderdin. Biraz bekle.',429);
  await db.query(`INSERT INTO kekip_social_invites(id,sender_id,receiver_id,game,room_code,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes') ON CONFLICT(sender_id,receiver_id,game,room_code) DO UPDATE SET id=EXCLUDED.id,status='pending',created_at=now(),expires_at=EXCLUDED.expires_at WHERE kekip_social_invites.status<>'pending' OR kekip_social_invites.expires_at<=now()`,[crypto.randomBytes(16).toString('hex'),a.id,receiver,game,code]);return {ok:true};
 }
 if(action==='social-accept'||action==='social-decline'){
  if(typeof b.id!=='string'||!/^[a-f0-9]{32}$/.test(b.id))fail('Davet geçersiz.');
  const q=await db.query(`SELECT i.* FROM kekip_social_invites i JOIN kekip_friendships f ON f.low_id=LEAST(i.sender_id,i.receiver_id) AND f.high_id=GREATEST(i.sender_id,i.receiver_id) AND f.status='accepted' WHERE i.id=$1 AND i.receiver_id=$2 AND i.status='pending' AND i.expires_at>now()`,[b.id,a.id]);const i=q.rows[0];if(!i)fail('Davet artık geçerli değil.',409);
  if(action==='social-accept'&&!await socialRoomOpen(db,i.game,i.room_code,i.sender_id,a.id,options))fail('Oda kapandı, doldu veya oyun başladı.',409);
  const u=await db.query(`UPDATE kekip_social_invites SET status=$3 WHERE id=$1 AND receiver_id=$2 AND status='pending' AND expires_at>now() RETURNING id`,[b.id,a.id,action==='social-accept'?'accepted':'declined']);if(!u.rows.length)fail('Davet artık geçerli değil.',409);
  return action==='social-accept'?{url:i.game==='battleship'?'/?room='+i.room_code:'/football.html?footballRoom='+i.room_code}:{ok:true};
 }
 fail('İşlem bulunamadı.',404);
}


// Central mission definitions. Progress comes exclusively from persisted game results.
const MISSIONS=[
 {id:'daily_play',period:'day',name:'Günün maçı',description:'Herhangi bir oyunda 1 kayıtlı maç tamamla.',metric:'games',target:1,xp:25,icon:'🎮'},
 {id:'daily_battle',period:'day',name:'Deniz görevi',description:'Amiral Battı’da 1 maç kazan.',metric:'wins',target:1,xp:20,icon:'⚓'},
 {id:'daily_football',period:'day',name:'Skora katkı',description:'Futbol Kariyer’de toplam 2 gol veya asist yap.',metric:'contributions',target:2,xp:20,icon:'⚽'},
 {id:'weekly_play',period:'week',name:'Haftanın müdavimi',description:'Herhangi bir oyunda 10 kayıtlı maç tamamla.',metric:'games',target:10,xp:100,icon:'🔥'},
 {id:'weekly_battle',period:'week',name:'Filo komutanı',description:'Amiral Battı’da 5 maç kazan.',metric:'wins',target:5,xp:75,icon:'🏆'},
 {id:'weekly_football',period:'week',name:'Yıldız futbolcu',description:'Futbol Kariyer’de toplam 10 gol veya asist yap.',metric:'contributions',target:10,xp:75,icon:'⭐'}
];
const missionCoins=def=>def.period==='day'?10:30;
function missionProgress(def,row,claims){const current=Math.min(def.target,statNumber(row[def.metric]));return {...def,coins:missionCoins(def),current,complete:current>=def.target,claimed:claims.some(c=>c.mission_id===def.id&&c.period_start===row.period_start),periodStart:row.period_start,endsAt:row.ends_at};}
async function missionList(db,a){
 const q=await db.query(`WITH clock AS (SELECT now() AT TIME ZONE 'Europe/Istanbul' AS t), local_bounds AS (
 SELECT 'day'::text AS period,date_trunc('day',t) AS start_local,date_trunc('day',t)+interval '1 day' AS end_local FROM clock
 UNION ALL SELECT 'week',date_trunc('week',t),date_trunc('week',t)+interval '1 week' FROM clock), bounds AS (
 SELECT period,to_char(start_local,'YYYY-MM-DD') AS period_start,start_local AT TIME ZONE 'Europe/Istanbul' AS starts_at,end_local AT TIME ZONE 'Europe/Istanbul' AS ends_at FROM local_bounds)
 SELECT b.period,b.period_start,b.ends_at,count(r.match_id) AS games,
 count(*) FILTER (WHERE r.game='battleship' AND r.result->'win'='true'::jsonb) AS wins,
 COALESCE(sum(CASE WHEN r.game='football' THEN (CASE WHEN r.result->>'goals' ~ '^[0-9]{1,9}$' THEN (r.result->>'goals')::bigint ELSE 0 END)+(CASE WHEN r.result->>'assists' ~ '^[0-9]{1,9}$' THEN (r.result->>'assists')::bigint ELSE 0 END) ELSE 0 END),0) AS contributions
 FROM bounds b LEFT JOIN kekip_game_results r ON r.account_id=$1 AND r.created_at>=b.starts_at AND r.created_at<b.ends_at AND r.created_at<=now() AND r.game IN ('battleship','football') GROUP BY b.period,b.period_start,b.ends_at`,[a.id]);
 const c=await db.query(`SELECT mission_id,to_char(period_start,'YYYY-MM-DD') AS period_start FROM kekip_mission_claims WHERE account_id=$1 AND period_start=ANY($2::date[])`,[a.id,q.rows.map(r=>r.period_start)]);
 return {missions:MISSIONS.map(d=>missionProgress(d,q.rows.find(r=>r.period===d.period),c.rows))};
}
async function missionAction(db,a,action,b){if(action==='missions')return missionList(db,a);if(action!=='mission-claim')fail('İşlem bulunamadı.',404);
 const def=MISSIONS.find(d=>d.id===b.id);if(!def||typeof b.periodStart!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.periodStart))fail('Görev geçersiz.');
 const client=await db.connect();try{await client.query('BEGIN');const q=await missionList(client,a);const m=q.missions.find(d=>d.id===def.id);if(m.periodStart!==b.periodStart)fail('Görev dönemi değişti. Listeyi yenile.',409);if(!m.complete)fail('Görev henüz tamamlanmadı.',409);if(m.claimed)fail('Ödül zaten alındı.',409);
 const r=await client.query(`INSERT INTO kekip_mission_claims(account_id,mission_id,period_start,xp) VALUES($1,$2,$3::date,$4) ON CONFLICT DO NOTHING RETURNING xp`,[a.id,def.id,m.periodStart,def.xp]);if(!r.rows.length)fail('Ödül zaten alındı.',409);const coins=missionCoins(def);await client.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'mission',$2,$3,$4) ON CONFLICT(account_id,source_kind,source_id) DO NOTHING`,[a.id,JSON.stringify([def.id,m.periodStart]),'Görev · '+def.name,coins]);await client.query('COMMIT');return {ok:true,xp:def.xp,coins};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}

// Read-only wallet. No client-submitted coin amount or spending endpoint.
async function coinBalance(db,a){const q=await db.query('SELECT COALESCE(sum(amount),0) AS balance FROM kekip_coin_ledger WHERE account_id=$1',[a.id]);return Number(q.rows[0]?.balance||0)}
async function wallet(db,a){const q=await db.query(`SELECT COALESCE(sum(amount),0) AS balance,COALESCE(sum(amount) FILTER (WHERE amount>0),0) AS earned,COALESCE(sum(-(amount::bigint)) FILTER (WHERE amount<0),0) AS spent,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',r.label,'amount',r.amount,'createdAt',r.created_at) ORDER BY r.id DESC),'[]'::jsonb) FROM (SELECT id,label,amount,created_at FROM kekip_coin_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT 50) r) AS history
 FROM kekip_coin_ledger WHERE account_id=$1`,[a.id]);const row=q.rows[0];return {username:a.username,balance:Number(row.balance),earned:Number(row.earned),spent:Number(row.spent),history:row.history};}

// Stable item IDs and server-owned prices. Extend catalog without changing existing IDs.
const COSMETICS=Object.freeze([
 {id:'frame_violet',slot:'frame',name:'Neon Çember',description:'Mor ışıklı profil çerçevesi',price:80},
 {id:'frame_gold',slot:'frame',name:'Altın Seri',description:'Altın renkli profil çerçevesi',price:180},
 {id:'cover_nebula',slot:'cover',name:'Nebula',description:'Yavaş hareketli mor galaksi kapağı',price:150},
 {id:'cover_tide',slot:'cover',name:'Aurora Akışı',description:'Mavi ve turkuaz ışıklı hareketli kapak',price:160},
 {id:'name_lilac',slot:'name',name:'Ametist',description:'Lila kullanıcı adı',price:65},
 {id:'name_gold',slot:'name',name:'Altın İmza',description:'Altın renkli kullanıcı adı',price:120},
 {id:'title_pioneer',slot:'title',name:'Öncü',description:'Özel kozmetik oyuncu unvanı',price:100},
 {id:'title_night',slot:'title',name:'Gece Oyuncusu',description:'Özel kozmetik oyuncu unvanı',price:100},
 {id:'effect_glow',slot:'effect',name:'Yıldız Işığı',description:'Profil kartında yumuşak ışık efekti',price:140},
 {id:'chat_violet',slot:'chat',name:'Mor Mürekkep',description:'Mor sohbet balonu ve renkli kenar',price:90},
 {id:'chat_gold',slot:'chat',name:'Altın Sohbet',description:'Altın çizgili sohbet balonu',price:130}
]);
const COSMETIC_SLOTS=[...new Set(COSMETICS.map(x=>x.slot))];
async function equippedCosmetics(db,id){const q=await db.query('SELECT slot,item_id FROM kekip_cosmetic_equipped WHERE account_id=$1',[id]);return Object.fromEntries(q.rows.filter(r=>COSMETICS.some(c=>c.id===r.item_id&&c.slot===r.slot)).map(r=>[r.slot,r.item_id]));}
async function shopList(db,a){const q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[a.id]);const activeIds=new Set([...COSMETICS,...GeceCollection.items,...GolgeCollection.items].map(i=>i.id));const owned=q.rows.map(r=>r.item_id).filter(id=>activeIds.has(id));return {username:a.username,balance:await coinBalance(db,a),catalog:COSMETICS,geceCollection:GeceCollection,golgeCollection:GolgeCollection,owned,equipped:await equippedCosmetics(db,a.id)};}
async function shopAction(db,a,action,b){if(b.username!==undefined&&b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);if(action==='shop')return shopList(db,a);if(!['shop-buy','shop-equip'].includes(action))fail('İşlem bulunamadı.',404);
 const modularCollection=Object.values(Wardrobe.collections).find(c=>c.items.some(x=>x.id===b.id));
 const modular=modularCollection?.items.find(x=>x.id===b.id);
 const item=action==='shop-buy'&&modular?modular:COSMETICS.find(x=>x.id===b.id);const slot=action==='shop-buy'?item?.slot:b.slot;
 if(action==='shop-buy'&&modular){
  if(!modularCollection.saleEnabled||modular.starter||modular.status!=='available'||!Number.isSafeInteger(modular.price)||modular.price<=0)fail('Bu ürün satışta değil.',409);
  if(b.expectedPrice!==modular.price)fail('Fiyat değişti. Mağazayı yenileyip tekrar dene.',409);
 }else{
  if(action==='shop-buy'&&(item?.legacy||item?.slot.startsWith('av_')))fail('Bu ürün eski koleksiyona ait ve artık satışta değil.',409);
  if(!COSMETIC_SLOTS.includes(slot)||(action==='shop-buy'&&!item)||(action==='shop-equip'&&b.id!==''&&(!item||item.slot!==slot)))fail('Kozmetik geçersiz.');
 }
 const c=await db.connect();try{await c.query('BEGIN');const lock=await c.query('SELECT id FROM kekip_football_accounts WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',[a.id]);if(!lock.rows.length)fail('Hesap erişimi kapalı.',403);
 if(action==='shop-buy'){const owned=await c.query('SELECT 1 FROM kekip_cosmetic_inventory WHERE account_id=$1 AND item_id=$2',[a.id,item.id]);if(owned.rows.length)fail('Bu ürün zaten envanterinde.',409);if(await coinBalance(c,a)<item.price)fail('Yeterli KC yok.',409);
 await c.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) VALUES($1,$2)',[a.id,item.id]);await c.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'cosmetic',$2,$3,$4)`,[a.id,item.id,'Mağaza · '+item.name,-item.price]);
 }else if(b.id===''){await c.query('DELETE FROM kekip_cosmetic_equipped WHERE account_id=$1 AND slot=$2',[a.id,slot]);}else{const owned=await c.query('SELECT 1 FROM kekip_cosmetic_inventory WHERE account_id=$1 AND item_id=$2',[a.id,item.id]);if(!owned.rows.length)fail('Önce bu ürünü satın almalısın.',403);await c.query('INSERT INTO kekip_cosmetic_equipped(account_id,slot,item_id) VALUES($1,$2,$3) ON CONFLICT(account_id,slot) DO UPDATE SET item_id=EXCLUDED.item_id',[a.id,slot,item.id]);}
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}return {ok:true};}

function attachAccounts(app,options={}){app.post(['/api/account/:action','/api/football/account/:action'],(req,res,next)=>json({limit:req.params.action==='profile-save'?'64kb':'16kb'})(req,res,next),async(req,res,next)=>{const action=req.params.action;if(req.path.startsWith('/api/football/')&&['list','claim'].includes(action))return next();res.set('Cache-Control','no-store');try{safeRequest(req);const b=req.body||{};if(action==='me'&&!sessionToken(req))return res.json({user:null});const db=await database();
if(['invite-list','invite-create','invite-revoke'].includes(action))return res.json(await inviteAction(db,req,action,b));
if(action.startsWith('admin-'))return res.json(await adminAction(db,req,action,b,options));
if(action==='password-change')return res.json(await changePassword(db,req,res,b,options));
if(action==='me'){const a=await getAccount(db,req);return res.json({user:a?{username:a.username}:null})}
if(action==='logout'){const t=sessionToken(req);if(t)await db.query('DELETE FROM kekip_football_sessions WHERE token_hash=$1',[hash(t)]);cookie(res,req,'',0);clearLegacy(res,req);return res.json({ok:true})}
if(action==='register'||action==='login'){const name=typeof b.username==='string'?b.username.trim().toLowerCase():'',password=b.password;if(!/^[a-z0-9_]{3,24}$/.test(name)||typeof password!=='string'||password.length<10||password.length>128)fail('Kullanıcı adı 3–24 harf/rakam/alt çizgi, şifre 10–128 karakter olmalı.');throttle(req,name);if(inFlight>=4)fail('Sunucu yoğun. Biraz sonra tekrar dene.',429);let a;inFlight++;try{if(action==='register'){const code=typeof b.inviteCode==='string'?b.inviteCode.trim().toLowerCase():'';if(!/^[a-f0-9]{48}$/.test(code))fail('Üyelik davetlidir. Yönetici tarafından verilen davet kodunu gir.',403);const id=token(),digest=await passwordHash(password);let q;try{q=await db.query(`WITH claimed AS (UPDATE kekip_registration_invites SET used_at=now() WHERE username=$2 AND code_hash=$4 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id) INSERT INTO kekip_football_accounts(id,username,password_hash) SELECT $1,$2,$3 FROM claimed RETURNING id,username`,[id,name,digest,hash(code)])}catch(e){if(e.code==='23505')fail('Bu kullanıcı adı alınmış.',409);throw e}if(!q.rows.length)fail('Davet geçersiz, kullanılmış, iptal edilmiş, süresi dolmuş veya bu kullanıcı adına ait değil.',403);a=q.rows[0]}else{const q=await db.query('SELECT id,username,password_hash,blocked_at FROM kekip_football_accounts WHERE username=$1',[name]);a=q.rows[0];const ok=await verifyPassword(password,a?.password_hash||('0'.repeat(32)+':'+ '0'.repeat(128)));if(!a||!ok)fail('Kullanıcı adı veya şifre yanlış.',401);if(a.blocked_at)fail('Hesabın yönetici tarafından engellendi.',403)}}finally{inFlight--}const t=token(),old=sessionToken(req);if(old)await db.query('DELETE FROM kekip_football_sessions WHERE token_hash=$1',[hash(old)]);await db.query('DELETE FROM kekip_football_sessions WHERE expires_at<=now()');const c=await db.connect();try{await c.query('BEGIN');const check=await c.query('SELECT password_hash,blocked_at FROM kekip_football_accounts WHERE id=$1 FOR UPDATE',[a.id]);if(!check.rows.length||check.rows[0].blocked_at||(action==='login'&&check.rows[0].password_hash!==a.password_hash))fail('Hesap değişti. Tekrar giriş yap.',403);await c.query("INSERT INTO kekip_football_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash(t),a.id]);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}cookie(res,req,t,2592000);clearLegacy(res,req);return res.json({user:{username:a.username}})}

if(action==='avatar-save'){await requireAccount(db,req);fail('Eski karakter sistemi kaldırıldı. Gece veya Gölge gardırobunu kullan.',410);}
if(action==='avatar'){const a=await requireAccount(db,req);return res.json({username:a.username,appearance:await Wardrobe.readSaved(db,a.id),characters:['gece','golge']});}
if(action.startsWith('social-')){const a=await requireAccount(db,req);return res.json(await socialAction(db,req,a,action,b,options))}if(action.startsWith('friends-')){const a=await requireAccount(db,req);return res.json(await friendAction(db,a,action,b))}if(action==='profile'){const a=await requireAccount(db,req);const name=b.username===undefined?a.username:b.username;if(typeof name!=='string'||!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı geçersiz.');return res.json(await readPlayerProfile(db,name))}if(action==='profile-save'){const a=await requireAccount(db,req);return res.json(await savePlayerProfile(db,a,b))}if(action==='missions'||action==='mission-claim'){const a=await requireAccount(db,req);return res.json(await missionAction(db,a,action,b))}if(action==='wardrobe-view'){await requireAccount(db,req);const name=b.username;if(typeof name!=='string'||!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı geçersiz.');const q=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1 AND blocked_at IS NULL',[name]);if(!q.rows.length)fail('Oyuncu bulunamadı.',404);if(b.character!==undefined)Wardrobe.collection(b.character);const saved=await Wardrobe.readSaved(db,q.rows[0].id,b.character||null);if(!saved)fail('Henüz kayıtlı avatar yok.',404);return res.json({username:name,saved,collection:Wardrobe.collection(saved.character)});}
if(action==='avatar-portraits'){await requireAccount(db,req);if(!Array.isArray(b.usernames)||b.usernames.length>40||b.usernames.some(n=>typeof n!=='string'||!/^[a-z0-9_]{3,24}$/.test(n)))fail('Oyuncu listesi geçersiz.');const names=[...new Set(b.usernames)];if(!names.length)return res.json({players:[]});const q=await db.query(`SELECT a.username, m.appearance, CASE WHEN m.appearance IS NULL THEN p.data->>'photo' ELSE NULL END AS photo FROM kekip_football_accounts a LEFT JOIN kekip_player_profiles p ON p.account_id=a.id LEFT JOIN LATERAL (SELECT appearance FROM kekip_modular_avatars WHERE account_id=a.id AND character IN ('gece','golge') ORDER BY updated_at DESC,character LIMIT 1) m ON true WHERE a.blocked_at IS NULL AND a.username=ANY($1::text[])`,[names]);return res.json({players:q.rows.map(r=>({username:r.username,appearance:r.appearance||null,photo:typeof r.photo==='string'&&r.photo.length<=44000&&r.photo.startsWith('data:image/jpeg;base64,')?r.photo:''}))});}
if(['wardrobe-slots','wardrobe-slot-save','wardrobe-slot-rename','wardrobe-slot-delete','wardrobe-slot-equip'].includes(action)){const a=await requireAccount(db,req);if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);return res.json(await Wardrobe.slotAction(db,a.id,b.character,action,b));}
if(action==='wardrobe-save'){const a=await requireAccount(db,req);if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const saved=await Wardrobe.save(db,a.id,b.character,b.draft);return res.json({username:a.username,saved,persisted:true});}
if(action==='wardrobe'||action==='wardrobe-check'){const a=await requireAccount(db,req);if(b.username!==undefined&&b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const character=b.character||'gece';const collection=Wardrobe.collection(character);const q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[a.id]);const owned=q.rows.map(r=>r.item_id);if(action==='wardrobe-check')return res.json({username:a.username,draft:Wardrobe.validate(character,b.draft,owned),persisted:false});return res.json({username:a.username,collection,saved:await Wardrobe.readSaved(db,a.id,character),available:Wardrobe.access(character,owned),owned:owned.filter(id=>collection.items.some(i=>i.id===id))});}if(['shop','shop-buy','shop-equip'].includes(action)){const a=await requireAccount(db,req);return res.json(await shopAction(db,a,action,b))}if(action==='wallet'){const a=await requireAccount(db,req);return res.json(await wallet(db,a))}if(action==='stats'){const a=await requireAccount(db,req);const stats=await profileStats(db,a);return res.json({...stats,coins:await coinBalance(db,a)})}if(action==='leaderboard'){const a=await requireAccount(db,req);return res.json(await leaderboardStats(db,a))}if(action==='period-leaderboard'){await requireAccount(db,req);return res.json(await periodLeaderboard(db))}fail('İşlem bulunamadı.',404)}catch(e){if(!e.status)console.error('KEKIP account:',e.code||e.message);res.status(e.status||503).json({error:e.status?e.message:'Hesap sunucusuna erişilemiyor. Tekrar dene.'})}})}
module.exports={attachAccounts,database,getAccount,requireAccount,safeRequest,passwordHash,verifyPassword,socketAccount,recordBattle,recordGameResults,profileStats};
