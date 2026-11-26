'use strict';
// Character-specific registry; add the male collection only when its assets are approved.
const collections=Object.freeze({gece:require('./gece-catalog.json'),golge:require('./golge-catalog.json')});
const required=['av_hair','av_eye','av_brow','av_expression','av_top','av_bottom','av_shoes'];
const optional=['av_ear','av_wrist'];
function error(message,status=400){throw Object.assign(new Error(message),{status});}
function collection(character){if(typeof character!=='string'||!Object.hasOwn(collections,character))error('Karakter henüz hazır değil.');return collections[character];}
function access(character,owned){const c=collection(character), ids=new Set(owned);return c.items.filter(i=>i.starter||ids.has(i.id)).map(i=>i.id);}
function validate(character,draft,owned){const c=collection(character),allowed=new Set(access(character,owned));if(!draft||typeof draft!=='object'||Array.isArray(draft)||!draft.items||typeof draft.items!=='object'||Array.isArray(draft.items))error('Kombin geçersiz.');
 const extra=character==='golge'?['av_glasses','av_neck']:[];const optionalSlots=[...optional,...extra];const slots=[...required,...optionalSlots];if(Object.keys(draft.items).some(s=>!slots.includes(s)))error('Geçersiz kategori.');
 const items={};for(const s of slots){const id=draft.items[s];if(optionalSlots.includes(s)&&(id===null||id==='')){items[s]=null;continue;}const item=c.items.find(i=>i.id===id&&i.slot===s);if(!item)error('Ürün bu karakter veya kategoriye ait değil.');if(!allowed.has(id))error('Bu ürün gardırobunda yok.',403);items[s]=id;}
 if(!c.colors.hair.some(x=>x.key===draft.hairColor)||!c.colors.eye.some(x=>x.key===draft.eyeColor))error('Renk seçimi geçersiz.');if(typeof draft.expressionBrows!=='boolean')error('İfade kaşı ayarı geçersiz.');return {character,items,hairColor:draft.hairColor,eyeColor:draft.eyeColor,expressionBrows:draft.expressionBrows};}
// One saved look per character. The most recently saved look is shown on the profile.
async function readSaved(db,accountId,character=null){
 const q=await db.query('SELECT character,appearance FROM kekip_modular_avatars WHERE account_id=$1'+(character?' AND character=$2':'')+' ORDER BY updated_at DESC, character LIMIT 1',character?[accountId,character]:[accountId]);
 const row=q.rows[0];return row&&Object.hasOwn(collections,row.character)?row.appearance:null;
}
async function save(db,accountId,character,draft){
 const q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[accountId]);
 const appearance=validate(character,draft,q.rows.map(r=>r.item_id));
 await db.query('INSERT INTO kekip_modular_avatars(account_id,character,appearance) VALUES($1,$2,$3::jsonb) ON CONFLICT(account_id,character) DO UPDATE SET appearance=EXCLUDED.appearance,updated_at=now()',[accountId,character,JSON.stringify(appearance)]);
 return appearance;
}
// Separate saved outfits; the existing active-avatar table is unchanged.
function slotNumber(v){if(!Number.isInteger(v)||v<1||v>5)error('Kombin slotu geçersiz.');return v;}
function slotName(v){if(typeof v!=='string')error('Kombin adı geçersiz.');const n=v.trim();if(!n||[...n].length>40||/[\x00-\x1f\x7f]/.test(n))error('Kombin adı 1–40 karakter olmalı.');return n;}
async function readSlots(db,accountId,character){
 collection(character);const q=await db.query('SELECT slot,name,appearance,updated_at FROM kekip_avatar_outfits WHERE account_id=$1 AND character=$2 ORDER BY slot',[accountId,character]);
 return {character,slots:q.rows,active:await readSaved(db,accountId)};
}
async function slotAction(db,accountId,character,action,b){
 collection(character);if(action==='wardrobe-slots')return readSlots(db,accountId,character);
 const slot=slotNumber(b.slot);const params=[accountId,character,slot];
 if(action==='wardrobe-slot-save'){
  const name=slotName(b.name),q=await db.query('SELECT item_id FROM kekip_cosmetic_inventory WHERE account_id=$1',[accountId]);
  const appearance=validate(character,b.draft,q.rows.map(r=>r.item_id));
  await db.query('INSERT INTO kekip_avatar_outfits(account_id,character,slot,name,appearance) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(account_id,character,slot) DO UPDATE SET name=EXCLUDED.name,appearance=EXCLUDED.appearance,updated_at=now()',[...params,name,JSON.stringify(appearance)]);
 }else if(action==='wardrobe-slot-rename'){
  const q=await db.query('UPDATE kekip_avatar_outfits SET name=$4,updated_at=now() WHERE account_id=$1 AND character=$2 AND slot=$3',[...params,slotName(b.name)]);if(!q.rowCount)error('Kombin bulunamadı.',404);
 }else if(action==='wardrobe-slot-delete'){
  const q=await db.query('DELETE FROM kekip_avatar_outfits WHERE account_id=$1 AND character=$2 AND slot=$3',params);if(!q.rowCount)error('Kombin bulunamadı.',404);
 }else if(action==='wardrobe-slot-equip'){
  const q=await db.query('SELECT appearance FROM kekip_avatar_outfits WHERE account_id=$1 AND character=$2 AND slot=$3',params);if(!q.rows.length)error('Kombin bulunamadı.',404);
  await save(db,accountId,character,q.rows[0].appearance);
 }else error('İşlem bulunamadı.',404);
 return readSlots(db,accountId,character);
}
module.exports={collections,collection,access,validate,readSaved,save,readSlots,slotAction};
