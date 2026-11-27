'use strict';
const crypto=require('crypto');
const AccountHistory=require('./account-history.js');
const GeceCollection=require('./gece-catalog.json');
const Wardrobe=require('./wardrobe.js');
const MysteryChest=require('./mystery-chest.js');
const Pets=require('./pets.js');
const ProfileExtras=require('./profile-extras.js');
const {readAcquisitions}=require('./shop-history.js');
const {readLoginStreak,creditLoginStreak,milestones:loginMilestones}=require('./login-streak.js');
const Wings=require('./avatar-wings.json');
const ChestCollections=require('./chest-collections.json');
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
async function getAccount(db,req){const t=sessionToken(req);if(!t)return null;const q=await db.query('SELECT a.id,a.username, EXISTS(SELECT 1 FROM kekip_modular_avatars m WHERE m.account_id=a.id AND m.character IN (\'gece\',\'golge\')) AS "onboarded" FROM kekip_football_sessions s JOIN kekip_football_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now() AND a.blocked_at IS NULL',[hash(t)]);return q.rows[0]||null}
const requireAccount=async(db,req)=>{const a=await getAccount(db,req);if(!a)fail('Önce hesabına giriş yap.',401);if(!a.onboarded)fail('Önce karakterini oluştur.',403);return a};
async function database(){if(!process.env.DATABASE_URL)fail('Çevrimiçi kariyer için DATABASE_URL henüz ayarlanmadı.',503);if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:10000,enableChannelBinding:true});pool.on('error',()=>{console.error('[KEKIP] Bekleyen veritabanı bağlantısı kesildi; havuz sonraki istekte yeni bağlantı açabilir.');});}if(!init)init=(async()=>{await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_rooms (code text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_accounts (id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');await pool.query('ALTER TABLE kekip_football_accounts ADD COLUMN IF NOT EXISTS blocked_at timestamptz');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_admin_audit (id bigserial PRIMARY KEY, username text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`);await pool.query('CREATE TABLE IF NOT EXISTS kekip_football_sessions (token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_game_results (game text NOT NULL, match_id text NOT NULL, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(game,match_id,account_id))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_player_avatars(account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, preset_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);await pool.query(`ALTER TABLE kekip_player_avatars ADD COLUMN IF NOT EXISTS appearance jsonb NOT NULL DEFAULT '{}'::jsonb`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_modular_avatars(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,character text NOT NULL,appearance jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,character))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_avatar_outfits(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,character text NOT NULL,slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 5),name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 40),appearance jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,character,slot),CHECK(character IN ('gece','golge')))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_player_profiles (account_id text PRIMARY KEY REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, data jsonb NOT NULL DEFAULT '{}'::jsonb)`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_friendships (low_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, high_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, requested_by text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(low_id,high_id), CHECK(low_id<>high_id), CHECK(requested_by IN (low_id,high_id)))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_friendships_high ON kekip_friendships(high_id)');
await pool.query(`CREATE TABLE IF NOT EXISTS kekip_admin_grants (
 request_id text PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('kc','xp','item')), amount integer NOT NULL, item_id text NOT NULL DEFAULT '',
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 3 AND 160), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind IN ('kc','xp') AND amount BETWEEN 1 AND 10000 AND item_id='') OR (kind='item' AND amount=0 AND item_id<>''))
)`);
await pool.query('CREATE INDEX IF NOT EXISTS kekip_admin_grants_account ON kekip_admin_grants(account_id,kind,created_at)');
await pool.query(`CREATE TABLE IF NOT EXISTS kekip_direct_messages (
 id bigserial PRIMARY KEY,
 low_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
 high_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
 sender_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
 receiver_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
 client_id text NOT NULL CHECK(char_length(client_id) BETWEEN 16 AND 64),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sender_id,client_id), CHECK(low_id<>high_id), CHECK(sender_id<>receiver_id),
 CHECK(sender_id IN (low_id,high_id) AND receiver_id IN (low_id,high_id))
)`);
await pool.query('CREATE INDEX IF NOT EXISTS kekip_dm_pair_recent ON kekip_direct_messages(low_id,high_id,id DESC)');
await pool.query('CREATE INDEX IF NOT EXISTS kekip_dm_sender_time ON kekip_direct_messages(sender_id,created_at)');
await pool.query('ALTER TABLE kekip_direct_messages ADD COLUMN IF NOT EXISTS read_at timestamptz');
await pool.query('CREATE INDEX IF NOT EXISTS kekip_dm_unread_receiver ON kekip_direct_messages(receiver_id,sender_id,id) WHERE read_at IS NULL');
await pool.query(`CREATE TABLE IF NOT EXISTS kekip_presence (token_hash text PRIMARY KEY REFERENCES kekip_football_sessions(token_hash) ON DELETE CASCADE, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, activity text NOT NULL CHECK(activity IN ('home','battleship','football')), seen_at timestamptz NOT NULL DEFAULT now())`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_presence_account ON kekip_presence(account_id,seen_at)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_social_invites (id text PRIMARY KEY, sender_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, receiver_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, game text NOT NULL CHECK(game IN ('battleship','football')), room_code text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')), created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, UNIQUE(sender_id,receiver_id,game,room_code), CHECK(sender_id<>receiver_id))`);await pool.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'migrations','late-answer-up.sql'),'utf8'));await pool.query('CREATE INDEX IF NOT EXISTS kekip_social_invites_receiver ON kekip_social_invites(receiver_id,expires_at)');await pool.query('CREATE INDEX IF NOT EXISTS kekip_game_results_account ON kekip_game_results(account_id,game)');await pool.query('CREATE INDEX IF NOT EXISTS kekip_game_results_date ON kekip_game_results(created_at,game)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_mission_claims (account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, mission_id text NOT NULL, period_start date NOT NULL, xp integer NOT NULL CHECK(xp>0), claimed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,mission_id,period_start))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_mission_claims_date ON kekip_mission_claims(claimed_at)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_coin_ledger (id bigserial PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, source_kind text NOT NULL, source_id text NOT NULL, label text NOT NULL, amount integer NOT NULL CHECK(amount<>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,source_kind,source_id))`);await pool.query('CREATE INDEX IF NOT EXISTS kekip_coin_ledger_recent ON kekip_coin_ledger(account_id,id DESC)');await pool.query(`CREATE TABLE IF NOT EXISTS kekip_cosmetic_inventory(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,item_id text NOT NULL,purchased_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,item_id))`);// 0.50.19.5: retain every formerly free piece referenced in existing active/saved outfits.
await pool.query(`INSERT INTO kekip_cosmetic_inventory(account_id,item_id)
 SELECT DISTINCT looks.account_id, part.value
 FROM (SELECT account_id,character,appearance FROM kekip_modular_avatars UNION ALL SELECT account_id,character,appearance FROM kekip_avatar_outfits) looks
 CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(looks.appearance->'items')='object' THEN looks.appearance->'items' ELSE '{}'::jsonb END) part
 WHERE (looks.character='gece' AND part.value=ANY($1::text[])) OR (looks.character='golge' AND part.value=ANY($2::text[]))
 ON CONFLICT(account_id,item_id) DO NOTHING`, [Wardrobe.collections.gece.items.filter(i=>i.onboardingEligible&&i.chestOnly!==true).map(i=>i.id),Wardrobe.collections.golge.items.filter(i=>i.onboardingEligible&&i.chestOnly!==true).map(i=>i.id)]);
await pool.query(`CREATE TABLE IF NOT EXISTS kekip_daily_wheel_items(account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE, day date NOT NULL, item_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,day))`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_cosmetic_equipped(account_id text NOT NULL,slot text NOT NULL,item_id text NOT NULL,PRIMARY KEY(account_id,slot),FOREIGN KEY(account_id,item_id) REFERENCES kekip_cosmetic_inventory(account_id,item_id) ON DELETE CASCADE)`);await pool.query(`CREATE TABLE IF NOT EXISTS kekip_registration_invites (id text PRIMARY KEY, username text NOT NULL, code_hash text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz)`);
// 0.51.12.2: indexes match existing read and cleanup predicates. No game data migration.
await pool.query('CREATE INDEX IF NOT EXISTS kekip_football_rooms_data_gin ON kekip_football_rooms USING GIN (data jsonb_path_ops)');
await pool.query('CREATE INDEX IF NOT EXISTS kekip_sessions_account ON kekip_football_sessions(account_id)');
await pool.query('CREATE INDEX IF NOT EXISTS kekip_sessions_expiry ON kekip_football_sessions(expires_at)');
await pool.query("CREATE INDEX IF NOT EXISTS kekip_match_ledger_day ON kekip_coin_ledger(account_id,created_at) WHERE source_kind='match'");
await pool.query(`CREATE TABLE IF NOT EXISTS kekip_match_cards (
 id text PRIMARY KEY, account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
 game text NOT NULL, match_id text NOT NULL, prizes jsonb NOT NULL,
 chosen smallint CONSTRAINT kekip_match_cards_choice_bounds CHECK(chosen >= 0 AND chosen < jsonb_array_length(prizes)), chosen_at timestamptz, spin_used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(account_id,game,match_id),
 FOREIGN KEY(game,match_id,account_id) REFERENCES kekip_game_results(game,match_id,account_id) ON DELETE CASCADE
)`);
// 0.51.17.1.2: retain existing three-card offers and allow the fourth choice on new offers.
await pool.query(`DO $$ BEGIN
 LOCK TABLE kekip_match_cards IN ACCESS EXCLUSIVE MODE;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='kekip_match_cards'::regclass AND conname='kekip_match_cards_choice_bounds') THEN
  ALTER TABLE kekip_match_cards ADD CONSTRAINT kekip_match_cards_choice_bounds CHECK(chosen >= 0 AND chosen < jsonb_array_length(prizes));
 END IF;
 ALTER TABLE kekip_match_cards DROP CONSTRAINT IF EXISTS kekip_match_cards_chosen_check;
END; $$`);
await pool.query('CREATE INDEX IF NOT EXISTS kekip_match_cards_account ON kekip_match_cards(account_id,created_at)');
await MysteryChest.ensureSchema(pool);
await AccountHistory.ensureAccountHistory(pool);
})().catch(e=>{init=null;throw e});await init;return pool;}
function throttle(req,name){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const ip=(req.get('X-Forwarded-For')||req.ip||'unknown').split(',').pop().trim();for(const [key,limit] of [['ip:'+ip,30],['user:'+name,8]]){let v=attempts.get(key)||{n:0,until:now+10*60*1000};if(v.n>=limit||attempts.size>10000)fail('Çok fazla deneme. Birkaç dakika sonra tekrar dene.',429);v.n++;attempts.set(key,v)}}
const json=require('express').json;
function safeRequest(req){if(!req.is('application/json'))fail('JSON isteği gerekli.',415);const origin=req.get('Origin');if(origin){let u;try{u=new URL(origin)}catch{fail('İstek kaynağı geçersiz.',403)}if(u.host!==req.get('Host'))fail('İstek kaynağı geçersiz.',403)}}

function clearLegacy(res,req){const local=/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.get('Host')||'');res.append('Set-Cookie',`kekip_football_session=; Path=/api/football; HttpOnly; SameSite=Strict; Max-Age=0${local?'':'; Secure'}`)}
async function socketAccount(socket){const req={get:key=>socket.request.headers[key.toLowerCase()]};if(!sessionToken(req))fail('Önce hesabına giriş yap.',401);return requireAccount(await database(),req)}
// Internal server-only interface for future game modules. Never accepts game results directly from browsers.
// Reward ceiling applies only to match earnings, never to saved match statistics or XP.
const MATCH_DAILY_CAP=100;
async function recordGameResults(game,matchId,rows,transaction=null,allowCards=false){
 if(!/^[a-z0-9_-]{1,40}$/.test(game)||typeof matchId!=='string'||!matchId||matchId.length>100)throw Error('Invalid game/match identifier');
 if(!rows.length)return;
 const unique=[...new Map(rows.map(r=>[r.accountId,r])).values()];
 const db=transaction||await (await database()).connect();
 try{if(!transaction)await db.query('BEGIN');
 // Lock accounts in a consistent order; subsequent SQL sees committed prior rewards.
 await db.query('SELECT id FROM kekip_football_accounts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[unique.map(r=>r.accountId)]);
 const values=[],params=[];for(const row of unique){const i=params.length;values.push(`($${i+1},$${i+2},$${i+3},$${i+4}::jsonb)`);params.push(game,matchId,row.accountId,JSON.stringify(row.result));}
 const recorded=await db.query(`WITH fresh AS (INSERT INTO kekip_game_results(game,match_id,account_id,result) VALUES ${values.join(',')} ON CONFLICT DO NOTHING RETURNING game,match_id,account_id,result),
 awards AS (SELECT f.*, LEAST(CASE WHEN f.game='arena' THEN 5 ELSE 10 END+CASE WHEN f.game='battleship' AND f.result->'win'='true'::jsonb THEN 5 ELSE 0 END,
 GREATEST(0,${MATCH_DAILY_CAP}-COALESCE((SELECT sum(l.amount) FROM kekip_coin_ledger l WHERE l.account_id=f.account_id AND l.source_kind='match' AND l.created_at >= (date_trunc('day',now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul') AND l.created_at < ((date_trunc('day',now() AT TIME ZONE 'Europe/Istanbul')+interval '1 day') AT TIME ZONE 'Europe/Istanbul')),0)))::integer AS reward FROM fresh f WHERE f.game NOT IN ('late_answer','arena') OR f.result->'complete'='true'::jsonb), credited AS (
 INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount)
 SELECT account_id,'match',jsonb_build_array(game,match_id)::text, CASE WHEN game='battleship' AND result->'win'='true'::jsonb THEN 'Amiral Battı · Galibiyet' WHEN game='battleship' THEN 'Amiral Battı · Maç' WHEN game='football' THEN 'Futbol Kariyer · Maç' WHEN game='late_answer' THEN 'Gecikmeli Cevap · Maç' WHEN game='arena' THEN 'KEKIP Arena · Maç' ELSE 'Oyun · Maç' END,reward FROM awards WHERE reward>0 ON CONFLICT(account_id,source_kind,source_id) DO NOTHING RETURNING id) SELECT account_id,result FROM fresh`,params);
 if(allowCards&&['battleship','football','late_answer','arena'].includes(game))for(const row of recorded.rows){if(!['late_answer','arena'].includes(game)||row.result.complete===true)await createMatchCard(db,row.account_id,game,matchId);}
 const cards=game==='arena'&&allowCards?(await db.query(`SELECT account_id FROM kekip_match_cards
  WHERE game=$1 AND match_id=$2 AND chosen IS NULL AND account_id=ANY($3::text[])`,[game,matchId,unique.map(row=>row.accountId)])).rows.map(row=>row.account_id):[];
 if(!transaction)await db.query('COMMIT');
 return {cards};
 }catch(e){if(!transaction)await db.query('ROLLBACK').catch(()=>{});throw e;}finally{if(!transaction)db.release();}
}
async function recordBattle(matchId,players,winner){return recordGameResults('battleship',matchId,players.filter(p=>p.accountId).map(p=>({accountId:p.accountId,result:{win:p.id===winner,shots:p.shots.length,hits:p.shots.filter(s=>s.hit).length,shipsSunk:players.find(q=>q.id!==p.id)?.sunk.length||0}})),null,players.length===2&&players.every(p=>p.accountId)&&players[0].accountId!==players[1].accountId)}
// 0.51.17.2: only fresh, eligible server-recorded game results can create card offers.
const MATCH_CARD_DAILY_CAP=20;
function shuffledMatchPrizes(){const prizes=['kc5','kc15','spin','empty'];for(let i=prizes.length-1;i>0;i--){const j=crypto.randomInt(i+1);[prizes[i],prizes[j]]=[prizes[j],prizes[i]]}return prizes}
async function createMatchCard(db,accountId,game,matchId){
 const count=await db.query(`SELECT count(*)::int AS n FROM kekip_match_cards WHERE account_id=$1 AND (created_at AT TIME ZONE 'Europe/Istanbul')::date=(now() AT TIME ZONE 'Europe/Istanbul')::date`,[accountId]);
 if(count.rows[0].n>=MATCH_CARD_DAILY_CAP)return;
 // Each fresh eligible account result is evaluated once in the same transaction.
 const pet=await Pets.accountPet(db,accountId);
 if(crypto.randomInt(100)>=Pets.cardChance(pet))return;
 await db.query(`INSERT INTO kekip_match_cards(id,account_id,game,match_id,prizes) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(account_id,game,match_id) DO NOTHING`,[crypto.randomUUID(),accountId,game,matchId,JSON.stringify(shuffledMatchPrizes())]);
}
function validMatchDeck(prizes){return Array.isArray(prizes)&&[3,4].includes(prizes.length)&&prizes.every(p=>typeof p==='string')&&prizes.slice().sort().join(',')===(prizes.length===4?'empty,kc15,kc5,spin':'kc15,kc5,spin');}
function cardPrizeText(prize){return prize==='spin'?'1 ekstra çark hakkı':prize==='kc5'?'+5 KC':prize==='kc15'?'+15 KC':'Bu kart boş çıktı. Bir sonraki maçta bol şans!'}
async function matchCardsAction(db,a,action,b){
 if(action==='match-cards'){const q=await db.query(`SELECT id,game,match_id AS "matchId",jsonb_array_length(prizes) AS "cardCount" FROM kekip_match_cards WHERE account_id=$1 AND chosen IS NULL ORDER BY (game=$3 AND match_id=$2) DESC NULLS LAST,created_at,id LIMIT 20`,[a.id,typeof b.matchId==='string'&&b.matchId.length<=100?b.matchId:null,['football','late_answer','arena'].includes(b.game)?b.game:'battleship']);return {username:a.username,offers:q.rows,dailyCap:MATCH_CARD_DAILY_CAP,chancePercent:Pets.cardChance(await Pets.accountPet(db,a.id))};}
 if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
 if(typeof b.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.id)||!Number.isInteger(b.choice)||b.choice<0||b.choice>3)fail('Kart seçimi geçersiz.');
 const c=await db.connect();try{await c.query('BEGIN');
 const lock=await c.query('SELECT id FROM kekip_football_accounts WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',[a.id]);if(!lock.rows.length)fail('Hesap erişimi kapalı.',403);
 const q=await c.query('SELECT id,prizes,chosen FROM kekip_match_cards WHERE id=$1 AND account_id=$2 FOR UPDATE',[b.id,a.id]);const offer=q.rows[0];if(!offer)fail('Ödül kartı bulunamadı.',404);
 if(!validMatchDeck(offer.prizes)||(offer.chosen!==null&&(!Number.isInteger(offer.chosen)||offer.chosen<0||offer.chosen>=offer.prizes.length)))fail('Ödül kartı doğrulanamadı.',503);
 if(b.choice>=offer.prizes.length)fail('Kart seçimi geçersiz.');
 const fresh=offer.chosen===null,choice=fresh?b.choice:offer.chosen,prize=offer.prizes[choice],amount=prize==='kc5'?5:prize==='kc15'?15:0;
 if(fresh){await c.query('UPDATE kekip_match_cards SET chosen=$2,chosen_at=now() WHERE id=$1',[offer.id,choice]);if(amount)await c.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'match_card',$2,'Maç sonu kart ödülü',$3)`,[a.id,offer.id,amount]);}
 const balance=await coinBalance(c,a);await c.query('COMMIT');return {username:a.username,id:offer.id,choice,prizes:offer.prizes,prize,text:cardPrizeText(prize),amount,balance,fresh};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
}
const lateStats=(games=0,wins=0,correct=0,forfeits=0)=>({games:statNumber(games),wins:statNumber(wins),correct:statNumber(correct),forfeits:statNumber(forfeits)});
const LATE_TOTALS=`count(*) FILTER (WHERE result->'complete'='true'::jsonb) AS late_games,
 count(*) FILTER (WHERE result->'win'='true'::jsonb) AS late_wins,
 sum(CASE WHEN result->'complete'='true'::jsonb AND result->>'correct' ~ '^[0-9]{1,2}$' THEN (result->>'correct')::int ELSE 0 END) AS late_correct,
 count(*) FILTER (WHERE result->'forfeited'='true'::jsonb) AS late_forfeits`;
const readLateStats=row=>lateStats(row?.late_games,row?.late_wins,row?.late_correct,row?.late_forfeits);
const arenaStats=(games,wins)=>({games:statNumber(games),wins:Math.min(statNumber(games),statNumber(wins))});
const ARENA_TOTALS=`count(*) FILTER (WHERE result->'complete'='true'::jsonb) AS arena_games, count(*) FILTER (WHERE result->'complete'='true'::jsonb AND result->'win'='true'::jsonb) AS arena_wins`;
async function profileStats(db,a){const rows=await db.query('SELECT result FROM kekip_game_results WHERE account_id=$1 AND game=$2',[a.id,'battleship']);const battle={games:0,wins:0,losses:0,shots:0,hits:0,shipsSunk:0};for(const {result:r} of rows.rows){battle.games++;battle[r.win===true?'wins':'losses']++;battle.shots+=statNumber(r.shots);battle.hits+=statNumber(r.hits);battle.shipsSunk+=statNumber(r.shipsSunk)}const q=await db.query('SELECT code,data FROM kekip_football_rooms WHERE data @> $1::jsonb',[JSON.stringify({players:[{accountId:a.id}]})]);const football={careers:0,games:0,goals:0,assists:0};for(const row of q.rows){for(const p of row.data.players.filter(p=>p.accountId===a.id)){football.careers++;football.games+=statNumber(p.save?.games);football.goals+=statNumber(p.save?.goals);football.assists+=statNumber(p.save?.assists);}}const totals=await db.query(`SELECT (SELECT COALESCE(sum(xp),0) FROM kekip_mission_claims WHERE account_id=$1) AS mission_xp, (SELECT COALESCE(sum(amount),0) FROM kekip_admin_grants WHERE account_id=$1 AND kind='xp') AS admin_xp, ARRAY(SELECT source_id FROM kekip_coin_ledger WHERE account_id=$1 AND source_kind='login_streak') AS streak_rewards,${LATE_TOTALS}, (SELECT count(*) FROM kekip_game_results WHERE account_id=$1 AND game='arena' AND result->'complete'='true'::jsonb) AS arena_games, (SELECT count(*) FROM kekip_game_results WHERE account_id=$1 AND game='arena' AND result @> '{"complete":true,"win":true}'::jsonb) AS arena_wins FROM kekip_game_results WHERE account_id=$1 AND game='late_answer'`,[a.id]);return withProgress(battle,football,statNumber(totals.rows[0]?.mission_xp),statNumber(totals.rows[0]?.admin_xp),readLateStats(totals.rows[0]),totals.rows[0]?.streak_rewards||[],arenaStats(totals.rows[0]?.arena_games,totals.rows[0]?.arena_wins))}
// Read-only member leaderboard. Numeric values are sanitized and no private account or career identifiers leave the server.
function statNumber(v){const n=Number(v);return Number.isSafeInteger(n)&&n>=0?n:0;}
// Platform XP is derived from persisted match/career aggregates, not a client-submitted XP value.
// To integrate another game, add its verified persisted stats and contribution here.
function accountProgress(battle,football,bonus=0,adminBonus=0,lateAnswer=lateStats(),arena=arenaStats()){
  const battleXp=statNumber(battle.games)*20+Math.min(statNumber(battle.wins),statNumber(battle.games))*10;
  const footballXp=statNumber(football.games)*20+statNumber(football.goals)*5+statNumber(football.assists)*5;
  const lateAnswerXp=lateAnswer.games*20+Math.min(lateAnswer.wins,lateAnswer.games)*10;
  const arenaXp=arena.games*20+arena.wins*10;
  const missionXp=statNumber(bonus),adminXp=statNumber(adminBonus);const xp=Math.min(Number.MAX_SAFE_INTEGER,battleXp+footballXp+lateAnswerXp+arenaXp+missionXp+adminXp);
  // Level 1 starts at 0. Cost to advance: 100, 125, 150, ...
  const threshold=n=>100*n+25*n*(n-1)/2;
  let n=Math.max(0,Math.floor((Math.sqrt(87.5**2+50*xp)-87.5)/25));
  while(n>0&&threshold(n)>xp)n--;
  while(threshold(n+1)<=xp)n++;
  const level=n+1, levelXp=xp-threshold(n), nextLevelXp=100+25*n;
  return {xp,level,levelXp,nextLevelXp,remainingXp:nextLevelXp-levelXp,percent:Math.floor(100*levelXp/nextLevelXp),battleXp,footballXp,lateAnswerXp,arenaXp,missionXp,adminXp};
}
// Central achievement registry. Add future games by extending verified stats and this registry.
const ACHIEVEMENTS = [
 ...loginMilestones.map(({target,rarity,icon})=>({
  id:'login_streak_'+target,name:target+' Gün Giriş Serisi',icon,rarity,group:'Genel',
  target,description:target+' günlük giriş serisi ödülünü kazan.',
  value:s=>s.streakRewards.includes(String(target))?target:0
 })),
  {id:'late_first',name:'İlk Gecikme',icon:'⏳',group:'Gecikmeli Cevap',rarity:'normal',target:1,description:'Gecikmeli Cevap’ta bir maç tamamla.',value:s=>s.lateAnswer.games},
  {id:'late_wins',name:'Zaman Ustası',icon:'🏆',group:'Gecikmeli Cevap',rarity:'rare',target:5,description:'Gecikmeli Cevap’ta 5 maç kazan.',value:s=>s.lateAnswer.wins},
  {id:'late_correct',name:'Güçlü Hafıza',icon:'🧠',group:'Gecikmeli Cevap',rarity:'epic',target:25,description:'Yarışmacıyken 25 doğru cevap ver.',value:s=>s.lateAnswer.correct},
  {id:'first_match',name:'İlk Adım',icon:'🎮',group:'Genel',rarity:'normal',target:1,description:'İlk kayıtlı maçını tamamla.',value:s=>s.battle.games+s.football.games+s.lateAnswer.games},
  {id:'first_win',name:'Zaferin Tadı',icon:'🏆',group:'Amiral Battı',rarity:'normal',target:1,description:'Amiral Battı’da ilk galibiyetini kazan.',value:s=>s.battle.wins},
  {id:'naval_admiral',name:'Denizlerin Amirali',icon:'⚓',group:'Amiral Battı',rarity:'epic',target:25,description:'Amiral Battı’da 25 galibiyet kazan.',value:s=>s.battle.wins},
  {id:'sharpshooter',name:'Keskin Nişancı',icon:'🎯',group:'Amiral Battı',rarity:'rare',target:100,description:'Amiral Battı’da 100 isabetli atış yap.',value:s=>s.battle.hits},
  {id:'goal_machine',name:'Gol Makinesi',icon:'⚽',group:'Futbol Kariyer',rarity:'epic',target:50,description:'Futbol Kariyer’de 50 gol at.',value:s=>s.football.goals},
  {id:'playmaker',name:'Oyun Kurucu',icon:'👟',group:'Futbol Kariyer',rarity:'rare',target:25,description:'Futbol Kariyer’de 25 asist yap.',value:s=>s.football.assists},
  {id:'game_fan',name:'Oyun Tutkunu',icon:'🔥',group:'Genel',rarity:'legendary',target:100,description:'Toplam 100 kayıtlı maç tamamla.',value:s=>s.battle.games+s.football.games+s.lateAnswer.games},
  {id:'kekip_legend',name:'KEKIP Efsanesi',icon:'💎',group:'Genel',rarity:'mythic',target:50,description:'KEKIP hesabında 50. seviyeye ulaş.',value:s=>s.progress.level},
  {id:'ten_matches',name:'Sahaya Alıştın',icon:'🎮',group:'Genel',rarity:'normal',target:10,description:'Toplam 10 kayıtlı maç tamamla.',value:s=>s.battle.games+s.football.games+s.lateAnswer.games},
  {id:'level_five',name:'Yükselen Yıldız',icon:'🌟',group:'Genel',rarity:'normal',target:5,description:'KEKIP hesabında 5. seviyeye ulaş.',value:s=>s.progress.level},
  {id:'level_fifteen',name:'Seçkin Oyuncu',icon:'👑',group:'Genel',rarity:'epic',target:15,description:'KEKIP hesabında 15. seviyeye ulaş.',value:s=>s.progress.level},
  {id:'mission_xp_500',name:'Görev Avcısı',icon:'📋',group:'Genel',rarity:'rare',target:500,description:'Görevlerden toplam 500 XP kazan.',value:s=>s.progress.missionXp},
  {id:'matches_250',name:'Durmak Yok',icon:'🚀',group:'Genel',rarity:'mythic',target:250,description:'Toplam 250 kayıtlı maç tamamla.',value:s=>s.battle.games+s.football.games+s.lateAnswer.games},
  {id:'battle_wins_5',name:'Denizci',icon:'🛟',group:'Amiral Battı',rarity:'normal',target:5,description:'Amiral Battı’da 5 galibiyet kazan.',value:s=>s.battle.wins},
  {id:'battle_wins_10',name:'Filo Komutanı',icon:'🧭',group:'Amiral Battı',rarity:'rare',target:10,description:'Amiral Battı’da 10 galibiyet kazan.',value:s=>s.battle.wins},
  {id:'battle_wins_50',name:'Okyanusun Hâkimi',icon:'🌊',group:'Amiral Battı',rarity:'legendary',target:50,description:'Amiral Battı’da 50 galibiyet kazan.',value:s=>s.battle.wins},
  {id:'battle_hits_20',name:'Hedef Kilitli',icon:'💥',group:'Amiral Battı',rarity:'normal',target:20,description:'Amiral Battı’da 20 isabetli atış yap.',value:s=>s.battle.hits},
  {id:'battle_hits_250',name:'Kusursuz Nişancı',icon:'🏹',group:'Amiral Battı',rarity:'epic',target:250,description:'Amiral Battı’da 250 isabetli atış yap.',value:s=>s.battle.hits},
  {id:'battle_ships_50',name:'Filo Avcısı',icon:'🚢',group:'Amiral Battı',rarity:'epic',target:50,description:'Amiral Battı’da toplam 50 gemi batır.',value:s=>s.battle.shipsSunk},
  {id:'football_first_goal',name:'İlk Gol',icon:'🥅',group:'Futbol Kariyer',rarity:'normal',target:1,description:'Futbol Kariyer’de ilk golünü at.',value:s=>s.football.goals},
  {id:'football_matches_10',name:'İlk 11',icon:'👕',group:'Futbol Kariyer',rarity:'normal',target:10,description:'Futbol Kariyer’de 10 maç tamamla.',value:s=>s.football.games},
  {id:'football_assists_10',name:'Takım Oyuncusu',icon:'🤝',group:'Futbol Kariyer',rarity:'normal',target:10,description:'Futbol Kariyer’de 10 asist yap.',value:s=>s.football.assists},
  {id:'football_goals_100',name:'Gol Kralı',icon:'🏅',group:'Futbol Kariyer',rarity:'legendary',target:100,description:'Futbol Kariyer’de toplam 100 gol at.',value:s=>s.football.goals},
  {id:'football_matches_100',name:'Saha Efsanesi',icon:'🏟️',group:'Futbol Kariyer',rarity:'legendary',target:100,description:'Futbol Kariyer’de 100 maç tamamla.',value:s=>s.football.games}
];
function accountAchievements(stats){
  return ACHIEVEMENTS.map(({value,...definition})=>{
    const current=Math.min(definition.target,statNumber(value(stats)));
    return {...definition,current,unlocked:current>=definition.target};
  });
}
// 0.51.7.4: special titles derived from verified achievements. Legacy badge IDs stay selectable.
const SPECIAL_TITLES=Object.freeze({
 ten_matches:'Arena Yolcusu', level_five:'Parlayan Yıldız', level_fifteen:'Elit Rakip', mission_xp_500:'Görev Ustası', matches_250:'Durdurulamaz', kekip_legend:'KEKIP Hanedanı',
 battle_wins_10:'Filo Stratejisti', naval_admiral:'Denizlerin Hükümdarı', battle_wins_50:'Okyanus Fatihi', battle_hits_250:'Kusursuz Atıcı', football_goals_100:'Altın Ayakkabı', football_matches_100:'Yeşil Sahanın Kralı'
});
function accountTitles(achievements){
 return achievements.flatMap(a=>{const base={id:a.id,name:a.name,rarity:a.rarity,group:a.group,description:a.description,current:a.current,target:a.target,unlocked:a.unlocked,special:false};const name=SPECIAL_TITLES[a.id];return name?[base,{...base,id:'earned_title_'+a.id,name,special:true}]:[base]});
}
function withProgress(battle,football,bonus=0,adminBonus=0,lateAnswer=lateStats(),streakRewards=[],arena=arenaStats()){const stats={battle,football,lateAnswer,arena,progress:accountProgress(battle,football,bonus,adminBonus,lateAnswer,arena)};return {...stats,achievements:accountAchievements({...stats,streakRewards})};}

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
  ), late AS (SELECT account_id,${LATE_TOTALS} FROM kekip_game_results WHERE game='late_answer' GROUP BY account_id), arena AS (SELECT account_id,${ARENA_TOTALS} FROM kekip_game_results WHERE game='arena' GROUP BY account_id)
  SELECT a.username, ar.arena_games,ar.arena_wins, l.late_games,l.late_wins,l.late_correct,l.late_forfeits,b.games AS battle_games, b.wins, b.shots, b.hits, b.ships_sunk,
    f.careers, f.games AS football_games, f.goals, f.assists, COALESCE(m.xp,0) AS mission_xp, COALESCE(g.xp,0) AS admin_xp
    FROM kekip_football_accounts a LEFT JOIN battle b ON b.account_id=a.id LEFT JOIN football f ON f.account_id=a.id LEFT JOIN late l ON l.account_id=a.id LEFT JOIN arena ar ON ar.account_id=a.id LEFT JOIN (SELECT account_id,sum(xp) AS xp FROM kekip_mission_claims GROUP BY account_id) m ON m.account_id=a.id LEFT JOIN (SELECT account_id,sum(amount) AS xp FROM kekip_admin_grants WHERE kind='xp' GROUP BY account_id) g ON g.account_id=a.id
    WHERE a.blocked_at IS NULL
    ORDER BY a.username`);
  return {viewer:viewer.username,players:q.rows.map(r=>{
    const games=statNumber(r.battle_games), wins=Math.min(games,statNumber(r.wins)), shots=statNumber(r.shots), hits=Math.min(shots,statNumber(r.hits));
    const battle={games,wins,losses:games-wins,shots,hits,shipsSunk:statNumber(r.ships_sunk)},football={careers:statNumber(r.careers),games:statNumber(r.football_games),goals:statNumber(r.goals),assists:statNumber(r.assists)};
    return {username:r.username,...withProgress(battle,football,statNumber(r.mission_xp),statNumber(r.admin_xp),readLateStats(r),[],arenaStats(r.arena_games,r.arena_wins))};
  })};
}
// Periodic rankings use immutable server-side match records, not room update timestamps.
async function periodLeaderboard(db){
  const q=await db.query(`WITH local_clock AS (SELECT now() AT TIME ZONE 'Europe/Istanbul' AS t),
  local_bounds AS (SELECT 'week'::text AS period, date_trunc('week',t) AS start_local, date_trunc('week',t)+interval '1 week' AS end_local FROM local_clock
    UNION ALL SELECT 'month',date_trunc('month',t),date_trunc('month',t)+interval '1 month' FROM local_clock),
  bounds AS (SELECT period,start_local AT TIME ZONE 'Europe/Istanbul' AS starts_at,end_local AT TIME ZONE 'Europe/Istanbul' AS ends_at FROM local_bounds),
  totals AS (SELECT b.period,r.account_id,r.game,count(*) FILTER (WHERE r.game NOT IN ('late_answer','arena') OR r.result->'complete'='true'::jsonb) AS games,
    count(*) FILTER (WHERE r.result->'win'='true'::jsonb) AS wins,
    sum(CASE WHEN (r.result->>'shots') ~ '^[0-9]{1,9}$' THEN (r.result->>'shots')::bigint ELSE 0 END) AS shots,
    sum(CASE WHEN (r.result->>'hits') ~ '^[0-9]{1,9}$' THEN (r.result->>'hits')::bigint ELSE 0 END) AS hits,
    sum(CASE WHEN (r.result->>'shipsSunk') ~ '^[0-9]{1,9}$' THEN (r.result->>'shipsSunk')::bigint ELSE 0 END) AS ships_sunk,
    sum(CASE WHEN (r.result->>'goals') ~ '^[0-9]{1,9}$' THEN (r.result->>'goals')::bigint ELSE 0 END) AS goals,
    sum(CASE WHEN (r.result->>'assists') ~ '^[0-9]{1,9}$' THEN (r.result->>'assists')::bigint ELSE 0 END) AS assists
    ,${LATE_TOTALS}
    FROM bounds b JOIN kekip_game_results r ON r.created_at>=b.starts_at AND r.created_at<b.ends_at AND r.created_at<=now()
    WHERE r.game IN ('battleship','football','late_answer','arena') GROUP BY b.period,r.account_id,r.game), mission_totals AS (SELECT b.period,c.account_id,sum(c.xp) AS xp FROM bounds b JOIN kekip_mission_claims c ON c.claimed_at>=b.starts_at AND c.claimed_at<b.ends_at AND c.claimed_at<=now() GROUP BY b.period,c.account_id), entries AS (SELECT period,account_id,game,games,wins,shots,hits,ships_sunk,goals,assists,late_games,late_wins,late_correct,late_forfeits,0::bigint AS mission_xp FROM totals UNION ALL SELECT period,account_id,'mission',0,0,0,0,0,0,0,0,0,0,0,xp FROM mission_totals)
  SELECT b.period,b.starts_at,b.ends_at,a.username,t.game,t.games,t.wins,t.shots,t.hits,t.ships_sunk,t.goals,t.assists,t.late_games,t.late_wins,t.late_correct,t.late_forfeits,t.mission_xp
  FROM bounds b LEFT JOIN entries t ON t.period=b.period LEFT JOIN kekip_football_accounts a ON a.id=t.account_id AND a.blocked_at IS NULL
  ORDER BY b.period,a.username,t.game`);
  const periods={};
  for(const r of q.rows){
    const period=periods[r.period]||(periods[r.period]={start:r.starts_at,end:r.ends_at,players:[],byName:new Map()});
    if(!r.username)continue;
    let p=period.byName.get(r.username);
    if(!p){p={username:r.username,battle:{games:0,wins:0,losses:0,shots:0,hits:0,shipsSunk:0},football:{games:0,goals:0,assists:0,careers:0},lateAnswer:lateStats(),arena:arenaStats()};period.byName.set(r.username,p);period.players.push(p)}
    const games=statNumber(r.games);
    if(r.game==='battleship'){const wins=Math.min(games,statNumber(r.wins)),shots=statNumber(r.shots);p.battle={games,wins,losses:games-wins,shots,hits:Math.min(shots,statNumber(r.hits)),shipsSunk:statNumber(r.ships_sunk)}}
    if(r.game==='football')Object.assign(p.football,{games,goals:statNumber(r.goals),assists:statNumber(r.assists)});if(r.game==='late_answer')p.lateAnswer=readLateStats(r);if(r.game==='arena')p.arena=arenaStats(games,r.wins);if(r.game==='mission')p.missionXp=statNumber(r.mission_xp);
  }
  for(const p of Object.values(periods)){delete p.byName;for(const player of p.players){const x=accountProgress(player.battle,player.football,player.missionXp,0,player.lateAnswer,player.arena);player.periodXp=x.xp;}}
  return periods;
}
// Administrator key is configured only in the hosting environment, never in client files.
function adminNames(){return (process.env.KEKIP_ADMIN_USERNAMES||'').trim().replace(/^['"]|['"]$/g,'').split(/[,\r\n]+/).map(n=>n.trim().replace(/^['"]|['"]$/g,'').trim().replace(/^@/,'').toLowerCase()).filter(n=>/^[a-z0-9_]{3,24}$/.test(n));}
function adminEligible(a){return Boolean(a&&typeof a.username==='string'&&adminNames().includes(a.username.trim().toLowerCase()));}
function adminAccessStatus(a){const eligible=adminEligible(a);return {revision:'0.51.19.1',username:a?.username||null,isAdmin:eligible,status:!a?'login_required':!eligible?'not_authorized':(process.env.KEKIP_ADMIN_KEY||'').length<32?'key_not_configured':'ready'};}
async function requireAdmin(req,b,db){const actor=await getAccount(db,req);if(!actor)fail('Önce yönetici hesabınla giriş yap.',401);if(!adminEligible(actor))fail('Bu hesap yönetici olarak yetkilendirilmemiş.',403);const expected=process.env.KEKIP_ADMIN_KEY||'';if(expected.length<32)fail('Yönetici anahtarı sunucuda henüz ayarlanmadı.',503);const supplied=typeof b.adminKey==='string'?b.adminKey:'';if(supplied.length>256||!crypto.timingSafeEqual(Buffer.from(hash(supplied),'hex'),Buffer.from(hash(expected),'hex'))){throttle(req,'admin-access');fail('Yönetici anahtarı geçersiz.',403)}return actor;}
async function inviteAction(db,req,action,b){await requireAdmin(req,b,db);if(action==='invite-list'){const q=await db.query('SELECT id,username,created_at,expires_at,used_at,revoked_at FROM kekip_registration_invites ORDER BY created_at DESC LIMIT 200');return {invites:q.rows};}if(action==='invite-create'){const name=typeof b.username==='string'?b.username.trim().toLowerCase():'';if(!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı 3–24 harf/rakam/alt çizgi olmalı.');const existing=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1',[name]);if(existing.rows.length)fail('Bu kullanıcı zaten kayıtlı.',409);const code=token(),id=crypto.randomBytes(12).toString('hex');await db.query(`WITH created AS (INSERT INTO kekip_registration_invites(id,username,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '7 days') RETURNING username) INSERT INTO kekip_admin_audit(username,action) SELECT username,'invite-create' FROM created`,[id,name,hash(code)]);return {username:name,code};}if(action==='invite-revoke'){if(typeof b.id!=='string'||!/^[a-f0-9]{24}$/.test(b.id))fail('Davet geçersiz.');const q=await db.query(`WITH changed AS (UPDATE kekip_registration_invites SET revoked_at=now() WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL RETURNING username) INSERT INTO kekip_admin_audit(username,action) SELECT username,'invite-revoke' FROM changed RETURNING id`,[b.id]);if(!q.rows.length)fail('Davet zaten kullanılmış veya iptal edilmiş.',409);return {ok:true};}fail('İşlem bulunamadı.',404)}


// Admin-only management. No password hashes, session tokens or career secrets are returned.
async function adminAction(db,req,action,b,options){
 const actor=await requireAdmin(req,b,db);
 if(action==='admin-system-status'){
  const start=Date.now();
  // Count only current valid sessions; respect users' hidden presence preference.
  const presence=await db.query(`WITH latest AS (
   SELECT DISTINCT ON (p.account_id) p.account_id,p.activity FROM kekip_presence p
   JOIN kekip_football_sessions s ON s.token_hash=p.token_hash AND s.account_id=p.account_id
   JOIN kekip_football_accounts a ON a.id=p.account_id
   LEFT JOIN kekip_player_profiles pp ON pp.account_id=p.account_id
   WHERE p.seen_at>now()-interval '80 seconds' AND s.expires_at>now() AND a.blocked_at IS NULL
    AND coalesce(pp.data->'privacy'->>'presence','friends')<>'hidden'
   ORDER BY p.account_id,(p.activity<>'home') DESC,p.seen_at DESC
  ) SELECT activity,count(*)::int AS count FROM latest GROUP BY activity`);
  const online={home:0,battleship:0,football:0};for(const r of presence.rows)if(Object.hasOwn(online,r.activity))online[r.activity]=r.count;
  const football=await db.query(`SELECT count(*)::int AS total,
   count(*) FILTER(WHERE updated_at>now()-interval '15 minutes')::int AS recent,
   count(*) FILTER(WHERE updated_at>now()-interval '15 minutes' AND data->>'stage'='lobby')::int AS lobby,
   count(*) FILTER(WHERE updated_at>now()-interval '15 minutes' AND data->>'stage'='playing')::int AS playing,
   count(*) FILTER(WHERE updated_at>now()-interval '15 minutes' AND data->>'stage'='results')::int AS results
   FROM kekip_football_rooms`);
  return {sampledAt:new Date().toISOString(),presence:online,football:football.rows[0],battle:typeof options.adminBattleSnapshot==='function'?options.adminBattleSnapshot():null,system:{database:'ok',queryMs:Date.now()-start,uptimeSeconds:Math.floor(process.uptime()),rssMb:Math.round(process.memoryUsage().rss/1048576)}};
 }
 if(action==='admin-audit'){
  const search=b.search===undefined?'':b.search, category=b.category===undefined?'all':b.category, page=b.page===undefined?1:b.page;
  if(typeof search!=='string'||!/^[a-z0-9_]{0,24}$/.test(search)||!['all','account','invite','chat','reward','other'].includes(category)||!Number.isSafeInteger(page)||page<1||page>1000000)fail('Geçmiş filtresi geçersiz.');
  const group=`CASE WHEN action IN ('admin-block','admin-unblock','admin-reset','admin-revoke-sessions') THEN 'account' WHEN action IN ('invite-create','invite-revoke') THEN 'invite' WHEN action IN ('admin-mute','admin-unmute','admin-delete') THEN 'chat' WHEN action LIKE 'Ödül · %' THEN 'reward' ELSE 'other' END`;
  const where=`(strpos(username,$1)>0 OR $1='') AND ($2='all' OR (${group})=$2)`;
  const count=await db.query(`SELECT count(*)::int AS total FROM kekip_admin_audit WHERE ${where}`,[search,category]);
  const total=count.rows[0].total,size=25,pages=Math.max(1,Math.ceil(total/size)),current=Math.min(page,pages);
  const rows=await db.query(`SELECT id::text,username,action,created_at,${group} AS category FROM kekip_admin_audit WHERE ${where} ORDER BY kekip_admin_audit.id DESC LIMIT $3 OFFSET $4`,[search,category,size,(current-1)*size]);
  return {records:rows.rows,pagination:{page:current,pages,total,size}};
 }
 if(action==='admin-kc-lookup'){
  if(typeof b.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(b.username))fail('Kullanıcı adı geçersiz.');
  const q=await db.query('SELECT id,username,blocked_at FROM kekip_football_accounts WHERE username=$1',[b.username]);const a=q.rows[0];if(!a)fail('Üye bulunamadı.',404);
  return {username:a.username,blocked:Boolean(a.blocked_at),balance:await coinBalance(db,a)};
 }
 if(action==='admin-cosmetic-lookup'){
  if(typeof b.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(b.username))fail('Kullanıcı adı geçersiz.');
  const q=await db.query('SELECT id,username,blocked_at FROM kekip_football_accounts WHERE username=$1',[b.username]);const a=q.rows[0];if(!a)fail('Üye bulunamadı.',404);
  const inv=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[a.id]);const owned=new Set(inv.rows.map(r=>r.item_id));
  return {username:a.username,blocked:Boolean(a.blocked_at),items:adminChestGiftCatalog().map(i=>({...i,owned:owned.has(i.id)}))};
 }
 if(action==='admin-grant')return adminGrant(db,b,actor);
 if(action==='admin-members'){
  const search=typeof b.search==='string'?b.search.trim().toLowerCase():'';
  if(!/^[a-z0-9_]{0,24}$/.test(search))fail('Arama geçersiz.');
  const status=b.status===undefined?'all':b.status, sort=b.sort===undefined?'name':b.sort;
  const orders={name:'a.username ASC',newest:'a.created_at DESC,a.username ASC',oldest:'a.created_at ASC,a.username ASC'};
  if(!['all','active','blocked'].includes(status)||!Object.hasOwn(orders,sort))fail('Üye filtresi geçersiz.');
  const page=b.page===undefined?1:b.page, size=b.page===undefined?200:25;
  if(!Number.isSafeInteger(page)||page<1||page>1000000)fail('Sayfa geçersiz.');
  const where="(strpos(a.username,$1)>0 OR $1='') AND ($2='all' OR ($2='active' AND a.blocked_at IS NULL) OR ($2='blocked' AND a.blocked_at IS NOT NULL))";
  const filtered=await db.query(`SELECT count(*)::int AS total FROM kekip_football_accounts a WHERE ${where}`,[search,status]);
  const count=filtered.rows[0].total, pages=Math.max(1,Math.ceil(count/size)), currentPage=Math.min(page,pages);
  const q=await db.query(`SELECT a.username,a.created_at,a.blocked_at,(SELECT count(*)::int FROM kekip_football_sessions s WHERE s.account_id=a.id AND s.expires_at>now()) AS sessions FROM kekip_football_accounts a WHERE ${where} ORDER BY ${orders[sort]} LIMIT $3 OFFSET $4`,[search,status,size,(currentPage-1)*size]);
  const totals=await db.query('SELECT count(*)::int AS total,count(*) FILTER (WHERE blocked_at IS NOT NULL)::int AS blocked FROM kekip_football_accounts');
  const audit=await db.query('SELECT username,action,created_at FROM kekip_admin_audit ORDER BY id DESC LIMIT 50');
  return {members:q.rows,totals:totals.rows[0],audit:audit.rows,pagination:{page:currentPage,pages,total:count,size}};
 }
 if(action==='admin-member-detail'){
  if(typeof b.username!=='string'||!/^[a-z0-9_]{3,24}$/.test(b.username))fail('Kullanıcı adı geçersiz.');
  const q=await db.query(`SELECT a.id,a.username,a.created_at,a.blocked_at,(SELECT count(*)::int FROM kekip_football_sessions s WHERE s.account_id=a.id AND s.expires_at>now()) AS sessions,EXISTS(SELECT 1 FROM kekip_modular_avatars m WHERE m.account_id=a.id AND m.character IN ('gece','golge')) AS onboarded FROM kekip_football_accounts a WHERE a.username=$1`,[b.username]);
  const a=q.rows[0];if(!a)fail('Üye bulunamadı.',404);
  const stats=await profileStats(db,a);
  const inventory=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1 ORDER BY item_id',[a.id]);
  const catalog=adminGiftCatalog();const allItems=new Map([...COSMETICS,...Object.values(Wardrobe.collections).flatMap(c=>c.items),...Object.values(ChestCollections).flatMap(c=>c.items)].map(i=>[i.id,i.name||i.id]));
  const owned=inventory.rows.map(r=>({id:r.item_id,name:allItems.get(r.item_id)||r.item_id}));
  return {economy:{balance:await coinBalance(db,a),adminXp:stats.progress.adminXp,owned,catalog},member:{username:a.username,created_at:a.created_at,blocked_at:a.blocked_at,sessions:a.sessions,onboarded:a.onboarded},progress:{level:stats.progress.level,xp:stats.progress.xp},battle:stats.battle,football:stats.football,achievements:{earned:stats.achievements.filter(x=>x.unlocked).length,total:stats.achievements.length}};
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
 await c.query('INSERT INTO kekip_admin_audit(username,action) VALUES($1,$2)',[b.username,action]);await AccountHistory.recordAccountEvent(c,id,action);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
 if(action!=='admin-unblock')options.disconnectAccount?.(id);
 return {ok:true,...(password?{password}:{})};
}
async function changePassword(db,req,res,b,options){
 const a=await requireAccount(db,req);if(b.username!==undefined&&b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const old=b.oldPassword,next=b.newPassword;
 if(typeof old!=='string'||typeof next!=='string'||old.length<10||old.length>128||next.length<10||next.length>128||old===next)fail('Yeni şifre farklı ve 10–128 karakter olmalı.');
 throttle(req,a.username);if(inFlight>=4)fail('Sunucu yoğun.',429);inFlight++;let c;
 try{c=await db.connect();await c.query('BEGIN');const q=await c.query('SELECT password_hash,blocked_at FROM kekip_football_accounts WHERE id=$1 FOR UPDATE',[a.id]);if(!q.rows.length||q.rows[0].blocked_at||!await verifyPassword(old,q.rows[0].password_hash))fail('Mevcut şifre yanlış veya hesap kapalı.',403);
 await c.query('UPDATE kekip_football_accounts SET password_hash=$2 WHERE id=$1',[a.id,await passwordHash(next)]);await c.query('DELETE FROM kekip_football_sessions WHERE account_id=$1',[a.id]);await AccountHistory.recordAccountEvent(c,a.id,'password-change');await c.query('COMMIT');
 }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});throw e}finally{c?.release();inFlight--}
 options.disconnectAccount?.(a.id);cookie(res,req,'',0);clearLegacy(res,req);return {ok:true};
}

// Shared platform profile: private writes, member-only reads, no remote image URLs.
// Privacy lives in the existing profile JSONB; no migration or overwrite of existing profile fields.
const PRIVACY_VALUES={profile:['members','friends','self'],stats:['members','friends','self'],presence:['friends','hidden']};
function profilePrivacy(data){const p=data?.privacy||{};return Object.fromEntries(Object.entries(PRIVACY_VALUES).map(([key,values])=>[key,values.includes(p[key])?p[key]:values[0]]));}
function profileRelationship(row,viewer){return row.id===viewer.id?'self':row.status==='accepted'?'friend':row.status==='pending'?(row.requested_by===viewer.id?'outgoing':'incoming'):'none';}
function privacyAllows(scope,relationship){return relationship==='self'||scope==='members'||(scope==='friends'&&relationship==='friend');}
async function saveProfilePrivacy(db,a,b){if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const p=b.privacy;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==3||Object.entries(PRIVACY_VALUES).some(([key,values])=>!values.includes(p[key])))fail('Gizlilik seçimi geçersiz.');const privacy=profilePrivacy({privacy:p});await db.query(`INSERT INTO kekip_player_profiles(account_id,data) VALUES($1,$2::jsonb) ON CONFLICT(account_id) DO UPDATE SET data=COALESCE(kekip_player_profiles.data,'{}'::jsonb)||EXCLUDED.data`,[a.id,JSON.stringify({privacy})]);return {username:a.username,privacy};}
// 0.51.9.5: private account experience preferences; atomic field-level merge.
const UI_PREF_KEYS=['sound','ambient','effects','social','messages','achievements'];
function uiPreferences(data){const value=data?.uiPreferences;return Object.fromEntries(UI_PREF_KEYS.map(k=>[k,typeof value?.[k]==='boolean'?value[k]:true]));}
async function readUiPreferences(db,a){if(!a)return {username:null,preferences:null};const q=await db.query('SELECT data FROM kekip_player_profiles WHERE account_id=$1',[a.id]);return {username:a.username,preferences:uiPreferences(q.rows[0]?.data)};}
async function saveUiPreferences(db,a,b){
 if(!a)fail('Önce hesabına giriş yap.',401);
 if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
 const patch=b.preferences,keys=patch&&typeof patch==='object'&&!Array.isArray(patch)?Object.keys(patch):[];
 if(!keys.length||keys.length>UI_PREF_KEYS.length||keys.some(k=>!UI_PREF_KEYS.includes(k)||typeof patch[k]!=='boolean'))fail('Tercihler geçersiz.');
 const q=await db.query(`INSERT INTO kekip_player_profiles(account_id,data) VALUES($1,$2::jsonb)
 ON CONFLICT(account_id) DO UPDATE SET data=jsonb_set(COALESCE(kekip_player_profiles.data,'{}'::jsonb),'{uiPreferences}',
 (CASE WHEN jsonb_typeof(kekip_player_profiles.data->'uiPreferences')='object' THEN kekip_player_profiles.data->'uiPreferences' ELSE '{}'::jsonb END) || (EXCLUDED.data->'uiPreferences'),true) RETURNING data`,[a.id,JSON.stringify({uiPreferences:patch})]);
 return {username:a.username,preferences:uiPreferences(q.rows[0]?.data)};
}
const PROFILE_COVERS=['violet','midnight','ocean','ember','forest','aurora'];
function profilePhoto(v){if(v==='')return '';if(typeof v!=='string'||v.length>44000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(v))fail('Profil fotoğrafı geçersiz.');const encoded=v.slice(23),buf=Buffer.from(encoded,'base64');if(buf.length<12||buf.length>32768||buf.toString('base64')!==encoded||buf[0]!==255||buf[1]!==216||buf[buf.length-2]!==255||buf[buf.length-1]!==217)fail('Profil fotoğrafı geçersiz veya çok büyük.');return v}
function cleanProfile(b,stats){
 if(!b||typeof b!=='object'||Array.isArray(b))fail('Profil bilgileri geçersiz.');
 if(typeof b.bio!=='string'||b.bio.length>160)fail('Biyografi en fazla 160 karakter olabilir.');
 if(!PROFILE_COVERS.includes(b.cover))fail('Kapak teması geçersiz.');
 const earned=new Set(stats.achievements.filter(a=>a.unlocked).map(a=>a.id));
 const earnedTitles=new Set(accountTitles(stats.achievements).filter(a=>a.unlocked).map(a=>a.id));
 if(typeof b.title!=='string'||(b.title!==''&&!earnedTitles.has(b.title)))fail('Bu unvan henüz kazanılmadı.');
 if(!Array.isArray(b.featured)||b.featured.length>3||new Set(b.featured).size!==b.featured.length||b.featured.some(x=>typeof x!=='string'||!earned.has(x)))fail('En fazla 3 kazanılmış rozet seçebilirsin.');
 return {bio:b.bio.trim(),cover:b.cover,title:b.title,featured:b.featured,photo:profilePhoto(b.photo)};
}
async function readPlayerProfile(db,username,viewer){
 const q=await db.query(`SELECT a.id,a.username,p.data,f.status,f.requested_by FROM kekip_football_accounts a LEFT JOIN kekip_player_profiles p ON p.account_id=a.id LEFT JOIN kekip_friendships f ON f.low_id=LEAST(a.id,$2) AND f.high_id=GREATEST(a.id,$2) WHERE a.username=$1 AND a.blocked_at IS NULL`,[username,viewer.id]);
 if(!q.rows.length)fail('Oyuncu bulunamadı.',404);
 const d=q.rows[0].data||{};
 if(!privacyAllows(profilePrivacy(d).profile,profileRelationship(q.rows[0],viewer)))fail('Bu profil gizli.',403);
 return {username:q.rows[0].username,profile:{bio:d.bio||'',cover:d.cover||'violet',title:d.title||'',featured:d.featured||[],photo:d.photo||'',modularAvatar:await Wardrobe.readSaved(db,q.rows[0].id),cosmetics:await equippedCosmetics(db,q.rows[0].id)}};
}
// Member-only player profile; return only public, verified fields, never coins or account IDs.
async function resolvePlayerProfile(db,viewer,username){
 if(typeof username!=='string'||!/^[a-z0-9_]{3,24}$/.test(username))fail('Kullanıcı adı geçersiz.');
 const q=await db.query(`SELECT a.id,a.username,p.data,f.status,f.requested_by FROM kekip_football_accounts a LEFT JOIN kekip_player_profiles p ON p.account_id=a.id LEFT JOIN kekip_friendships f ON f.low_id=LEAST(a.id,$2) AND f.high_id=GREATEST(a.id,$2) WHERE a.username=$1 AND a.blocked_at IS NULL`,[username,viewer.id]);
 if(!q.rows.length)fail('Oyuncu bulunamadı.',404);
 const row=q.rows[0],d=row.data||{},privacy=profilePrivacy(d),relationship=profileRelationship(row,viewer);
 const visible=privacyAllows(privacy.profile,relationship),statsVisible=visible&&privacyAllows(privacy.stats,relationship);
 const base={username:row.username,relationship,profileVisible:visible,statsVisible,...(relationship==='self'?{privacy}:{})};
 return {row,d,base,visible,statsVisible,relationship};
}
async function visitPlayerProfile(db,viewer,username){
 const {row,d,base,visible,statsVisible,relationship}=await resolvePlayerProfile(db,viewer,username);
 if(!visible)return base;
 const showcase=await ProfileExtras.readShowcase(db,row.id,d,{self:relationship==='self',statsVisible});
 const stats=await profileStats(db,{id:row.id});
 const earned=stats.achievements.filter(x=>x.unlocked),badge=x=>({id:x.id,name:x.name,icon:x.icon,rarity:x.rarity});
 const title=accountTitles(stats.achievements).find(x=>x.unlocked&&x.id===d.title),featured=Array.isArray(d.featured)?d.featured.slice(0,3).map(id=>earned.find(x=>x.id===id)).filter(Boolean).map(badge):[];
 return {...base,showcase,bio:typeof d.bio==='string'?d.bio.slice(0,160):'',cover:PROFILE_COVERS.includes(d.cover)?d.cover:'violet',title:title?title.name:'KEKIP Oyuncusu',titleRarity:title?title.rarity:null,featured,...(statsVisible?{achievementCount:earned.length,achievementTotal:stats.achievements.length,progress:{xp:stats.progress.xp,level:stats.progress.level,percent:stats.progress.percent},battle:{games:stats.battle.games,wins:stats.battle.wins,hits:stats.battle.hits,shots:stats.battle.shots},football:{games:stats.football.games,goals:stats.football.goals,assists:stats.football.assists},lateAnswer:stats.lateAnswer}:{})};
}
async function savePlayerProfile(db,a,b){const data=cleanProfile(b,await profileStats(db,a));await db.query(`INSERT INTO kekip_player_profiles(account_id,data) VALUES($1,$2::jsonb) ON CONFLICT(account_id) DO UPDATE SET data=COALESCE(kekip_player_profiles.data,'{}'::jsonb)||EXCLUDED.data`,[a.id,JSON.stringify(data)]);return {username:a.username,profile:{...data,modularAvatar:await Wardrobe.readSaved(db,a.id),cosmetics:await equippedCosmetics(db,a.id)}};}

// One canonical row per pair; only the receiver may accept/reject a pending request.
async function friendAction(db,a,action,b){
 const state=r=>!r.status?'none':r.status==='accepted'?'friend':r.requested_by===a.id?'outgoing':'incoming';
 const publicRow=r=>({username:r.username,state:state(r)});
 if(action==='friends-list'){
  const q=await db.query(`SELECT u.username,f.status,f.requested_by FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END WHERE (f.low_id=$1 OR f.high_id=$1) AND u.blocked_at IS NULL ORDER BY u.username`,[a.id]);
  return {username:a.username,people:q.rows.map(publicRow)};
 }
 if(action==='friends-search'){
  const term=typeof b.query==='string'?b.query.trim().toLowerCase():'';
  if(!/^[a-z0-9_]{2,24}$/.test(term))fail('Aramak için en az 2 harf veya rakam yaz.');
  const q=await db.query(`SELECT u.username,f.status,f.requested_by FROM kekip_football_accounts u LEFT JOIN kekip_friendships f ON ((f.low_id=$1 AND f.high_id=u.id) OR (f.high_id=$1 AND f.low_id=u.id)) WHERE u.id<>$1 AND u.blocked_at IS NULL AND strpos(u.username,$2)>0 ORDER BY (u.username=$2) DESC,u.username LIMIT 30`,[a.id,term]);
  return {people:q.rows.map(publicRow)};
 }
 const name=typeof b.username==='string'?b.username.trim().toLowerCase():'';
 if(!/^[a-z0-9_]{3,24}$/.test(name)||name===a.username)fail('Geçerli başka bir oyuncu seç.');
 const q=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1 AND blocked_at IS NULL',[name]);
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
 if(action==='friends-remove'){dmTyping.delete(dmTypingKey(low,high));dmTyping.delete(dmTypingKey(high,low));}
 return {ok:true};
}

// Friend-only presence and short-lived lobby invites. Never disclose room codes in presence.
async function socialRoomOpen(db,game,code,sender,receiver,options){
 if(game==='battleship')return !!options.battleInviteOpen?.(code,sender,receiver);
 if(game==='late_answer')return !!options.lateInviteOpen?.(code,sender,receiver);
 const q=await db.query('SELECT data FROM kekip_football_rooms WHERE code=$1',[code]);const r=q.rows[0]?.data;
 return !!(r?.stage==='lobby'&&!r.partyPending&&Array.isArray(r.players)&&r.players.length<8&&r.players.some(p=>p.accountId===sender)&&!r.players.some(p=>p.accountId===receiver));
}
async function socialAction(db,req,a,action,b,options){
 if(action==='social-pulse'){
  if(!['home','battleship','football','late_answer'].includes(b.activity))fail('Geçersiz durum.');
  await db.query(`INSERT INTO kekip_presence(token_hash,account_id,activity) SELECT token_hash,account_id,$3 FROM kekip_football_sessions WHERE token_hash=$1 AND account_id=$2 AND expires_at>now() ON CONFLICT(token_hash) DO UPDATE SET activity=EXCLUDED.activity,seen_at=now()`,[hash(sessionToken(req)),a.id,b.activity]);
  const f=await db.query(`SELECT u.username,CASE WHEN pp.data->'privacy'->>'presence'='hidden' THEN 'offline' ELSE coalesce(p.activity,'offline') END AS activity FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END LEFT JOIN kekip_player_profiles pp ON pp.account_id=u.id LEFT JOIN LATERAL (SELECT pr.activity FROM kekip_presence pr JOIN kekip_football_sessions s ON s.token_hash=pr.token_hash WHERE pr.account_id=u.id AND pr.seen_at>now()-interval '80 seconds' AND s.expires_at>now() ORDER BY (pr.activity<>'home') DESC,pr.seen_at DESC LIMIT 1) p ON true WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' AND u.blocked_at IS NULL ORDER BY u.username`,[a.id]);
  const i=await db.query(`SELECT i.id,u.username AS sender,i.game,i.expires_at FROM kekip_social_invites i JOIN kekip_football_accounts u ON u.id=i.sender_id JOIN kekip_friendships f ON f.low_id=LEAST(i.sender_id,i.receiver_id) AND f.high_id=GREATEST(i.sender_id,i.receiver_id) AND f.status='accepted' WHERE i.receiver_id=$1 AND i.status='pending' AND i.expires_at>now() AND u.blocked_at IS NULL ORDER BY i.created_at DESC LIMIT 30`,[a.id]);
  return {username:a.username,friends:f.rows,invites:i.rows};
 }
 if(action==='social-invite'){
  const game=b.game,code=typeof b.code==='string'?b.code.toUpperCase():'',username=b.username;
  if(!['battleship','football','late_answer'].includes(game)||!(game==='football'?/^[A-F0-9]{10}$/:/^[A-Z2-9]{5}$/).test(code)||typeof username!=='string'||!/^[a-z0-9_]{3,24}$/.test(username)||username===a.username)fail('Davet bilgileri geçersiz.');
  const f=await db.query(`SELECT u.id FROM kekip_football_accounts u JOIN kekip_friendships f ON f.low_id=LEAST(u.id,$1) AND f.high_id=GREATEST(u.id,$1) AND f.status='accepted' WHERE u.username=$2 AND u.blocked_at IS NULL`,[a.id,username]);
  const receiver=f.rows[0]?.id;if(!receiver)fail('Yalnızca arkadaşlarını davet edebilirsin.',403);
  if(!await socialRoomOpen(db,game,code,a.id,receiver,options))fail('Davet için hesabına bağlı, boş yeri olan açık bir lobi gerekli.',409);
  const count=await db.query(`SELECT count(*) AS n FROM kekip_social_invites WHERE sender_id=$1 AND created_at>now()-interval '1 minute'`,[a.id]);if(Number(count.rows[0].n)>=10)fail('Çok fazla davet gönderdin. Biraz bekle.',429);
  await db.query(`INSERT INTO kekip_social_invites(id,sender_id,receiver_id,game,room_code,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes') ON CONFLICT(sender_id,receiver_id,game,room_code) DO UPDATE SET id=EXCLUDED.id,status='pending',created_at=now(),expires_at=EXCLUDED.expires_at WHERE kekip_social_invites.status<>'pending' OR kekip_social_invites.expires_at<=now()`,[crypto.randomBytes(16).toString('hex'),a.id,receiver,game,code]);return {ok:true};
 }
 if(action==='social-accept'||action==='social-decline'){
  if(typeof b.id!=='string'||!/^[a-f0-9]{32}$/.test(b.id))fail('Davet geçersiz.');
  const q=await db.query(`SELECT i.* FROM kekip_social_invites i JOIN kekip_football_accounts u ON u.id=i.sender_id AND u.blocked_at IS NULL JOIN kekip_friendships f ON f.low_id=LEAST(i.sender_id,i.receiver_id) AND f.high_id=GREATEST(i.sender_id,i.receiver_id) AND f.status='accepted' WHERE i.id=$1 AND i.receiver_id=$2 AND i.status='pending' AND i.expires_at>now()`,[b.id,a.id]);const i=q.rows[0];if(!i)fail('Davet artık geçerli değil.',409);
  if(action==='social-accept'&&!await socialRoomOpen(db,i.game,i.room_code,i.sender_id,a.id,options))fail('Oda kapandı, doldu veya oyun başladı.',409);
  const u=await db.query(`UPDATE kekip_social_invites SET status=$3 WHERE id=$1 AND receiver_id=$2 AND status='pending' AND expires_at>now() RETURNING id`,[b.id,a.id,action==='social-accept'?'accepted':'declined']);if(!u.rows.length)fail('Davet artık geçerli değil.',409);
  return action==='social-accept'?{url:i.game==='battleship'?'/?room='+i.room_code:i.game==='late_answer'?'/late-answer.html?room='+i.room_code:'/football.html?footballRoom='+i.room_code}:{ok:true};
 }
 fail('İşlem bulunamadı.',404);
}


