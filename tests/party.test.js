'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {createPartyService}=require('../party');
const {createPartyRoom}=require('../football-online');

function fixture(adapters={}){
 let t=1000, n=0;
 const players=['lider','dost','ucuncu','yabanci'].map((username,i)=>({id:'id'+i,username}));
 const [leader,friend,third,stranger]=players;
 const calls=[];
 const db={async query(sql,args){
  if(sql.includes('ANY('))return {rows:args[0].map(id=>({id}))};
  if(sql.includes('kekip_friendships'))return {rows:players.filter(p=>p.username===args[1]&&p!==stranger&&args[0]!==stranger.id)};
  throw Error(sql);
 }};
 const service=createPartyService({battleship:async(_db,members,stable)=>{
  assert.ok(stable());calls.push(members);return '/?partyRoom=ABCDE';
 },late_answer:async()=>{throw Error('Unexpected room reservation');},...adapters},{now:()=>t,id:()=>String(++n).padStart(36,'0')});
 const act=(a,k,b={})=>service.run(db,a,k,{username:a.username,...b});
 async function add(a=friend){
  t+=1500;
  await act(leader,'invite',{target:a.username});
  const {invites}=await act(a,'state');
  assert.equal(invites.length,1);
  return act(a,'accept',{id:invites[0].id});
 }
 async function team(){
  await act(leader,'create');await add();
  await act(leader,'ready',{ready:true});await act(friend,'ready',{ready:true});
 }
 return {leader,friend,third,stranger,act,team,add,calls,advance:ms=>{t+=ms;},service};
}

test('friend-only invites, private messages and explicit leader transfer',async()=>{
 const h=fixture();
 await h.act(h.leader,'create');
 await assert.rejects(h.act(h.leader,'invite',{target:h.stranger.username}),{status:403});
 await h.add();
 await assert.rejects(h.act(h.friend,'leader',{target:h.leader.username}),{status:403});
 await h.act(h.leader,'chat',{text:'Merhaba'});
 assert.equal((await h.act(h.friend,'state')).party.messages[0].text,'Merhaba');
 assert.equal((await h.act(h.stranger,'state')).party,null);
 await assert.rejects(h.act(h.stranger,'chat',{text:'dışarıdan'}),{status:409});
 assert.equal((await h.act(h.leader,'leader',{target:h.friend.username})).party.leader,h.friend.username);
 await h.act(h.friend,'leave');
 assert.equal((await h.act(h.leader,'state')).party.leader,h.leader.username);
});

test('readiness, game capacity, offline timeout and private group transition',async()=>{
 const h=fixture();
 await h.team();
 await assert.rejects(h.act(h.leader,'launch',{game:'late_answer'}),{status:409});
 h.advance(23000);
 await assert.rejects(h.act(h.leader,'launch',{game:'battleship'}),{status:409});
 await h.act(h.leader,'ready',{ready:true});await h.act(h.friend,'ready',{ready:true});
 const [sent,duplicate]=await Promise.allSettled([
  h.act(h.leader,'launch',{game:'battleship'}),h.act(h.leader,'launch',{game:'battleship'})
 ]);
 assert.equal(sent.status,'fulfilled');assert.equal(duplicate.status,'rejected');
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],[h.leader,h.friend]);
 assert.equal((await h.act(h.friend,'state')).party.launch.url,'/?partyRoom=ABCDE');
 assert.equal((await h.act(h.stranger,'state')).party,null);
 assert.equal((await h.act(h.leader,'state')).party.ready,false);
 assert.equal((await h.add(h.third)).party.launch,null);
 h.advance(61000);assert.equal((await h.act(h.leader,'state')).party.launch,null);
});

test('failed reservation leaves the whole group ready and discloses no room',async()=>{
 const h=fixture({battleship:async()=>{throw Object.assign(Error('Oda dolu'),{status:409});}});
 await h.team();
 await assert.rejects(h.act(h.leader,'launch',{game:'battleship'}),{status:409});
 const {party}=await h.act(h.friend,'state');
 assert.ok(party.members.every(m=>m.ready));assert.equal(party.launch,null);assert.equal(party.busy,false);
});

test('football adapter reserves one account-bound roster and rolls back if the party changes',async()=>{
 const users=[{id:'a',username:'lider'},{id:'b',username:'dost'}];
 let saved, commands=[];
 const client={async query(sql,args){
  commands.push(sql.split(' ')[0]);
  if(sql.startsWith('SELECT'))return {rows:users};
  if(sql.startsWith('INSERT'))saved=JSON.parse(args[1]);
  return {rows:[]};
 },release(){}};
 const db={connect:async()=>client};
 const route=await createPartyRoom(db,users,()=>true);
 assert.match(route,/^\/football\.html\?footballRoom=[A-F0-9]{10}&party=1$/);
 assert.deepEqual(saved.players.map(p=>p.accountId),['a','b']);
 assert.deepEqual(saved.partyPending,saved.players.map(p=>p.id));
 assert.deepEqual(commands,['BEGIN','SELECT','INSERT','COMMIT']);
 commands=[];let checks=0;
 await assert.rejects(createPartyRoom(db,users,()=>++checks<2),{status:409});
 assert.deepEqual(commands,['BEGIN','SELECT','INSERT','ROLLBACK']);
});
