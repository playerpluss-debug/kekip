'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../late-answer-game');
const {attachLateAnswer,voiceConfig,signalPayload}=require('../late-answer');
const bank=require('../late-answer-questions.json');
const settings={visibility:'public'};
const player=i=>({id:'id'+i,username:'player'+i,online:true,ready:true});
function room(size=3){
  const r=game.createRoom('ABCDE',player(0),settings);
  for(let i=1;i<size;i++)r.players.push(player(i));
  assert.equal(game.start(r,0,'match',()=>0),true);
  return r;
}
const choose=(r,id,correct,at=r.deadline-1)=>game.vote(r,id,{sequence:r.sequence,correct},at);

test('120 editable unique questions, valid settings and bounded draw',()=>{
  assert.ok(bank.length>=120);
  assert.equal(new Set(bank.map(q=>q.question)).size,bank.length);
  for(const q of bank)assert.ok(q.category&&q.question.endsWith('?')&&q.answers.length>=2);
  assert.equal(game.validateSettings({visibility:'other'}),null);
  assert.deepEqual(game.validateSettings(settings),settings);
  assert.throws(()=>game.drawQuestions(bank.length+1),RangeError);
});

test('first contestant is ready, the next player reads, and one deadline governs every answer',()=>{
  const r=room();
  assert.equal(r.phase,'turn_ready');
  assert.equal(game.snapshot(r,'id0',0).question,null);
  assert.equal(game.readyTurn(r,'id1',r.sequence,10),false);
  assert.equal(game.readyTurn(r,'id0',r.sequence,10),true);
  assert.equal(r.deadline,60010);
  assert.equal(game.snapshot(r,'id0',10).question,bank[0].question);
  assert.equal(game.snapshot(r,'id1',10).answers,null);
  assert.equal(choose(r,'id1',false,20),false);
  assert.equal(choose(r,'id2',true,20),false);
  assert.equal(choose(r,'id1',true,20),true);
  assert.equal(r.players[0].correct,0);
  assert.equal(game.snapshot(r,'id0',20).question,bank[1].question);
  assert.equal(game.snapshot(r,'id0',20).answers,null);
  assert.equal(game.snapshot(r,'id2',20).answers,null);
  assert.deepEqual(game.snapshot(r,'id1',20).answers,bank[0].answers);
  assert.equal(game.vote(r,'id1',{sequence:r.sequence-1,correct:true},30),false);
  assert.equal(choose(r,'id0',true,30),false);
  assert.ok(choose(r,'id1',true,30));
  assert.ok(choose(r,'id1',false,40));
  for(let i=0;i<15;i++)assert.ok(choose(r,'id1',true,100+i));
  assert.equal(r.players[0].correct,16);
  assert.equal(r.deadline,60010);
  assert.equal(choose(r,'id1',true,r.deadline),false);
  assert.equal(game.advance(r,60009),false);
  assert.equal(game.advance(r,60010),true);
  assert.equal(r.phase,'summary');
  assert.equal(r.last.correct,16);
});

test('cancelled turns restore only the unfinished round and tied scores share a rank',()=>{
  const r=room(4);
  game.readyTurn(r,'id0',r.sequence,0);
  choose(r,'id1',true,100);choose(r,'id1',true,200);
  assert.equal(game.removePlayer(r,'id0',1000),true);
  assert.equal(r.last.kind,'cancelled');
  assert.deepEqual(game.rows(r)[0].result,{complete:false,forfeited:true,win:false,rank:null,scoreHalf:0,correct:0,juryAgreed:0});
  assert.equal(r.host,'id1');
  Object.assign(r.players[1],{correct:9,completed:true});
  Object.assign(r.players[2],{correct:9,completed:true});
  Object.assign(r.players[3],{correct:2,completed:true});
  assert.deepEqual(game.rows(r).slice(1).map(row=>[row.result.rank,row.result.scoreHalf]),[[1,6],[1,6],[3,2]]);
});

