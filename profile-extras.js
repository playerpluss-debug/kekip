'use strict';

const Wardrobe = require('./wardrobe');
const Pets = require('./pets');
const Chest = require('./mystery-chest');
const chestCollections = require('./chest-collections.json');

const games = ['battleship', 'football', 'late_answer', 'arena'];
const characters = ['gece', 'golge'];
const pageSize = 8;
const sets = characters.flatMap(character =>
  Chest.eligibleItems(chestCollections,character)
    .filter(item => item.completeSet && item.visualApprovalPending !== true)
    .map(({id,name,character,thumbnail}) => ({id,name,character,thumbnail}))
);

function invalid(message, status=400) {
  throw Object.assign(new Error(message), {status});
}

async function inventory(db, accountId) {
  const q = await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[accountId]);
  return new Set(q.rows.map(row => row.item_id));
}

async function readShowcase(db, accountId, data, {self, statsVisible}) {
  const owned = await inventory(db,accountId);
  const mythics = sets.filter(item => owned.has(item.id));
  const pet = Pets.strongestPet(owned);
  const showcase = {
    favoriteGame: games.includes(data.favoriteGame) ? data.favoriteGame : null,
    mythic: mythics.find(item => item.id===data.showcaseMythic) || null,
    pet: pet ? {name:pet.name,art:pet.art,rarity:pet.rarity} : null
  };
  if (self) showcase.mythicOptions = mythics;
  if (statsVisible) {
    showcase.collections = characters.map(character => {
      const items = Wardrobe.collection(character).items.filter(i => i.starter || i.status==='available');
      const extras = sets.filter(i => i.character===character);
      const total = items.length + extras.length;
      const count = items.filter(i => i.starter || owned.has(i.id)).length + extras.filter(i => owned.has(i.id)).length;
      return {character, owned:count, total, percent:total ? Math.round(count*100/total) : 0};
    });
  }
  return showcase;
}

async function saveShowcase(db, account, body) {
  if (body.username !== account.username) invalid('Hesap değişti. Sayfayı yenile.',409);
  if (body.favoriteGame!==null && !games.includes(body.favoriteGame)) invalid('Favori oyun geçersiz.');
  if (body.mythicId!==null && !sets.some(item => item.id===body.mythicId)) invalid('Mitik set geçersiz.');
  if (body.mythicId!==null && !(await inventory(db,account.id)).has(body.mythicId)) invalid('Bu Mitik set gardırobunda yok.',403);
  const data = {favoriteGame:body.favoriteGame,showcaseMythic:body.mythicId};
  await db.query(`INSERT INTO kekip_player_profiles(account_id,data) VALUES($1,$2::jsonb)
    ON CONFLICT(account_id) DO UPDATE SET data=COALESCE(kekip_player_profiles.data,'{}'::jsonb)||EXCLUDED.data`,
    [account.id,JSON.stringify(data)]);
  return {username:account.username,showcase:await readShowcase(db,account.id,data,{self:true,statsVisible:true})};
}

function readCursor(value) {
  if (value === undefined) return [null,null,null];
  if (typeof value!=='string'||!/^[a-zA-Z0-9_-]{10,200}$/.test(value)) invalid('Maç geçmişi sayfası geçersiz.');
  let parsed;
  try { parsed=JSON.parse(Buffer.from(value,'base64url').toString('utf8')); } catch { invalid('Maç geçmişi sayfası geçersiz.'); }
  if (!Array.isArray(parsed)||parsed.length!==3) invalid('Maç geçmişi sayfası geçersiz.');
  const [at,game,key]=parsed;
  if (typeof at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(at)||!Number.isFinite(Date.parse(at))||new Date(at).toISOString().slice(0,19)!==at.slice(0,19)||!games.includes(game)||typeof key!=='string'||!/^[0-9a-f]{32}$/.test(key)) invalid('Maç geçmişi sayfası geçersiz.');
  return parsed;
}

function summarize(row) {
  const result = row.result || {};
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const entry = {game:row.game,playedAt:row.played_at};
  if (row.game==='battleship') return {...entry,outcome:result.win?'win':'loss',hits:number(result.hits),shots:number(result.shots)};
  if (row.game==='football') return {...entry,goals:number(result.goals),assists:number(result.assists)};
  if (row.game==='arena') return {...entry,outcome:result.win?'win':'complete',score:number(result.score)};
  return {...entry,outcome:result.forfeited||result.complete===false?'incomplete':result.win?'win':'complete',correct:number(result.correct)};
}

async function readHistory(db, accountId, cursor) {
  const [at,game,key] = readCursor(cursor);
  const history = db.query(`SELECT game,result,
      to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS played_at,
      md5(match_id) AS page_key
    FROM kekip_game_results
    WHERE account_id=$1 AND game=ANY($2::text[])
      AND ($3::timestamptz IS NULL OR (created_at,game,md5(match_id)) < ($3::timestamptz,$4::text,$5::text))
    ORDER BY created_at DESC,game DESC,md5(match_id) DESC LIMIT $6`,
    [accountId,games,at,game,key,pageSize+1]);
  const recent = cursor===undefined ? db.query(`SELECT game,max(created_at) AS "playedAt" FROM kekip_game_results
    WHERE account_id=$1 AND game=ANY($2::text[]) GROUP BY game ORDER BY max(created_at) DESC,game`,[accountId,games]) : null;
  const [page, latest] = await Promise.all([history,recent]);
  const rows = page.rows.slice(0,pageSize), last = rows.at(-1);
  const next = page.rows.length>pageSize ? Buffer.from(JSON.stringify([last.played_at,last.game,last.page_key])).toString('base64url') : null;
  return {matches:rows.map(summarize),next,...(latest?{recent:latest.rows}:{})};
}

module.exports = {readShowcase,saveShowcase,readHistory};