// Central mission definitions. Progress comes exclusively from persisted game results.
const MISSIONS=[
 {id:'daily_late_answer',period:'day',name:'Bir Soru Geride',description:'Gecikmeli Cevap’ta 1 kayıtlı maç tamamla.',metric:'late_games',target:1,xp:20,icon:'⏳'},
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
 count(*) FILTER (WHERE r.game='late_answer') AS late_games,
 count(*) FILTER (WHERE r.game='battleship' AND r.result->'win'='true'::jsonb) AS wins,
 COALESCE(sum(CASE WHEN r.game='football' THEN (CASE WHEN r.result->>'goals' ~ '^[0-9]{1,9}$' THEN (r.result->>'goals')::bigint ELSE 0 END)+(CASE WHEN r.result->>'assists' ~ '^[0-9]{1,9}$' THEN (r.result->>'assists')::bigint ELSE 0 END) ELSE 0 END),0) AS contributions
 FROM bounds b LEFT JOIN kekip_game_results r ON r.account_id=$1 AND r.created_at>=b.starts_at AND r.created_at<b.ends_at AND r.created_at<=now() AND r.game IN ('battleship','football','late_answer') AND (r.game<>'late_answer' OR r.result->'complete'='true'::jsonb) GROUP BY b.period,b.period_start,b.ends_at`,[a.id]);
 const c=await db.query(`SELECT mission_id,to_char(period_start,'YYYY-MM-DD') AS period_start FROM kekip_mission_claims WHERE account_id=$1 AND period_start=ANY($2::date[])`,[a.id,q.rows.map(r=>r.period_start)]);
 return {username:a.username,missions:MISSIONS.map(d=>missionProgress(d,q.rows.find(r=>r.period===d.period),c.rows))};
}
async function missionAction(db,a,action,b){if(action==='missions')return missionList(db,a);if(action!=='mission-claim')fail('İşlem bulunamadı.',404);if(b.username!==undefined&&b.username!==a.username)fail('Hesap değişti. Görev listesini yenile.',409);
 const def=MISSIONS.find(d=>d.id===b.id);if(!def||typeof b.periodStart!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.periodStart))fail('Görev geçersiz.');
 const client=await db.connect();try{await client.query('BEGIN');const q=await missionList(client,a);const m=q.missions.find(d=>d.id===def.id);if(m.periodStart!==b.periodStart)fail('Görev dönemi değişti. Listeyi yenile.',409);if(!m.complete)fail('Görev henüz tamamlanmadı.',409);if(m.claimed)fail('Ödül zaten alındı.',409);
 const r=await client.query(`INSERT INTO kekip_mission_claims(account_id,mission_id,period_start,xp) VALUES($1,$2,$3::date,$4) ON CONFLICT DO NOTHING RETURNING xp`,[a.id,def.id,m.periodStart,def.xp]);if(!r.rows.length)fail('Ödül zaten alındı.',409);const coins=missionCoins(def);await client.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'mission',$2,$3,$4) ON CONFLICT(account_id,source_kind,source_id) DO NOTHING`,[a.id,JSON.stringify([def.id,m.periodStart]),'Görev · '+def.name,coins]);await client.query('COMMIT');return {ok:true,username:a.username,xp:def.xp,coins};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}}

