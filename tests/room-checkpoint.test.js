'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initRoomCheckpoint}=require('../room-checkpoint');
function memoryDb(){
 let owner,data=null,updated_at=new Date();
 return {async query(sql,args){
  if(sql.includes('INSERT INTO')){owner=args[1];return {rows:[{data,updated_at}]};}
  if(sql.includes('UPDATE kekip_room_checkpoints')){
   if(owner!==args[1])return {rowCount:0};
   data=JSON.parse(args[2]);updated_at=new Date();
   return {rowCount:1};
  }
  return {rows:[]};
 }};
}
test('replacement process restores state and fences the previous writer',async()=>{
 const db=memoryDb(), payload={battle:[{code:'ABCDE'}],late:[]};
 const original=await initRoomCheckpoint(db,{capture:()=>payload,restore(){throw Error('empty store');}});
 assert.equal(await original.flush(),true);
 let restored;
 const replacement=await initRoomCheckpoint(db,{capture:()=>({battle:[],late:[]}),restore:s=>{restored=s;}});
 assert.deepEqual(restored.battle,payload.battle);
 assert.equal(await replacement.flush(),true);
 payload.battle.push({code:'FGHJK'});
 assert.equal(await original.flush(),false);
});