function harness(options={}){
  let t=1000, sweep, uuid=0, roll=0;const records=[];
  const nsp={sockets:new Map(),use(fn){this.auth=fn;},on(event,fn){assert.equal(event,'connection');this.connect=fn;}};
  const backend=attachLateAnswer({of(name){assert.equal(name,'/late-answer');return nsp;}},{
    socketAccount:async socket=>socket.account,sessionToken:req=>req.get('cookie'),
    recordGameResults:async (...args)=>{records.push(args);if(options.failOnce&&records.length===1)throw Error('retry');}
  },{now:()=>t,schedule:fn=>{sweep=fn;return 1;},cancel(){},rng:max=>roll++%max,uuid:()=>('match-'+(++uuid)),env:{},logger:{error(){}}});
  async function connect(i,suffix='',session='session'+i){
    const events=new Map(),sent=[];
    const socket={id:'sock'+i+suffix,account:player(i),data:{},request:{headers:{cookie:session}},
      on:(e,fn)=>events.set(e,fn),emit:(e,d)=>sent.push([e,d]),
      state(){return sent.findLast(([e])=>e==='late:state')?.[1];},
      messages(e){return sent.filter(([name])=>name===e).map(([,d])=>d);},
      send(e,d={}){let result;events.get('late:'+e)(d,r=>{result=r});assert.ok(result);return result;},
      disconnect(){this.closed=true;nsp.sockets.delete(this.id);events.get('disconnect')?.();}
    };
    await new Promise((resolve,reject)=>nsp.auth(socket,e=>e?reject(e):resolve()));
    nsp.sockets.set(socket.id,socket);nsp.connect(socket);return socket;
  }
  return {connect,advance(ms){t+=ms;sweep();},now:()=>t,records,backend};
}
async function open(h,count,options=settings){
  const sockets=await Promise.all(Array.from({length:count},(_,i)=>h.connect(i)));
  const {code}=sockets[0].send('create',options);
  assert.match(code,/^[A-Z2-9]{5}$/);
  for(const s of sockets.slice(1))assert.equal(s.send('join',{code}).ok,true);
  for(const s of sockets)assert.equal(s.send('ready',{ready:true}).ok,true);
  assert.equal(sockets[0].send('start').ok,true);
  return {sockets,code};
}

function ready(socket){
  return socket.send('turn-ready',{sequence:socket.state().sequence});
}
function approve(socket){
  return socket.send('vote',{correct:true,sequence:socket.state().sequence});
}
for(const count of [3,8])test('complete '+count+' player match on fake sockets',async()=>{
  const h=harness(),{sockets,code}=await open(h,count);
  for(let index=0;index<sockets.length;index++){
    const contestant=sockets[index],reader=sockets[(index+1)%count],spectator=sockets[(index+2)%count];
    assert.equal(contestant.state().phase,'turn_ready');
    assert.equal(contestant.state().reader,reader.account.username);
    assert.equal(ready(contestant).ok,true);
    assert.equal(approve(reader).ok,true);
    assert.equal(approve(spectator).ok,false);
    for(let i=0;i<=index;i++)assert.equal(approve(reader).ok,true);
    assert.equal(contestant.state().deadline-h.now(),60000);
    h.advance(60000);
    assert.equal(contestant.state().last.correct,index+1);
    h.advance(4000);
  }
  assert.equal(sockets[0].state().phase,'final');
  await new Promise(setImmediate);
  const [name,,result,tx,cards]=h.records[0];
  assert.equal(name,'late_answer');assert.equal(tx,null);assert.equal(cards,true);
  assert.deepEqual(result.map(r=>r.result.correct),sockets.map((_,i)=>i+1));
  assert.equal(result.at(-1).result.rank,1);
  assert.equal(result.at(-1).result.win,true);
  assert.equal(result[0].result.scoreHalf,2);
  assert.ok(sockets.every(s=>s.messages('late:recorded').length===1));
  assert.equal(sockets[0].send('rematch').ok,true);
  for(const s of sockets)s.send('ready',{ready:true});
  assert.equal(sockets[0].send('start').ok,true);
  assert.equal(sockets[0].state().code,code);
  assert.equal(sockets[0].state().phase,'turn_ready');
});

test('disconnect reserves seat, pauses contestant timer and rejects duplicate accounts',async()=>{
  const h=harness();const {sockets,code}=await open(h,3);
  assert.equal(ready(sockets[0]).ok,true);
  assert.equal(approve(sockets[1]).ok,true);
  const duplicate=await h.connect(0,'duplicate');
  assert.equal(duplicate.send('join',{code}).ok,false);
  assert.equal(duplicate.send('resume',{code}).ok,false);
  const sequence=sockets[0].state().sequence;
  sockets[0].disconnect();
  h.advance(59000);
  assert.equal(sockets[1].state().deadline,null);
  assert.equal(sockets[1].send('vote',{sequence,correct:true}).ok,false);
  assert.equal(duplicate.send('resume',{code}).ok,true);
  assert.equal(duplicate.state().sequence,sequence);
  assert.equal(duplicate.state().deadline-h.now(),60000);
  duplicate.disconnect();
  h.advance(60000);
  assert.equal(sockets[1].state().last.kind,'cancelled');
  assert.equal(sockets[1].state().host,'player1');
  assert.equal(duplicate.send('resume',{code}).ok,false);
});