// Coin prizes use the ledger; first-time clothing prizes use a separate daily claim table.
const DAILY_LOGIN_KC=10;
const WHEEL_DUPLICATE_COMPENSATION=250;
const WHEEL_PET_ID='pet_ember_fox';
const WHEEL_SEGMENTS=Object.freeze([
 {id:'kc10',type:'kc',amount:10,label:'10 KC',shortLabel:'10',weight:21},
 {id:'kc15',type:'kc',amount:15,label:'15 KC',shortLabel:'15',weight:18},
 {id:'kc20',type:'kc',amount:20,label:'20 KC',shortLabel:'20',weight:16},
 {id:'kc25',type:'kc',amount:25,label:'25 KC',shortLabel:'25',weight:14},
 {id:'kc30',type:'kc',amount:30,label:'30 KC',shortLabel:'30',weight:10},
 {id:'kc40',type:'kc',amount:40,label:'40 KC',shortLabel:'40',weight:10},
 {id:'kc50',type:'kc',amount:50,label:'50 KC',shortLabel:'50',weight:6},
 {id:'kc70',type:'kc',amount:70,label:'70 KC',shortLabel:'70',weight:4},
 {id:WHEEL_PET_ID,type:'item',amount:0,itemId:WHEEL_PET_ID,label:'Kor Tilkisi',shortLabel:'TİLKİ',weight:1}
]);
const WHEEL_SEGMENT_INDEX=Object.freeze(Object.fromEntries(WHEEL_SEGMENTS.map(s=>[s.id,s])));
// Preserve receipts for jackets earned before the pool changed.
const WHEEL_LEGACY_PRIZES=Object.freeze([
 {id:'gece_top_esports',type:'item',amount:0,itemId:'gece_top_esports',label:'Gece · Mor detaylı e-spor ceketi',shortLabel:'GECE',weight:1,character:'gece'},
 {id:'golge_top_esports',type:'item',amount:0,itemId:'golge_top_esports',label:'Gölge · E-spor ceketi',shortLabel:'GÖLGE',weight:1,character:'golge'}
]);
const WHEEL_RECEIPT_INDEX=Object.freeze({...WHEEL_SEGMENT_INDEX,...Object.fromEntries(WHEEL_LEGACY_PRIZES.map(s=>[s.id,s]))});
const WHEEL_POOL=Object.freeze(WHEEL_SEGMENTS.flatMap(s=>Array.from({length:s.weight},()=>s.id)));
function wheelSegmentsPublic(){return WHEEL_SEGMENTS.map(s=>({id:s.id,type:s.type,amount:s.amount,label:s.label,shortLabel:s.shortLabel,weight:s.weight,character:s.character||null,itemId:s.itemId||null}))}
function parseWheelPrize(row){if(!row)return null;const match=(row.label||'').match(/ödül:([a-z0-9_]+)/i);if(match&&Object.hasOwn(WHEEL_RECEIPT_INDEX,match[1]))return WHEEL_RECEIPT_INDEX[match[1]];if(Number(row.amount)>0)return WHEEL_SEGMENTS.find(s=>s.type==='kc'&&s.amount===Number(row.amount))||null;return null}
function wheelPrizeText(row,prize){if(!row)return null;if(!prize)return Number(row.amount)>0?`+${Number(row.amount)} KC`:'Ödül alındı';if(prize.type==='kc')return `+${prize.amount} KC`;if(/telafi/i.test(row.label||''))return `${prize.label} zaten envanterinde olduğu için +${Number(row.amount)} KC telafi ödülü`;return `${prize.label} envantere eklendi`}
function randomWheelPrize(){return WHEEL_SEGMENT_INDEX[WHEEL_POOL[crypto.randomInt(WHEEL_POOL.length)]]}
async function rewardClock(db){const q=await db.query(`SELECT to_char(now() AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD') AS day, now() AS server_now, ((date_trunc('day',now() AT TIME ZONE 'Europe/Istanbul')+interval '1 day') AT TIME ZONE 'Europe/Istanbul') AS reset_at`);return q.rows[0];}
async function dailyRewards(db,a,clock=null){const t=clock||await rewardClock(db);const q=await db.query(`SELECT source_kind,amount,label FROM kekip_coin_ledger WHERE account_id=$1 AND source_id=$2 AND source_kind IN ('daily_login','daily_wheel')`,[a.id,t.day]);const login=q.rows.find(r=>r.source_kind==='daily_login'),wheel=q.rows.find(r=>r.source_kind==='daily_wheel');let wheelRow=wheel;if(!wheelRow){const item=await db.query('SELECT item_id FROM kekip_daily_wheel_items WHERE account_id=$1 AND day=$2::date',[a.id,t.day]);if(item.rows.length)wheelRow={amount:0,label:'Günlük çark · ödül:'+item.rows[0].item_id};}const wheelPrize=parseWheelPrize(wheelRow);const m=await db.query(`SELECT COALESCE(sum(amount),0) AS earned FROM kekip_coin_ledger WHERE account_id=$1 AND source_kind='match' AND created_at >= ($2::date::timestamp AT TIME ZONE 'Europe/Istanbul') AND created_at < (($2::date::timestamp+interval '1 day') AT TIME ZONE 'Europe/Istanbul')`,[a.id,t.day]);const credits=await db.query(`SELECT id FROM kekip_match_cards WHERE account_id=$1 AND chosen IS NOT NULL AND prizes->>chosen::integer='spin' AND spin_used_at IS NULL ORDER BY chosen_at,id`,[a.id]);return {extraSpins:credits.rows.length,extraSpinId:credits.rows[0]?.id||null,username:a.username,day:t.day,serverNow:t.server_now,resetAt:t.reset_at,balance:await coinBalance(db,a),loginReward:DAILY_LOGIN_KC,loginClaimed:!!login,loginStreak:await readLoginStreak(db,a.id,t.day),wheelSegments:wheelSegmentsPublic(),wheelClaimed:!!wheelRow,wheelPrizeId:wheelPrize?.id||null,wheelReward:wheelRow?Number(wheelRow.amount):null,wheelRewardText:wheelPrizeText(wheelRow,wheelPrize),matchEarned:Number(m.rows[0]?.earned||0),matchCap:MATCH_DAILY_CAP,wheelRareOdds:1};}
async function rewardAction(db,a,action,b){
 if(action==='daily-rewards')return dailyRewards(db,a);
 if(!['daily-login','daily-spin','extra-spin','login-streak-claim'].includes(action))fail('İşlem bulunamadı.',404);
 if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
 const c=await db.connect();try{
 await c.query('BEGIN');
 const lock=await c.query('SELECT id FROM kekip_football_accounts WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',[a.id]);
 if(!lock.rows.length)fail('Hesap erişimi kapalı.',403);
 const clock=await rewardClock(c);if(b.day!==clock.day)fail('Yeni gün başladı. Sayfayı yenile.',409);
 if(action==='login-streak-claim'){
   const streak=await readLoginStreak(c,a.id,clock.day);
   const streakAwarded=await creditLoginStreak(c,a.id,streak);
   const data=await dailyRewards(c,a,clock);
   await c.query('COMMIT');
   return {...data,streakAwarded};
 }
 const extra=action==='extra-spin';const kind=action==='daily-login'?'daily_login':extra?'match_card_wheel':'daily_wheel';
 if(extra){if(typeof b.creditId!=='string'||!/^[a-f0-9-]{36}$/.test(b.creditId))fail('Çark hakkı geçersiz.');const credit=await c.query(`UPDATE kekip_match_cards SET spin_used_at=now() WHERE id=$1 AND account_id=$2 AND chosen IS NOT NULL AND prizes->>chosen::integer='spin' AND spin_used_at IS NULL RETURNING id`,[b.creditId,a.id]);if(!credit.rows.length)fail('Bu ekstra çark hakkı artık kullanılamıyor.',409);}
 const prior=await dailyRewards(c,a,clock);
 if(!extra&&(kind==='daily_login'?prior.loginClaimed:prior.wheelClaimed))fail('Bugünkü ödülünü zaten aldın.',409);
 let amount=DAILY_LOGIN_KC,awardedPrize={id:'daily_login',type:'kc',amount:DAILY_LOGIN_KC,label:'Günlük giriş ödülü'},label='Günlük giriş ödülü';
 if(kind==='daily_wheel'||extra){
   awardedPrize=randomWheelPrize();label=`${extra?'Ekstra çark':'Günlük çark'} · ödül:${awardedPrize.id}`;amount=awardedPrize.amount;
   if(awardedPrize.type==='item'){
     const item=Pets.PETS.find(i=>i.id===awardedPrize.itemId);
     if(!item)fail('Çark ödülü yapılandırması eksik.',503);
     const granted=await c.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING item_id',[a.id,awardedPrize.itemId]);
     if(granted.rows.length){if(!extra){const claim=await c.query('INSERT INTO kekip_daily_wheel_items(account_id,day,item_id) VALUES($1,$2::date,$3) ON CONFLICT DO NOTHING RETURNING item_id',[a.id,clock.day,awardedPrize.itemId]);if(!claim.rows.length)fail('Bugünkü ödülünü zaten aldın.',409);}}
     else{amount=WHEEL_DUPLICATE_COMPENSATION;label+=' · telafi';}
   }
 }
 if(amount>0){const q=await c.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,source_kind,source_id) DO NOTHING RETURNING amount`,[a.id,kind,extra?b.creditId:clock.day,label,amount]);if(!q.rows.length)fail('Bugünkü ödülünü zaten aldın.',409);}
 const streakAwarded=kind==='daily_login'?await creditLoginStreak(c,a.id,await readLoginStreak(c,a.id,clock.day)):0;
 const data=await dailyRewards(c,a,clock);await c.query('COMMIT');return {...data,streakAwarded,awarded:amount,awardedPrizeId:awardedPrize.id,awardedText:kind==='daily_login'?`+${amount} KC`:extra?wheelPrizeText({amount,label},awardedPrize):data.wheelRewardText};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

// Read-only wallet. No client-submitted coin amount or spending endpoint.
async function coinBalance(db,a){const q=await db.query('SELECT COALESCE(sum(amount),0) AS balance FROM kekip_coin_ledger WHERE account_id=$1',[a.id]);return Number(q.rows[0]?.balance||0)}
async function wallet(db,a){const q=await db.query(`SELECT COALESCE(sum(amount),0) AS balance,COALESCE(sum(amount) FILTER (WHERE amount>0),0) AS earned,COALESCE(sum(-(amount::bigint)) FILTER (WHERE amount<0),0) AS spent,
 (SELECT COALESCE(jsonb_agg(jsonb_build_object('label',r.label,'amount',r.amount,'createdAt',r.created_at) ORDER BY r.id DESC),'[]'::jsonb) FROM (SELECT id,label,amount,created_at FROM kekip_coin_ledger WHERE account_id=$1 ORDER BY id DESC LIMIT 50) r) AS history
 FROM kekip_coin_ledger WHERE account_id=$1`,[a.id]);const row=q.rows[0];return {username:a.username,balance:Number(row.balance),earned:Number(row.earned),spent:Number(row.spent),history:row.history};}

// Stable item IDs and server-owned prices. Extend catalog without changing existing IDs.
const BACKGROUNDS=require('./avatar-backgrounds.json');
const COSMETICS=Object.freeze([
 ...BACKGROUNDS.filter(i=>i.price>0),
 ...Pets.PETS,
 ...Wings,
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
const COSMETIC_SLOTS=[...new Set(COSMETICS.filter(x=>x.slot!=='pet').map(x=>x.slot))];
async function equippedCosmetics(db,id){const q=await db.query('SELECT slot,item_id FROM kekip_cosmetic_equipped WHERE account_id=$1',[id]);return Object.fromEntries(q.rows.filter(r=>COSMETICS.some(c=>c.id===r.item_id&&c.slot===r.slot)).map(r=>[r.slot,r.item_id]));}
async function shopList(db,a){const q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[a.id]);const activeIds=new Set([...COSMETICS,...GeceCollection.items,...GolgeCollection.items].map(i=>i.id));const owned=q.rows.map(r=>r.item_id).filter(id=>activeIds.has(id));return {username:a.username,balance:await coinBalance(db,a),catalog:COSMETICS,backgrounds:BACKGROUNDS,activePet:Pets.strongestPet(owned),baseCardChance:Pets.cardChance(null),geceCollection:GeceCollection,golgeCollection:GolgeCollection,owned,equipped:await equippedCosmetics(db,a.id)};}
async function shopAction(db,a,action,b){if(b.username!==undefined&&b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);if(action==='shop')return shopList(db,a);if(!['shop-buy','shop-equip'].includes(action))fail('İşlem bulunamadı.',404);
 if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
 const modularCollection=Object.values(Wardrobe.collections).find(c=>c.items.some(x=>x.id===b.id));
 const modular=modularCollection?.items.find(x=>x.id===b.id);
 const item=action==='shop-buy'&&modular?modular:COSMETICS.find(x=>x.id===b.id);const slot=action==='shop-buy'?item?.slot:b.slot;
 if(item?.slot==='background'&&action==='shop-equip')fail('Arka planı gardıroptan kaydet.',409);
 if(action==='shop-equip'&&slot==='background')fail('Arka planı gardıroptan kaydet.',409);
 if(action==='shop-buy'&&modular){
  if(modular.chestOnly===true||!modularCollection.saleEnabled||modular.starter||modular.status!=='available'||!Number.isSafeInteger(modular.price)||modular.price<=0)fail('Bu ürün satışta değil.',409);
 }else{
  if(action==='shop-buy'&&(item?.legacy||item?.slot.startsWith('av_')))fail('Bu ürün eski koleksiyona ait ve artık satışta değil.',409);
  if((!COSMETIC_SLOTS.includes(slot)&&!(action==='shop-buy'&&slot==='pet'))||(action==='shop-buy'&&!item)||(action==='shop-equip'&&b.id!==''&&(!item||item.slot!==slot)))fail('Kozmetik geçersiz.');
 }
 if(action==='shop-buy'){if(!Number.isSafeInteger(item.price)||item.price<=0)fail('Bu ürün satışta değil.',409);if(b.expectedPrice!==item.price)fail('Fiyat değişti. Mağazayı yenileyip tekrar dene.',409);}
 const c=await db.connect();try{await c.query('BEGIN');const lock=await c.query('SELECT id FROM kekip_football_accounts WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',[a.id]);if(!lock.rows.length)fail('Hesap erişimi kapalı.',403);
 if(action==='shop-buy'){const owned=await c.query('SELECT 1 FROM kekip_cosmetic_inventory WHERE account_id=$1 AND item_id=$2',[a.id,item.id]);if(owned.rows.length)fail('Bu ürün zaten envanterinde.',409);if(await coinBalance(c,a)<item.price)fail('Yeterli KC yok.',409);
 await c.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) VALUES($1,$2)',[a.id,item.id]);await c.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'cosmetic',$2,$3,$4)`,[a.id,item.id,'Mağaza · '+item.name,-item.price]);
 }else if(b.id===''){await c.query('DELETE FROM kekip_cosmetic_equipped WHERE account_id=$1 AND slot=$2',[a.id,slot]);}else{const owned=await c.query('SELECT 1 FROM kekip_cosmetic_inventory WHERE account_id=$1 AND item_id=$2',[a.id,item.id]);if(!owned.rows.length)fail('Önce bu ürünü satın almalısın.',403);await c.query('INSERT INTO kekip_cosmetic_equipped(account_id,slot,item_id) VALUES($1,$2,$3) ON CONFLICT(account_id,slot) DO UPDATE SET item_id=EXCLUDED.item_id',[a.id,slot,item.id]);}
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}return {ok:true};}

