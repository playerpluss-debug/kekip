'use strict';

const pageSize=20;
const timestamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
function invalid(){throw Object.assign(new Error('Kazanım geçmişi sayfası geçersiz.'),{status:400});}
function cursorParts(cursor){
 if(cursor===undefined)return [null,null];
 if(typeof cursor!=='string'||!/^[A-Za-z0-9_-]{10,250}$/.test(cursor))invalid();
 let value;
 try{value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{invalid();}
 if(!Array.isArray(value)||value.length!==2)invalid();
 const [at,id]=value;
 if(typeof at!=='string'||!timestamp.test(at)||!Number.isFinite(Date.parse(at))||
    new Date(at).toISOString().slice(0,19)!==at.slice(0,19)||typeof id!=='string'||!/^[a-z0-9_-]{1,100}$/.test(id))invalid();
 return value;
}

async function readAcquisitions(db,account,catalog,wheelItemIds,cursor){
 const [at,id]=cursorParts(cursor);
 const q=await db.query(`
   WITH acquisitions AS (
     SELECT item_id,purchased_at FROM kekip_cosmetic_inventory
     WHERE account_id=$1 AND ($2::timestamptz IS NULL OR (purchased_at,item_id)<($2::timestamptz,$3::text))
     ORDER BY purchased_at DESC,item_id DESC LIMIT $4
   )
   SELECT i.item_id,to_char(i.purchased_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
     CASE
      WHEN EXISTS(SELECT 1 FROM kekip_coin_ledger l WHERE l.account_id=$1 AND l.source_kind='cosmetic' AND l.source_id=i.item_id AND l.created_at=i.purchased_at) THEN 'shop'
      WHEN EXISTS(SELECT 1 FROM kekip_admin_grants g WHERE g.account_id=$1 AND g.kind='item' AND g.item_id=i.item_id AND g.created_at=i.purchased_at) THEN 'gift'
      WHEN EXISTS(SELECT 1 FROM kekip_chest_openings c WHERE c.account_id=$1 AND c.item_id=i.item_id AND c.created_at=i.purchased_at) THEN 'chest'
      WHEN EXISTS(SELECT 1 FROM kekip_daily_wheel_items w WHERE w.account_id=$1 AND w.item_id=i.item_id AND w.created_at=i.purchased_at) THEN 'wheel'
      WHEN i.item_id=ANY($5::text[]) AND EXISTS(
        SELECT 1 FROM kekip_match_cards m
        WHERE m.account_id=$1 AND m.spin_used_at=i.purchased_at AND m.prizes->>m.chosen::integer='spin'
          AND NOT EXISTS(SELECT 1 FROM kekip_coin_ledger l WHERE l.account_id=$1 AND l.source_kind='match_card_wheel' AND l.source_id=m.id)
      ) THEN 'extra_wheel'
      ELSE 'unknown'
     END AS source
   FROM acquisitions i ORDER BY i.purchased_at DESC,i.item_id DESC`,
   [account.id,at,id,pageSize+1,wheelItemIds]);
 const rows=q.rows.slice(0,pageSize), last=rows.at(-1);
 const names=new Map(catalog.map(i=>[i.id,i.name]));
 return {
  username:account.username,
  items:rows.map(row=>({name:names.get(row.item_id)||row.item_id,at:row.at,source:row.source})),
  next:q.rows.length>pageSize?Buffer.from(JSON.stringify([last.at,last.item_id])).toString('base64url'):null
 };
}

module.exports={readAcquisitions};