test('lobby discovery, invite policy, membership-only audio, bounded bursts and moderation',async()=>{
  const h=harness();
  const [a,b,c]=await Promise.all([0,1,2].map(i=>h.connect(i)));
  const {code}=a.send('create',settings);
  assert.equal(c.send('list').rooms[0].code,code);
  assert.equal(h.backend.inviteOpen(code,'id0','id1'),true);
  assert.equal(b.send('join',{code}).ok,true);
  assert.equal(h.backend.inviteOpen(code,'id0','id1'),false);
  assert.equal(h.backend.chatRoom(code,'id2'),null);
  const desc={kind:'description',description:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}};
  assert.equal(a.send('signal',{to:'player2',...desc}).ok,false);
  assert.equal(a.send('signal',{to:'player1',...desc}).ok,true);
  assert.equal(b.messages('late:signal')[0].from,'player0');
  assert.equal(a.send('signal',{to:'player1',...desc,description:{type:'offer',sdp:'m=video 0'}}).ok,false);
  for(let i=0;i<36;i++)a.send('signal',{to:'player1',...desc});
  assert.equal(a.send('signal',{to:'player1',...desc}).ok,false);
  assert.equal(b.send('kick',{username:'player0'}).ok,false);
  assert.equal(a.send('kick',{username:'player1'}).ok,true);
  assert.equal(b.send('join',{code}).ok,false);
  h.backend.disconnectAccount('id0');
  assert.equal(c.send('list').rooms.length,0);
  assert.equal(signalPayload({to:'player1',kind:'candidate',candidate:{candidate:'x'.repeat(2049)}}),null);
  assert.equal(voiceConfig({}).hasTurn,false);
  assert.equal(voiceConfig({TURN_URL:'turn:server.local',TURN_USERNAME:'member',TURN_CREDENTIAL:'test'}).hasTurn,true);
});

test('ten Gece and Gölge appearances round-trip through wardrobe and the room portrait contract',()=>{
  const wardrobe=require('../wardrobe');
  const all=new Set();
  const required=['av_hair','av_eye','av_brow','av_expression','av_top','av_bottom','av_shoes'];
  for(const character of ['gece','golge']){
    const collection=wardrobe.collection(character);
    const owned=collection.items.map(item=>item.id);
    const optional=character==='gece'?['av_ear','av_wrist']:['av_ear','av_wrist','av_glasses','av_neck'];
    for(let i=0;i<5;i++){
      const items=Object.fromEntries([...required,...optional].map(slot=>{
        const choices=collection.items.filter(item=>item.slot===slot);
        return [slot,choices.length&&(required.includes(slot)||i%2!==0)?choices[i%choices.length].id:null];
      }));
      const draft={items,hairColor:collection.colors.hair[i%collection.colors.hair.length].key,
        eyeColor:collection.colors.eye[i%collection.colors.eye.length].key,expressionBrows:i%2===0};
      const record=JSON.parse(JSON.stringify(wardrobe.validate(character,draft,owned)));
      assert.equal(record.character,character);
      assert.equal(Object.keys(record.items).length,required.length+optional.length);
      all.add(JSON.stringify(record));
    }
  }
  assert.equal(all.size,10);
});

test('final recording retries and uses the same snapshot and match ID',async()=>{
  const h=harness({failOnce:true});const {sockets}=await open(h,3);
  for(const contestant of sockets){
    if(contestant.state().phase==='turn_ready')assert.equal(contestant.send('turn-ready',{sequence:contestant.state().sequence}).ok,true);
    h.advance(60000);
    assert.equal(contestant.state().phase,'summary');
    h.advance(4000);
  }
  await new Promise(setImmediate);
  assert.equal(sockets[0].state().savingError,true);
  assert.equal(sockets[0].send('rematch').ok,false);
  h.advance(5000);
  await new Promise(setImmediate);
  assert.equal(h.records.length,2);
  assert.deepEqual(h.records[0],h.records[1]);
  assert.equal(sockets[0].state().persisted,true);
});