// Administration gifts: same per-account lock as shop/wardrobe, transactional audit and idempotency.
function adminChestGiftCatalog(){
 const labels={rare:'Nadir',epic:'Epik',legendary:'Efsanevi',mythic:'Mitik'};
 return ['gece','golge'].flatMap(character=>(ChestCollections[character]?.items||[]).filter(i=>i.character===character&&i.chestOnly===true&&i.status==='available'&&i.visualApprovalPending!==true&&i.price===0&&i.id.startsWith(character+'_chest_')&&Object.hasOwn(labels,i.chestRarity)&&(i.chestRarity==='mythic'?i.completeSet===true&&i.slot==='av_set':i.completeSet!==true&&i.slot!=='av_set')).map(i=>({id:i.id,name:i.name,character,group:(character==='gece'?'Gece':'Gölge')+' · Sandık · '+labels[i.chestRarity],rarity:i.chestRarity,rarityLabel:labels[i.chestRarity],completeSet:i.completeSet===true,thumbnail:i.thumbnail})));
}
function adminGiftCatalog(){
 const valid=i=>typeof i.id==='string'&&Number.isSafeInteger(i.price)&&i.price>0;
 const items=[...COSMETICS.filter(i=>valid(i)&&!i.legacy&&!i.slot.startsWith('av_')).map(i=>({...i,group:'Profil'})),...Object.entries(Wardrobe.collections).flatMap(([key,c])=>c.saleEnabled?c.items.filter(i=>valid(i)&&i.chestOnly!==true&&!i.starter&&i.status==='available').map(i=>({...i,group:key==='gece'?'Gece':'Gölge'})):[])];
 return [...new Map([...items,...adminChestGiftCatalog()].map(i=>[i.id,{id:i.id,name:i.name||i.id,group:i.group}])).values()];
}
async function adminGrant(db,b,actor){
 const {username,kind,requestId}=b;const reason=typeof b.reason==='string'?b.reason.trim():'';
 if(typeof username!=='string'||!/^[a-z0-9_]{3,24}$/.test(username)||typeof requestId!=='string'||!/^[a-f0-9]{32}$/.test(requestId)||!['kc','xp','item'].includes(kind)||reason.length<3||reason.length>160||/[\x00-\x1f\x7f]/.test(reason))fail('Ödül isteği geçersiz.');
 const amount=kind==='item'?0:b.amount,itemId=kind==='item'?b.itemId:'';
 if(kind!=='item'&&(!Number.isSafeInteger(amount)||amount<1||amount>10000))fail('Miktar 1–10.000 arasında tam sayı olmalı.');
 if(kind==='item'&&(typeof itemId!=='string'||itemId.length>150))fail('Ürün geçersiz.');
 const c=await db.connect();try{
  await c.query('BEGIN');
  const q=await c.query('SELECT id,username,blocked_at FROM kekip_football_accounts WHERE username=$1 FOR UPDATE',[username]);const a=q.rows[0];if(!a)fail('Üye bulunamadı.',404);
  const prior=await c.query('SELECT account_id,kind,amount,item_id,reason FROM kekip_admin_grants WHERE request_id=$1',[requestId]);
  if(prior.rows.length){const v=prior.rows[0];if(v.account_id!==a.id||v.kind!==kind||v.amount!==amount||v.item_id!==itemId||v.reason!==reason)fail('İşlem anahtarı farklı bir ödüle ait.',409);await c.query('COMMIT');return {ok:true,duplicate:true};}
  if(a.blocked_at)fail('Engellenmiş hesaba ödül verilemez.',403);
  const item=kind==='item'?adminGiftCatalog().find(i=>i.id===itemId):null;
  if(kind==='item'&&!item)fail('Bu ürün hediye edilemez.',409);
  await c.query('INSERT INTO kekip_admin_grants(request_id,account_id,kind,amount,item_id,reason) VALUES($1,$2,$3,$4,$5,$6)',[requestId,a.id,kind,amount,itemId,reason]);
  if(kind==='kc')await c.query("INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'admin_grant',$2,$3,$4)",[a.id,requestId,'Yönetici ödülü',amount]);
  if(kind==='item'){const r=await c.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING item_id',[a.id,itemId]);if(!r.rows.length)fail('Oyuncu bu ürüne zaten sahip.',409);}
  await c.query('INSERT INTO kekip_admin_audit(username,action) VALUES($1,$2)',[username,'Ödül · '+(kind==='item'?item.name:amount+' '+kind.toUpperCase())+' · '+reason+' · Yönetici: @'+actor.username]);
  await c.query('COMMIT');return {ok:true,duplicate:false};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});if(e.code==='23505')fail('İşlem çakıştı. Aynı isteği yeniden dene.',409);throw e;}finally{c.release()}
}

