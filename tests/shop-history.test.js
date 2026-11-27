'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readAcquisitions}=require('../shop-history');

test('acquisition history maps owned items to their recorded sources and preserves timestamp ties',async()=>{
 const at='2026-11-27T11:00:00.123456Z';
 const rows=Array.from({length:21},(_,i)=>({item_id:'item_'+i,at,source:i===0?'extra_wheel':'unknown',reason:'private'}));
 const calls=[];
 const db={async query(sql,params){calls.push(params);assert.match(sql,/WHERE account_id=\$1/);return {rows:params[1]?rows.slice(20):rows};}};
 const account={id:'owner',username:'tester'};
 const catalog=[{id:'item_0',name:'Kor Tilkisi'}];
 const first=await readAcquisitions(db,account,catalog,['item_0']);
 assert.equal(first.items.length,20);
 assert.deepEqual(first.items[0],{name:'Kor Tilkisi',at,source:'extra_wheel'});
 assert.equal(first.items[1].source,'unknown');
 const second=await readAcquisitions(db,account,catalog,['item_0'],first.next);
 assert.equal(second.items.length,1);assert.equal(second.next,null);
 assert.deepEqual(calls[1],['owner',at,'item_19',21,['item_0']]);
});
test('invalid acquisition cursors are rejected before a database query',async()=>{
 const db={query(){throw Error('unexpected database access');}};
 for(const cursor of ['malformed',Buffer.from(JSON.stringify(['2026-02-30T10:00:00.123456Z','item'])).toString('base64url')]){
  await assert.rejects(readAcquisitions(db,{id:'owner'},[],[],cursor),{status:400});
 }
});
