'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const Extras=require('../profile-extras');
const setId='gece_chest_ay_tutulmasi_set';

function profileDb(ids=[]) {
  const writes=[];
  return {writes,async query(sql,params){
    if(sql.startsWith('SELECT item_id'))return {rows:ids.map(item_id=>({item_id}))};
    if(sql.includes('INSERT INTO kekip_player_profiles')){
      writes.push(JSON.parse(params[1]));
      return {rows:[]};
    }
    throw Error(sql);
  }};
}

test('showcase validates ownership and does not expose inventory to visitors',async()=>{
  const db=profileDb([setId,'pet_ember_fox','pet_moon_cat']);
  const data={favoriteGame:'football',showcaseMythic:setId};
  const hiddenStats=await Extras.readShowcase(db,'player',data,{self:false,statsVisible:false});
  assert.equal(hiddenStats.favoriteGame,'football');
  assert.equal(hiddenStats.pet.name,'Kor Tilkisi');
  assert.equal(hiddenStats.mythic.id,setId);
  assert.equal(Object.hasOwn(hiddenStats,'mythicOptions'),false);
  assert.equal(Object.hasOwn(hiddenStats,'collections'),false);
  const self=await Extras.readShowcase(db,'player',data,{self:true,statsVisible:true});
  assert.deepEqual(self.mythicOptions.map(x=>x.id),[setId]);
  assert.ok(self.collections.every(c=>c.owned<=c.total&&c.percent<=100));
  const empty=await Extras.readShowcase(profileDb(),'player',data,{self:true,statsVisible:true});
  assert.equal(empty.mythic,null);
  assert.equal(self.collections[0].owned,empty.collections[0].owned+1);
});

test('only valid game and owned set selections can be saved',async()=>{
  const account={id:'id',username:'tester'}, db=profileDb([setId]);
  const input={username:'tester',favoriteGame:'football',mythicId:setId};
  await assert.rejects(Extras.saveShowcase(db,account,{...input,username:'other'}),{status:409});
  await assert.rejects(Extras.saveShowcase(db,account,{...input,favoriteGame:'unknown'}),{status:400});
  await assert.rejects(Extras.saveShowcase(profileDb(),account,input),{status:403});
  assert.equal(db.writes.length,0);
  const result=await Extras.saveShowcase(db,account,input);
  assert.equal(result.showcase.mythic.id,setId);
  assert.deepEqual(db.writes,[{favoriteGame:'football',showcaseMythic:setId}]);
  const clear=await Extras.saveShowcase(db,account,{...input,favoriteGame:null,mythicId:null});
  assert.equal(clear.showcase.mythic,null);
  assert.equal(clear.showcase.favoriteGame,null);
});

test('history cursor orders tied timestamps without returning room identifiers',async()=>{
  const played_at='2026-11-27T17:08:04.123456Z';
  const rows=Array.from({length:9},(_,i)=>({played_at,game:'football',page_key:String(9-i).padStart(32,'0'),result:{goals:i,assists:0,roomCode:'PRIVATE'}}));
  const calls=[];
  const db={async query(sql,params){
    calls.push(params);
    if(sql.includes('GROUP BY'))return {rows:[{game:'football',playedAt:played_at}]};
    return {rows:params[2]===null?rows:rows.slice(8)};
  }};
  const first=await Extras.readHistory(db,'id');
  assert.equal(first.matches.length,8);
  assert.equal(first.recent.length,1);
  assert.deepEqual(first.matches[0],{game:'football',playedAt:played_at,goals:0,assists:0});
  const second=await Extras.readHistory(db,'id',first.next);
  assert.equal(second.matches[0].goals,8);
  assert.equal(second.next,null);
  assert.deepEqual(calls[2].slice(2,5),[played_at,'football',rows[7].page_key]);
  await assert.rejects(Extras.readHistory(db,'id','invalid'),{status:400});
  assert.equal(calls.length,3);
});

test('history summarizes losses and forfeits using only game fields',async()=>{
  const db={async query(sql){
    return {rows:sql.includes('GROUP BY')?[]:[
      {game:'late_answer',result:{forfeited:true,win:true,correct:3}},
      {game:'battleship',result:{win:false,hits:5,shots:17}}
    ]};
  }};
  const r=await Extras.readHistory(db,'id');
  assert.equal(r.matches[0].outcome,'incomplete');
  assert.equal(r.matches[1].outcome,'loss');
  assert.equal(r.matches[1].hits,5);
});
