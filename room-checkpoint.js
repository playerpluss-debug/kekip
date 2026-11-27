'use strict';
const {randomUUID}=require('node:crypto');

const MAX_AGE=10*60_000;
const MAX_BYTES=4*1024*1024;

async function initRoomCheckpoint(db,{capture,restore,now=Date.now,logger=console}){
 const owner=randomUUID(),key='games-v1';
 await db.query(`CREATE TABLE IF NOT EXISTS kekip_room_checkpoints(
  key text PRIMARY KEY, owner text NOT NULL, data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
 )`);
 const row=(await db.query(`INSERT INTO kekip_room_checkpoints(key,owner) VALUES($1,$2)
   ON CONFLICT(key) DO UPDATE SET owner=EXCLUDED.owner
   RETURNING data,updated_at`,[key,owner])).rows[0];
 const saved=row?.data, age=now()-new Date(row?.updated_at).getTime();
 if(saved?.version===1&&age>=-30_000&&age<=MAX_AGE)restore(saved);
 let pending=null,lastPayload=null,lastWrite=0, fenced=false;
 async function flush(){
  if(fenced)return false;
  if(pending)return pending;
  let snapshot,payload;
  const t=now();
  try{snapshot=capture();payload=JSON.stringify(snapshot);}catch(e){logger.warn('Room checkpoint capture:',e.code||e.message);return false;}
  if(Buffer.byteLength(payload)>MAX_BYTES){logger.warn('Room checkpoint payload exceeded limit');return false;}
  if(payload===lastPayload&&t-lastWrite<30_000)return true;
  pending=(async()=>{
   try{
    const result=await db.query(`UPDATE kekip_room_checkpoints SET data=$3::jsonb,updated_at=now()
      WHERE key=$1 AND owner=$2`,[key,owner,JSON.stringify({version:1,capturedAt:t,...snapshot})]);
    if(result.rowCount!==1){fenced=true;return false;}
    lastPayload=payload;lastWrite=t;return true;
   }catch(e){logger.warn('Room checkpoint write:',e.code||e.message);return false;}
  })();
  try{return await pending;}finally{pending=null;}
 }
 return {flush};
}
module.exports={initRoomCheckpoint};
