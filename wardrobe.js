'use strict';
// Character-specific registry; add the male collection only when its assets are approved.
const collections=Object.freeze({gece:require('./gece-catalog.json')});
const required=['av_hair','av_eye','av_brow','av_expression','av_top','av_bottom','av_shoes'];
const optional=['av_ear','av_wrist'];
function error(message,status=400){throw Object.assign(new Error(message),{status});}
function collection(character){if(typeof character!=='string'||!Object.hasOwn(collections,character))error('Karakter henüz hazır değil.');return collections[character];}
function access(character,owned){const c=collection(character), ids=new Set(owned);return c.items.filter(i=>i.starter||ids.has(i.id)).map(i=>i.id);}
function validate(character,draft,owned){const c=collection(character),allowed=new Set(access(character,owned));if(!draft||typeof draft!=='object'||Array.isArray(draft)||!draft.items||typeof draft.items!=='object'||Array.isArray(draft.items))error('Kombin geçersiz.');
 const slots=[...required,...optional];if(Object.keys(draft.items).some(s=>!slots.includes(s)))error('Geçersiz kategori.');
 const items={};for(const s of slots){const id=draft.items[s];if(optional.includes(s)&&(id===null||id==='')){items[s]=null;continue;}const item=c.items.find(i=>i.id===id&&i.slot===s);if(!item)error('Ürün bu karakter veya kategoriye ait değil.');if(!allowed.has(id))error('Bu ürün gardırobunda yok.',403);items[s]=id;}
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
module.exports={collections,collection,access,validate,readSaved,save};