test('only the next contestant can start the next round, and waiting does not reveal prompts',async()=>{
  const h=harness(),{sockets}=await open(h,3);
  assert.equal(ready(sockets[0]).ok,true);
  h.advance(60000);
  assert.equal(sockets[0].state().phase,'summary');
  h.advance(4000);
  const [first,next,other]=sockets;
  const state=next.state();
  assert.equal(state.phase,'turn_ready');
  assert.equal(state.contestant,'player1');
  assert.equal(state.deadline,null);
  assert.ok(sockets.every(s=>s.state().question===null&&s.state().answers===null));
  assert.equal(first.send('turn-ready',{sequence:state.sequence}).ok,false);
  assert.equal(next.send('turn-ready',{sequence:state.sequence-1}).ok,false);
  h.advance(30000);
  assert.equal(other.state().phase,'turn_ready');
  assert.equal(next.send('turn-ready',{sequence:state.sequence}).ok,true);
  assert.equal(next.send('turn-ready',{sequence:state.sequence}).ok,false);
  assert.equal(next.state().phase,'intro');
  assert.equal(next.state().deadline-h.now(),60000);
  assert.ok(next.state().question);
});
test('an expired next contestant is skipped while the room waits for the following one',async()=>{
  const h=harness(),{sockets}=await open(h,3);
  assert.equal(ready(sockets[0]).ok,true);
  h.advance(60000);
  h.advance(4000);
  sockets[1].disconnect();
  h.advance(60000);
  assert.equal(sockets[2].state().phase,'turn_ready');
  assert.equal(sockets[2].state().contestant,'player2');
  assert.equal(sockets[2].state().deadline,null);
});

test('party seats share one private lobby and can only be resumed by reserved accounts',async()=>{
 const h=harness(), members=[0,1,2].map(player);
 const url=h.backend.reserveParty(members);
 assert.match(url,/^\/late-answer\.html\?partyRoom=[A-Z2-9]{5}$/);
 const code=url.split('=').at(-1);
 const [host,first,second,outsider]=await Promise.all([0,1,2,3].map(i=>h.connect(i)));
 assert.equal(outsider.send('join',{code}).ok,false);
 assert.equal(outsider.send('resume',{code}).ok,false);
 assert.equal(host.send('resume',{code}).ok,true);
 assert.equal(host.send('settings',{...settings,visibility:'public'}).ok,false);
 assert.equal(host.send('start').ok,false);
 for(const s of [first,second])assert.equal(s.send('resume',{code}).ok,true);
 assert.equal(host.state().players.length,3);
 assert.equal(host.state().players.every(p=>p.online),true);
 assert.equal(h.backend.inviteOpen(code,'id0','id3'),false);
 for(const s of [host,first,second])assert.equal(s.send('ready',{ready:true}).ok,true);
 assert.equal(host.send('start').ok,true);
 h.backend.close();
});

test('revocation closes authenticated lobby sockets without closing a different session',async()=>{
 const h=harness();
 const first=await h.connect(0,'idle','revoked');
 const other=await h.connect(0,'other','active');
 const unrelated=await h.connect(1);
 h.backend.disconnectSession('revoked');
 assert.equal(first.closed,true);
 assert.equal(other.closed,undefined);
 assert.equal(unrelated.closed,undefined);
 assert.equal(other.send('create',settings).ok,true);
 h.backend.disconnectAccount('id0');
 assert.equal(other.closed,true);
 assert.equal(unrelated.closed,undefined);
 h.backend.close();
});

test('restores a paused round and reserves the same seats across process restart',async()=>{
 const before=harness();
 const {sockets,code}=await open(before,3);
 assert.equal(ready(sockets[0]).ok,true);
 assert.equal(approve(sockets[1]).ok,true);
 sockets[1].disconnect();
 assert.equal(sockets[0].state().pausedFor,'reader');
 const old=sockets[0].state();
 assert.equal(old.phase,'answer');
 const data=JSON.parse(JSON.stringify(before.backend.checkpoint()));
 assert.ok(data[0].players.every(p=>!Object.hasOwn(p,'session')&&!Object.hasOwn(p,'socketId')));
 before.backend.close();
 const after=harness();
 after.backend.restoreCheckpoint(data,before.now());
 const [first,second,third,outsider]=await Promise.all([0,1,2,3].map(i=>after.connect(i)));
 assert.equal(outsider.send('resume',{code}).ok,false);
 for(const socket of [second,third,first])assert.equal(socket.send('resume',{code}).ok,true);
 const restored=first.state();
 assert.equal(restored.code,code);assert.equal(restored.phase,old.phase);
 assert.equal(restored.sequence,old.sequence);assert.equal(restored.question,old.question);
 assert.equal(restored.players.every(p=>p.online),true);
 after.backend.close();
});
