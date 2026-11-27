'use strict';
// 0.51.18.5.2 – Server-side KC-only chest ownership and receipts.
// Activation is intentionally disabled in accounts.js until the approved assets/UI exist.
const crypto=require('node:crypto');
const PRICE=100;
const CHARACTERS=Object.freeze(['gece','golge']);
const TIERS=Object.freeze([
 Object.freeze({id:'rare',label:'Nadir',weight:60,refund:20}),
 Object.freeze({id:'epic',label:'Epik',weight:30,refund:40}),
 Object.freeze({id:'legendary',label:'Efsanevi',weight:9,refund:75}),
 Object.freeze({id:'mythic',label:'Mitik',weight:1,refund:100})
]);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
function validateCharacter(character){if(!CHARACTERS.includes(character))fail('Sandık karakteri geçersiz.');}
function eligibleItems(collections,character){
 validateCharacter(character);
 const items=collections[character]?.items||[];
 const marked=items.filter(i=>i.chestOnly===true);
 const all=CHARACTERS.flatMap(k=>collections[k]?.items||[]);
 // Fail closed on invalid chest metadata rather than silently changing the advertised pool.
 if(marked.some(i=>typeof i.id!=='string'||!i.id.startsWith(character+'_chest_')||
  all.filter(x=>x.id===i.id).length!==1||i.character!==character||i.starter!==false||
  i.onboardingEligible===true||i.price!==0||i.status!=='available'||
  !TIERS.some(t=>t.id===i.chestRarity)||typeof i.name!=='string'||!i.name.trim()||
  typeof i.thumbnail!=='string'||!i.thumbnail.startsWith('/images/')||
  typeof i.slot!=='string'||!i.slot.startsWith('av_')||
  (i.chestRarity==='mythic'?(i.slot!=='av_set'||i.completeSet!==true):(i.slot==='av_set'||i.completeSet===true))))fail('Sandık koleksiyonu henüz hazır değil.',503);
 return marked;
}
function groups(items,owned){const set=new Set(owned);return TIERS.map(t=>({...t,items:items.filter(i=>i.chestRarity===t.id&&!set.has(i.id))}));}
// Rarity is drawn from the full fixed distribution, even when a tier is exhausted.
function effectiveOdds(grouped){return grouped.map(t=>({id:t.id,label:t.label,basePercent:t.weight,remaining:t.items.length,percent:t.weight,refundKC:t.refund,refundOnly:t.items.length===0}));}
function draw(grouped,randomInt=crypto.randomInt){
 if(!grouped.some(t=>t.items.length))fail('Bu koleksiyondaki tüm ürünlere sahipsin.',409);
 let roll=randomInt(100);
 for(const t of grouped){if(roll<t.weight){return t.items.length?{item:t.items[randomInt(t.items.length)],rewardType:'cosmetic'}:{item:null,rewardType:'refund',rarity:t.id,rarityLabel:t.label,refundKC:t.refund};}roll-=t.weight;}
 throw new Error('Invalid random roll');
}
function publicItem(i){const tier=TIERS.find(t=>t.id===i.chestRarity);return {id:i.id,character:i.character,name:i.name,slot:i.slot,thumbnail:i.thumbnail,rarity:tier.id,rarityLabel:tier.label,completeSet:i.completeSet===true,visualApprovalPending:i.visualApprovalPending===true};}
async function ensureSchema(db){
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_chest_openings (
  account_id text NOT NULL REFERENCES kekip_football_accounts(id) ON DELETE CASCADE,
  request_id text NOT NULL CHECK(request_id ~ '^[a-f0-9]{32}$'),
  character text NOT NULL CHECK(character IN ('gece','golge')),
  item_id text, price integer NOT NULL CHECK(price>0),
  reward jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,request_id), UNIQUE(account_id,item_id)
 )`);
 // Existing unique(account_id,item_id) continues to prevent duplicate cosmetics; NULL permits repeated KC refunds.
 await db.query(`ALTER TABLE kekip_chest_openings ALTER COLUMN item_id DROP NOT NULL`);
}
async function inventory(db,a){const q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[a.id]);return q.rows.map(r=>r.item_id);}
function ownedRewards(collections,owned,character=null){
 if(character!==null)validateCharacter(character);
 const ids=new Set(owned);
 return (character===null?CHARACTERS:[character]).flatMap(k=>eligibleItems(collections,k).filter(i=>ids.has(i.id)).map(publicItem));
}
function createService({collections,coinBalance,write,enabled=false,randomInt=crypto.randomInt}){
 function describe(character,owned){
  const items=eligibleItems(collections,character),grouped=groups(items,owned);
  // At first launch every tier must be represented in the full approved collection.
  const ready=TIERS.every(t=>items.filter(i=>i.chestRarity===t.id).length===(t.id==='mythic'?1:3))&&!items.some(i=>i.visualApprovalPending===true);
  const remaining=grouped.reduce((n,t)=>n+t.items.length,0);
  return {character,price:PRICE,ready,enabled:enabled===true&&ready&&remaining>0,total:items.length,remaining,items:items.map(i=>({...publicItem(i),owned:owned.includes(i.id)})),odds:effectiveOdds(grouped)};
 }
 return async function action(db,a,kind,b,verify){
  if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.',409);
  if(kind==='chest-status'){
   const owned=await inventory(db,a);
   return {username:a.username,price:PRICE,enabled:enabled===true,balance:await coinBalance(db,a),chests:CHARACTERS.map(k=>describe(k,owned))};
  }
  if(kind==='chest-inventory'){
   if(b.character!==undefined)validateCharacter(b.character);
   return {username:a.username,items:ownedRewards(collections,await inventory(db,a),b.character??null)};
  }
  if(kind==='chest-history'){
   const q=await db.query('SELECT request_id,character,price,reward,created_at FROM kekip_chest_openings WHERE account_id=$1 ORDER BY created_at DESC,request_id DESC LIMIT 50',[a.id]);
   return {username:a.username,history:q.rows.map(p=>({requestId:p.request_id,character:p.character,price:p.price,reward:p.reward,createdAt:p.created_at}))};
  }
  if(kind!=='chest-open')fail('İşlem bulunamadı.',404);
  validateCharacter(b.character);
  if(typeof b.requestId!=='string'||!/^[a-f0-9]{32}$/.test(b.requestId))fail('Sandık işlem anahtarı geçersiz.');
  if(b.expectedPrice!==PRICE)fail('Sandık fiyatı değişti. Sayfayı yenile.',409);
  // The caller uses the same account-row transaction lock as shop, wardrobe and daily rewards.
  return write(db,a,async c=>{
   if(verify){const current=await verify(c);if(current.id!==a.id)fail('Hesap değişti. Sayfayı yenile.',409);}
   const prior=await c.query('SELECT character,price,reward FROM kekip_chest_openings WHERE account_id=$1 AND request_id=$2',[a.id,b.requestId]);
   if(prior.rows.length){const p=prior.rows[0];if(p.character!==b.character||p.price!==b.expectedPrice)fail('İşlem anahtarı başka bir sandığa ait.',409);return {ok:true,username:a.username,requestId:b.requestId,price:p.price,reward:p.reward,balance:await coinBalance(c,a),duplicate:true};}
   if(enabled!==true)fail('Gizemli Sandık henüz açılmadı.',409);
   const owned=await inventory(c,a),state=describe(b.character,owned);
   if(!state.ready)fail('Sandık koleksiyonu henüz hazır değil.',409);
   if(!state.remaining)fail('Bu koleksiyondaki tüm ürünlere sahipsin.',409);
   if(await coinBalance(c,a)<PRICE)fail('Yeterli KC yok.',409);
   const result=draw(groups(eligibleItems(collections,b.character),owned),randomInt),item=result.item;
   const reward=item?{...publicItem(item),type:'cosmetic'}:{type:'refund',character:b.character,rarity:result.rarity,rarityLabel:result.rarityLabel,refundKC:result.refundKC};
   if(item)await c.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) VALUES($1,$2)',[a.id,item.id]);
   await c.query("INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'mystery_chest',$2,$3,$4)",[a.id,b.requestId,'Gizemli Sandık · '+(b.character==='gece'?'Gece':'Gölge'),-PRICE]);
   if(!item)await c.query("INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'mystery_chest_refund',$2,$3,$4)",[a.id,b.requestId,'Gizemli Sandık · '+result.rarityLabel+' KC telafisi',result.refundKC]);
   await c.query('INSERT INTO kekip_chest_openings(account_id,request_id,character,item_id,price,reward) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[a.id,b.requestId,b.character,item?.id??null,PRICE,JSON.stringify(reward)]);
   return {ok:true,username:a.username,requestId:b.requestId,price:PRICE,reward,balance:await coinBalance(c,a),duplicate:false};
  });
 };
}
module.exports={PRICE,TIERS,eligibleItems,groups,effectiveOdds,draw,ensureSchema,ownedRewards,createService};