// Serialize wardrobe writes with purchases and account blocking; validate ownership inside the transaction.
async function wardrobeWrite(db,a,work){
 const c=await db.connect();try{await c.query('BEGIN');const lock=await c.query('SELECT id FROM kekip_football_accounts WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',[a.id]);if(!lock.rows.length)fail('Hesap erişimi kapalı.',403);const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

// 0.51.18.6 — explicit deployment flag; disabled by default until live smoke test.
const chestAction=MysteryChest.createService({collections:ChestCollections,coinBalance,write:wardrobeWrite,enabled:process.env.KEKIP_CHESTS_ENABLED==='true'});

// 0.51.5.1 — private, persistent friend-to-friend messages.
function dmPublic(row){return {id:String(row.id),sender:row.sender,receiver:row.receiver,text:row.body,createdAt:row.created_at,readAt:row.read_at||null};}
// 0.51.5.3 — transient typing presence, no message content stored here.
const dmTyping = new Map();
const DM_TYPING_TTL=6000, DM_TYPING_MAX=10000;
function dmTypingKey(from,to){return JSON.stringify([from,to]);}
function dmTypingSweep(now){for(const [k,expiry] of dmTyping)if(expiry<=now)dmTyping.delete(k);}
async function messageAction(db,a,action,b){
 if(!b||typeof b!=='object'||Array.isArray(b))fail('Geçersiz mesaj isteği.');
 if(!['messages-list','messages-history','messages-send','messages-sync','messages-read','messages-unread'].includes(action))fail('İşlem bulunamadı.',404);
 if(b.account!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
 const limit=b.limit===undefined?30:b.limit;
 if(action!=='messages-send'&&(!Number.isInteger(limit)||limit<1||limit>50))fail('Sayfa boyutu geçersiz.');
 if(action==='messages-unread'){
  const q=await db.query(`SELECT count(*) AS n FROM kekip_direct_messages d
    JOIN kekip_friendships f ON f.low_id=d.low_id AND f.high_id=d.high_id AND f.status='accepted'
    JOIN kekip_football_accounts u ON u.id=d.sender_id AND u.blocked_at IS NULL
    JOIN kekip_football_accounts me ON me.id=$1 AND me.blocked_at IS NULL
    WHERE d.receiver_id=$1 AND d.read_at IS NULL`,[a.id]);
  return {username:a.username,unread:Number(q.rows[0]?.n||0)};
 }
 if(action==='messages-list'){
  const after=b.after===undefined?'':b.after;
  if(typeof after!=='string'||(after!==''&&!/^[a-z0-9_]{3,24}$/.test(after)))fail('Liste konumu geçersiz.');
  const q=await db.query(`SELECT u.username, m.id,m.body,m.created_at,m.sender,m.receiver,m.read_at, (SELECT count(*) FROM kekip_direct_messages d WHERE d.receiver_id=$1 AND d.sender_id=u.id AND d.read_at IS NULL) AS unread
    FROM kekip_friendships f JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END
    JOIN kekip_football_accounts me ON me.id=$1 AND me.blocked_at IS NULL
    LEFT JOIN LATERAL (SELECT d.id,d.body,d.created_at,d.read_at,CASE WHEN d.sender_id=$1 THEN me.username ELSE u.username END AS sender,CASE WHEN d.sender_id=$1 THEN u.username ELSE me.username END AS receiver FROM kekip_direct_messages d WHERE d.low_id=f.low_id AND d.high_id=f.high_id ORDER BY d.id DESC LIMIT 1) m ON true
    WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' AND u.blocked_at IS NULL AND u.username>$2 ORDER BY u.username LIMIT $3`,[a.id,after,limit+1]);
  const rows=q.rows.slice(0,limit);return {username:a.username,people:rows.map(r=>({username:r.username,lastMessage:r.id==null?null:dmPublic(r),unread:Number(r.unread||0)})),nextAfter:q.rows.length>limit?rows[rows.length-1].username:null};
 }
 const name=b.username;
 if(typeof name!=='string'||!/^[a-z0-9_]{3,24}$/.test(name)||name===a.username)fail('Geçerli başka bir oyuncu seç.');
 if(action==='messages-read'){
  const through=b.throughId;
  if(typeof through!=='string'||! /^[1-9][0-9]{0,18}$/.test(through)||BigInt(through)>9223372036854775807n)fail('Mesaj konumu geçersiz.');
  // Only the recipient may acknowledge a message in an active, accepted friendship.
  const q=await db.query(`WITH allowed AS (
   SELECT u.id FROM kekip_friendships f
   JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END AND u.username=$2 AND u.blocked_at IS NULL
   JOIN kekip_football_accounts me ON me.id=$1 AND me.blocked_at IS NULL
   WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted'
   AND EXISTS(SELECT 1 FROM kekip_direct_messages d WHERE d.id=$3::bigint AND d.receiver_id=$1 AND d.sender_id=u.id)
  ), changed AS (
   UPDATE kekip_direct_messages d SET read_at=now() FROM allowed u
   WHERE d.receiver_id=$1 AND d.sender_id=u.id AND d.id<=$3::bigint AND d.read_at IS NULL RETURNING d.id
  ) SELECT EXISTS(SELECT 1 FROM allowed) AS ok,(SELECT count(*) FROM changed) AS marked`,[a.id,name,through]);
  if(!q.rows[0]?.ok)fail('Bu konuşma veya mesaj erişilebilir değil.',403);
  return {username:a.username,peer:name,throughId:through,marked:Number(q.rows[0].marked||0)};
 }
 if(action==='messages-sync'){
  const after=b.afterId;
  if(typeof after!=='string'||! /^(0|[1-9][0-9]{0,18})$/.test(after)||BigInt(after)>9223372036854775807n||typeof b.typing!=='boolean')fail('Sohbet güncellemesi geçersiz.');
  const q=await db.query(`SELECT u.id AS peer_id,m.id,m.body,m.created_at,m.sender,m.receiver,m.read_at, (SELECT max(d.id) FROM kekip_direct_messages d WHERE d.sender_id=$1 AND d.receiver_id=u.id AND d.read_at IS NOT NULL) AS peer_read_id, (SELECT count(*) FROM kekip_direct_messages d WHERE d.receiver_id=$1 AND d.sender_id=u.id AND d.read_at IS NULL) AS unread FROM kekip_friendships f
    JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END AND u.username=$2 AND u.blocked_at IS NULL
    JOIN kekip_football_accounts me ON me.id=$1 AND me.blocked_at IS NULL
    LEFT JOIN LATERAL (SELECT d.id,d.body,d.created_at,d.read_at,CASE WHEN d.sender_id=$1 THEN me.username ELSE u.username END AS sender,CASE WHEN d.sender_id=$1 THEN u.username ELSE me.username END AS receiver FROM kekip_direct_messages d WHERE d.low_id=f.low_id AND d.high_id=f.high_id AND d.id>$3::bigint ORDER BY d.id ASC LIMIT $4) m ON true
    WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' ORDER BY m.id ASC NULLS LAST`,[a.id,name,after,limit+1]);
  if(!q.rows.length)fail('Bu oyuncuyla mesajlaşabilmek için arkadaş olmalısın.',403);
  const now=Date.now(),other=q.rows[0].peer_id,key=dmTypingKey(a.id,other);
  dmTypingSweep(now);
  if(b.typing){if(dmTyping.has(key)||dmTyping.size<DM_TYPING_MAX)dmTyping.set(key,now+DM_TYPING_TTL);}else dmTyping.delete(key);
  const rows=q.rows.filter(r=>r.id!=null),page=rows.slice(0,limit);
  return {username:a.username,peer:name,messages:page.map(dmPublic),afterId:page.length?String(page[page.length-1].id):after,more:rows.length>limit,peerReadId:String(q.rows[0].peer_read_id||'0'),unread:Number(q.rows[0].unread||0),typing:(dmTyping.get(dmTypingKey(other,a.id))||0)>now};
 }
 if(action==='messages-history'){
  const before=b.before===undefined||b.before===null?null:b.before;
  if(before!==null&&(typeof before!=='string'||!/^[1-9][0-9]{0,18}$/.test(before)||BigInt(before)>9223372036854775807n))fail('Mesaj konumu geçersiz.');
  const q=await db.query(`SELECT m.id,m.body,m.created_at,m.sender,m.receiver,m.read_at FROM kekip_friendships f
    JOIN kekip_football_accounts u ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END AND u.username=$2 AND u.blocked_at IS NULL
    JOIN kekip_football_accounts me ON me.id=$1 AND me.blocked_at IS NULL
    LEFT JOIN LATERAL (SELECT d.id,d.body,d.created_at,d.read_at,CASE WHEN d.sender_id=$1 THEN me.username ELSE u.username END AS sender,CASE WHEN d.sender_id=$1 THEN u.username ELSE me.username END AS receiver FROM kekip_direct_messages d WHERE d.low_id=f.low_id AND d.high_id=f.high_id AND ($3::bigint IS NULL OR d.id<$3::bigint) ORDER BY d.id DESC LIMIT $4) m ON true
    WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' ORDER BY m.id DESC NULLS LAST`,[a.id,name,before,limit+1]);
  if(!q.rows.length)fail('Bu oyuncuyla mesajlaşabilmek için arkadaş olmalısın.',403);
  const rows=q.rows.filter(r=>r.id!=null),page=rows.slice(0,limit);return {username:a.username,peer:name,messages:page.map(dmPublic).reverse(),nextBefore:rows.length>limit?String(page[page.length-1].id):null};
 }
 if(typeof b.text!=='string'||b.text.length>2000)fail('Mesaj en fazla 1000 karakter olabilir.');
 const body=b.text.replace(/\r\n?/g,'\n').trim();
 if(!body||[...body].length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)||/[\ud800-\udfff]/u.test(body))fail('Geçerli 1–1000 karakterlik mesaj yaz.');
 const clientId=b.clientId;
 if(typeof clientId!=='string'||!/^[a-zA-Z0-9_-]{16,64}$/.test(clientId))fail('Mesaj gönderim anahtarı geçersiz.');
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  // Lock both active accounts in the same order; serialize sends and coordinate account blocks.
  const pair=await c.query('SELECT id,username FROM kekip_football_accounts WHERE (id=$1 OR username=$2) AND blocked_at IS NULL ORDER BY id FOR UPDATE',[a.id,name]);
  if(pair.rows.length!==2||!pair.rows.some(r=>r.id===a.id))fail('Oyuncuya mesaj gönderilemiyor.',403);
  const peer=pair.rows.find(r=>r.id!==a.id),[low,high]=[a.id,peer.id].sort();
  const f=await c.query("SELECT status FROM kekip_friendships WHERE low_id=$1 AND high_id=$2 AND status='accepted' FOR SHARE",[low,high]);
  if(!f.rows.length)fail('Bu oyuncuyla mesajlaşabilmek için arkadaş olmalısın.',403);
  const prior=await c.query('SELECT id,receiver_id,body,created_at,read_at FROM kekip_direct_messages WHERE sender_id=$1 AND client_id=$2',[a.id,clientId]);
  let row=prior.rows[0];
  if(row){if(row.receiver_id!==peer.id||row.body!==body)fail('Mesaj gönderim anahtarı zaten kullanıldı.',409);}
  else{
   const rate=await c.query("SELECT count(*)::int AS n FROM kekip_direct_messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute'",[a.id]);
   if(Number(rate.rows[0]?.n)>=20)fail('Çok hızlı mesaj gönderiyorsun. Biraz sonra tekrar dene.',429);
   const q=await c.query('INSERT INTO kekip_direct_messages(low_id,high_id,sender_id,receiver_id,client_id,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,body,created_at',[low,high,a.id,peer.id,clientId,body]);row=q.rows[0];
  }
  await c.query('COMMIT');return {ok:true,username:a.username,message:dmPublic({...row,sender:a.username,receiver:peer.username})};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}

function attachAccounts(app,options={}){app.post(['/api/account/:action','/api/football/account/:action'],(req,res,next)=>json({limit:req.params.action==='profile-save'?'64kb':'16kb'})(req,res,next),async(req,res,next)=>{const action=req.params.action;if(req.path.startsWith('/api/football/')&&['list','claim'].includes(action))return next();res.set('Cache-Control','no-store');try{safeRequest(req);const b=req.body||{};if(action==='me'&&!sessionToken(req))return res.json({user:null});if(action==='ui-preferences-read'&&!sessionToken(req))return res.json({username:null,preferences:null});const db=await database();
if(['invite-list','invite-create','invite-revoke'].includes(action))return res.json(await inviteAction(db,req,action,b));
if(action==='admin-access-status')return res.json(adminAccessStatus(await getAccount(db,req)));
if(action.startsWith('admin-'))return res.json(await adminAction(db,req,action,b,options));
if(action==='account-history'){const a=await requireAccount(db,req);return res.json(await AccountHistory.readAccountHistory(db,a));}
if(action==='password-change')return res.json(await changePassword(db,req,res,b,options));
if(action==='ui-preferences-read')return res.json(await readUiPreferences(db,await getAccount(db,req)));
if(action==='ui-preferences-save')return res.json(await saveUiPreferences(db,await getAccount(db,req),b));
if(action==='me'){const a=await getAccount(db,req);return res.json({user:a?{username:a.username,onboarded:a.onboarded,isAdmin:adminEligible(a)}:null})}
if(action==='logout'){const t=sessionToken(req);if(t){await AccountHistory.logoutWithHistory(db,hash(t));options.disconnectSession?.(t);}cookie(res,req,'',0);clearLegacy(res,req);return res.json({ok:true})}
if(action==='register'||action==='login'){const name=typeof b.username==='string'?b.username.trim().toLowerCase():'',password=b.password;if(!/^[a-z0-9_]{3,24}$/.test(name)||typeof password!=='string'||password.length<10||password.length>128)fail('Kullanıcı adı 3–24 harf/rakam/alt çizgi, şifre 10–128 karakter olmalı.');throttle(req,name);if(inFlight>=4)fail('Sunucu yoğun. Biraz sonra tekrar dene.',429);let a;inFlight++;try{if(action==='register'){const code=typeof b.inviteCode==='string'?b.inviteCode.trim().toLowerCase():'';if(!/^[a-f0-9]{48}$/.test(code))fail('Üyelik davetlidir. Yönetici tarafından verilen davet kodunu gir.',403);const id=token(),digest=await passwordHash(password);let q;try{q=await db.query(`WITH claimed AS (UPDATE kekip_registration_invites SET used_at=now() WHERE username=$2 AND code_hash=$4 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>now() RETURNING id) INSERT INTO kekip_football_accounts(id,username,password_hash) SELECT $1,$2,$3 FROM claimed RETURNING id,username`,[id,name,digest,hash(code)])}catch(e){if(e.code==='23505')fail('Bu kullanıcı adı alınmış.',409);throw e}if(!q.rows.length)fail('Davet geçersiz, kullanılmış, iptal edilmiş, süresi dolmuş veya bu kullanıcı adına ait değil.',403);a=q.rows[0]}else{const q=await db.query('SELECT id,username,password_hash,blocked_at FROM kekip_football_accounts WHERE username=$1',[name]);a=q.rows[0];const ok=await verifyPassword(password,a?.password_hash||('0'.repeat(32)+':'+ '0'.repeat(128)));if(!a||!ok)fail('Kullanıcı adı veya şifre yanlış.',401);if(a.blocked_at)fail('Hesabın yönetici tarafından engellendi.',403)}}finally{inFlight--}const t=token(),old=sessionToken(req);if(old){await db.query('DELETE FROM kekip_football_sessions WHERE token_hash=$1',[hash(old)]);options.disconnectSession?.(old);}await db.query('DELETE FROM kekip_football_sessions WHERE expires_at<=now()');const c=await db.connect();try{await c.query('BEGIN');const check=await c.query('SELECT password_hash,blocked_at FROM kekip_football_accounts WHERE id=$1 FOR UPDATE',[a.id]);if(!check.rows.length||check.rows[0].blocked_at||(action==='login'&&check.rows[0].password_hash!==a.password_hash))fail('Hesap değişti. Tekrar giriş yap.',403);await c.query("INSERT INTO kekip_football_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash(t),a.id]);await AccountHistory.recordAccountEvent(c,a.id,action);await c.query('COMMIT')}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}cookie(res,req,t,2592000);clearLegacy(res,req);return res.json({user:{username:a.username}})}

// Onboarding is authoritative: only starter products may be used, and a completed look cannot be overwritten by this endpoint.
if(action==='onboarding-catalog'||action==='onboarding-complete'){
 const a=await getAccount(db,req);if(!a)fail('Önce hesabına giriş yap.',401);
 if(action==='onboarding-catalog')return res.json({username:a.username,onboarded:a.onboarded,collections:Object.fromEntries(Object.entries(Wardrobe.collections).map(([key,c])=>[key,{character:key,colors:c.colors,items:c.items.filter(i=>i.onboardingEligible&&i.chestOnly!==true).map(i=>({...i,price:0,starter:true,status:'starter'}))}]))});
 if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
 const c=await db.connect();try{await c.query('BEGIN');const lock=await c.query('SELECT id FROM kekip_football_accounts WHERE id=$1 AND blocked_at IS NULL FOR UPDATE',[a.id]);if(!lock.rows.length)fail('Hesap erişimi kapalı.',403);const prior=await Wardrobe.readSaved(c,a.id);if(prior){await c.query('COMMIT');return res.json({ok:true,alreadyCompleted:true});}
 const eligible=Wardrobe.collection(b.character).items.filter(i=>i.onboardingEligible&&i.chestOnly!==true).map(i=>i.id);
 const appearance=Wardrobe.validate(b.character,{...b.draft,background:null},eligible);
 const chosen=[...new Set(Object.values(appearance.items).filter(Boolean))];
 await c.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) SELECT $1,unnest($2::text[]) ON CONFLICT(account_id,item_id) DO NOTHING',[a.id,chosen]);
 await c.query('INSERT INTO kekip_modular_avatars(account_id,character,appearance) VALUES($1,$2,$3::jsonb)',[a.id,b.character,JSON.stringify(appearance)]);
 await c.query('COMMIT');return res.json({ok:true,appearance});
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
}
if(action==='avatar-save'){await requireAccount(db,req);fail('Eski karakter sistemi kaldırıldı. Gece veya Gölge gardırobunu kullan.',410);}
if(action==='avatar'){const a=await requireAccount(db,req);return res.json({username:a.username,appearance:await Wardrobe.readSaved(db,a.id),petId:(await Pets.accountPet(db,a.id))?.id??null,characters:['gece','golge']});}
if(action.startsWith('messages-')){const a=await requireAccount(db,req);return res.json(await messageAction(db,a,action,b));}
if(action.startsWith('social-')){const a=await requireAccount(db,req);return res.json(await socialAction(db,req,a,action,b,options))}if(action.startsWith('friends-')){const a=await requireAccount(db,req);return res.json(await friendAction(db,a,action,b))}if(action==='profile'){const a=await requireAccount(db,req);const name=b.username===undefined?a.username:b.username;if(typeof name!=='string'||!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı geçersiz.');return res.json(await readPlayerProfile(db,name,a))}if(action==='profile-privacy-read'){const a=await requireAccount(db,req);const q=await db.query('SELECT data FROM kekip_player_profiles WHERE account_id=$1',[a.id]);return res.json({username:a.username,privacy:profilePrivacy(q.rows[0]?.data)});}if(action==='profile-privacy-save'){const a=await requireAccount(db,req);return res.json(await saveProfilePrivacy(db,a,b))}if(action==='profile-showcase-save'){const a=await requireAccount(db,req);return res.json(await wardrobeWrite(db,a,c=>ProfileExtras.saveShowcase(c,a,b)));}if(action==='profile-history'){const a=await requireAccount(db,req);const target=await resolvePlayerProfile(db,a,b.username===undefined?a.username:b.username);if(!target.statsVisible)fail('Maç geçmişi gizli.',403);return res.json({username:target.row.username,...await ProfileExtras.readHistory(db,target.row.id,b.cursor)});}if(action==='profile-view'){const a=await requireAccount(db,req);return res.json(await visitPlayerProfile(db,a,b.username===undefined?a.username:b.username))}if(action==='profile-save'){const a=await requireAccount(db,req);return res.json(await savePlayerProfile(db,a,b))}if(action==='missions'||action==='mission-claim'){const a=await requireAccount(db,req);return res.json(await missionAction(db,a,action,b))}if(action==='wardrobe-view'){await requireAccount(db,req);const name=b.username;if(typeof name!=='string'||!/^[a-z0-9_]{3,24}$/.test(name))fail('Kullanıcı adı geçersiz.');const q=await db.query('SELECT id FROM kekip_football_accounts WHERE username=$1 AND blocked_at IS NULL',[name]);if(!q.rows.length)fail('Oyuncu bulunamadı.',404);if(b.character!==undefined)Wardrobe.collection(b.character);const saved=await Wardrobe.readSaved(db,q.rows[0].id,b.character||null);if(!saved)fail('Henüz kayıtlı avatar yok.',404);return res.json({username:name,saved,petId:(await Pets.accountPet(db,q.rows[0].id))?.id??null,wingId:(await equippedCosmetics(db,q.rows[0].id)).wing??null,collection:Wardrobe.collection(saved.character)});}
if(action==='avatar-portraits'){await requireAccount(db,req);if(!Array.isArray(b.usernames)||b.usernames.length>40||b.usernames.some(n=>typeof n!=='string'||!/^[a-z0-9_]{3,24}$/.test(n)))fail('Oyuncu listesi geçersiz.');const names=[...new Set(b.usernames)];if(!names.length)return res.json({players:[]});const q=await db.query(`SELECT a.username, m.appearance, ARRAY(SELECT i.item_id FROM kekip_cosmetic_inventory i WHERE i.account_id=a.id AND i.item_id=ANY($2::text[])) AS pets, (SELECT w.item_id FROM kekip_cosmetic_equipped w WHERE w.account_id=a.id AND w.slot='wing') AS wing_id, CASE WHEN m.appearance IS NULL THEN p.data->>'photo' ELSE NULL END AS photo FROM kekip_football_accounts a LEFT JOIN kekip_player_profiles p ON p.account_id=a.id LEFT JOIN LATERAL (SELECT appearance FROM kekip_modular_avatars WHERE account_id=a.id AND character IN ('gece','golge') ORDER BY updated_at DESC,character LIMIT 1) m ON true WHERE a.blocked_at IS NULL AND a.username=ANY($1::text[])`,[names,Pets.PETS.map(p=>p.id)]);return res.json({players:q.rows.map(r=>({username:r.username,appearance:r.appearance||null,petId:Pets.strongestPet(r.pets)?.id??null,wingId:r.wing_id??null,photo:typeof r.photo==='string'&&r.photo.length<=44000&&r.photo.startsWith('data:image/jpeg;base64,')?r.photo:''}))});}
if(['wardrobe-slots','wardrobe-slot-save','wardrobe-slot-rename','wardrobe-slot-delete','wardrobe-slot-equip'].includes(action)){const a=await requireAccount(db,req);if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);return res.json(action==='wardrobe-slots'?await Wardrobe.slotAction(db,a.id,b.character,action,b):await wardrobeWrite(db,a,c=>Wardrobe.slotAction(c,a.id,b.character,action,b)));}
if(['wardrobe-set-equip','wardrobe-set-clear'].includes(action)){const a=await requireAccount(db,req);if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const saved=await wardrobeWrite(db,a,c=>Wardrobe.setAction(c,a.id,b.character,action,b));return res.json({username:a.username,saved,persisted:true});}
if(action==='wardrobe-save'){const a=await requireAccount(db,req);if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const saved=await wardrobeWrite(db,a,c=>Wardrobe.save(c,a.id,b.character,b.draft));return res.json({username:a.username,saved,persisted:true});}
if(action==='wardrobe'||action==='wardrobe-check'){const a=await requireAccount(db,req);if(b.username!==undefined&&b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);const character=b.character||'gece';const collection=Wardrobe.collection(character);const q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[a.id]);const owned=q.rows.map(r=>r.item_id);if(action==='wardrobe-check')return res.json({username:a.username,draft:Wardrobe.validate(character,b.draft,owned),persisted:false});return res.json({username:a.username,collection,saved:await Wardrobe.readSaved(db,a.id,character),petId:Pets.strongestPet(owned)?.id??null,wingId:(await equippedCosmetics(db,a.id)).wing??null,available:Wardrobe.access(character,owned),backgroundOwned:owned.filter(id=>BACKGROUNDS.some(i=>i.id===id)),owned:owned.filter(id=>collection.items.some(i=>i.id===id)),chestOwned:MysteryChest.ownedRewards(ChestCollections,owned,character)});}if(action==='shop-history'){const a=await requireAccount(db,req);const catalog=[...COSMETICS,...GeceCollection.items,...GolgeCollection.items,...ChestCollections.gece.items,...ChestCollections.golge.items];return res.json(await readAcquisitions(db,a,catalog,[...new Set([...WHEEL_SEGMENTS,...WHEEL_LEGACY_PRIZES].filter(i=>i.type==='item').map(i=>i.itemId))],b.cursor));}if(['shop','shop-buy','shop-equip'].includes(action)){const a=await requireAccount(db,req);return res.json(await shopAction(db,a,action,b))}if(['chest-status','chest-open','chest-inventory','chest-history'].includes(action)){const a=await requireAccount(db,req);return res.json(await chestAction(db,a,action,b,c=>requireAccount(c,req)));}if(['match-cards','match-card-claim'].includes(action)){const a=await requireAccount(db,req);return res.json(await matchCardsAction(db,a,action,b));}if(['daily-rewards','daily-login','daily-spin','extra-spin','login-streak-claim'].includes(action)){const a=await requireAccount(db,req);return res.json(await rewardAction(db,a,action,b));}if(action==='wallet'){const a=await requireAccount(db,req);return res.json(await wallet(db,a))}if(action==='stats'){const a=await requireAccount(db,req);const stats=await profileStats(db,a);return res.json({...stats,titles:accountTitles(stats.achievements),coins:await coinBalance(db,a)})}if(action==='leaderboard'){const a=await requireAccount(db,req);return res.json(await leaderboardStats(db,a))}if(action==='period-leaderboard'){await requireAccount(db,req);return res.json(await periodLeaderboard(db))}fail('İşlem bulunamadı.',404)}catch(e){if(!e.status)console.error('KEKIP account:',e.code||e.message);res.status(e.status||503).json({error:e.status?e.message:'Hesap sunucusuna erişilemiyor. Tekrar dene.'})}})}
module.exports={attachAccounts,requireAdmin,database,sessionToken,getAccount,requireAccount,safeRequest,passwordHash,verifyPassword,socketAccount,recordBattle,recordGameResults,profileStats};
