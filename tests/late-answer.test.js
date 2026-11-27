'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const game = require('../late-answer-game');
const {attachLateAnswer,voiceConfig,signalPayload}=require('../late-answer');
const bank=require('../late-answer-questions.json');
const settings={questions:5,seconds:7,visibility:'public'};
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
  assert.equal(game.validateSettings({...settings,seconds:6}),null);
  assert.deepEqual(game.validateSettings(settings),settings);
  assert.throws(()=>game.drawQuestions(bank.length+1),RangeError);
});

test('first prompt, delayed answers, no answer leak, final answer and timeout',()=>{
  const r=room();
  assert.equal(r.phase,'intro');
  assert.equal(game.snapshot(r,'id1',0).answers,null);
  assert.equal(game.snapshot(r,'id0',0).question,bank[0].question);
  assert.equal(game.advance(r,r.deadline-1),false);
  game.advance(r,r.deadline);
  assert.equal(game.snapshot(r,'id0',r.deadline).question,bank[1].question);
  assert.equal(game.snapshot(r,'id0',r.deadline).answers,null);
  assert.equal(game.snapshot(r,'outsider',r.deadline).answers,null);
  assert.deepEqual(game.snapshot(r,'id1',r.deadline).answers,bank[0].answers);
  assert.equal(choose(r,'id0',true),false);
  assert.equal(choose(r,'id1',true,r.deadline),false);
  assert.equal(game.vote(r,'id1',{sequence:r.sequence-1,correct:true},r.deadline-1),false);
  assert.equal(game.vote(r,'id1',{sequence:r.sequence,correct:'true'},r.deadline-1),false);
  assert.ok(choose(r,'id1',true));
  assert.equal(choose(r,'id1',false),false);
  assert.ok(choose(r,'id2',false));
  assert.equal(r.last.correct,true);
  assert.deepEqual(r.players.map(p=>p.score),[2,1,0]);
  while(r.step<5)game.advance(r,r.deadline);
  assert.equal(game.snapshot(r,'id0',r.deadline).question,null);
  assert.deepEqual(game.snapshot(r,'id1',r.deadline).answers,bank[4].answers);
  game.advance(r,r.deadline);
  assert.equal(r.phase,'summary');
  assert.equal(r.last.correct,false);
  assert.equal(r.last.votes,0);
});

test('majority and cancelled turn restore only the unfinished round',()=>{
  const r=room(4);
  game.advance(r,r.deadline);
  choose(r,'id1',true);choose(r,'id2',false);choose(r,'id3',false);
  assert.deepEqual(r.players.map(p=>p.score),[0,0,1,1]);
  choose(r,'id1',true);choose(r,'id2',true);
  assert.equal(game.removePlayer(r,'id0',r.deadline-1),true);
  assert.equal(r.phase,'summary');assert.equal(r.last.kind,'cancelled');
  assert.deepEqual(r.players.map(p=>p.score),[0,0,0,0]);
  assert.deepEqual(game.rows(r)[0].result,{complete:false,forfeited:true,win:false,scoreHalf:0,correct:0,juryAgreed:0});
  assert.equal(r.host,'id1');
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

for(const count of [3,8])test('complete '+count+' player match on fake sockets',async()=>{
  const h=harness(),opts={...settings,questions:count===8?10:5};const {sockets,code}=await open(h,count,opts);
  const seen=new Set();
  for(const contestant of sockets){
    if(contestant.state().phase==='turn_ready')assert.equal(contestant.send('turn-ready',{sequence:contestant.state().sequence}).ok,true);
    assert.equal(contestant.state().phase,'intro');
    seen.add(contestant.state().question);
    h.advance(3000);
    for(let q=1;q<=opts.questions;q++){
      const st=contestant.state();
      assert.equal(st.phase,'answer');assert.equal(st.answers,null);
      if(st.question)seen.add(st.question);
      assert.equal(contestant.send('vote',{sequence:st.sequence,correct:true}).ok,false);
      h.advance(100);
      for(const judge of sockets.filter(s=>s!==contestant)){
        assert.ok(judge.state().answers.length>=2);
        assert.equal(judge.send('vote',{sequence:st.sequence,correct:true}).ok,true);
      }
    }
    assert.equal(contestant.state().phase,'summary');
    h.advance(4000);
  }
  assert.equal(seen.size,count*opts.questions);
  assert.equal(sockets[0].state().phase,'final');
  await new Promise(setImmediate);
  assert.equal(h.records.length,1);
  const [name,,result,tx,cardDrops]=h.records[0];
  assert.equal(name,'late_answer');assert.equal(tx,null);assert.equal(cardDrops,true);
  assert.ok(result.every(r=>r.result.complete&&r.result.correct===opts.questions&&r.result.win));
  assert.ok(sockets.every(s=>s.messages('late:recorded').length===1));
  assert.equal(h.backend.inviteOpen(code,'id0','unknown'),false);
  assert.equal(sockets[0].send('rematch').ok,true);
  for(const s of sockets)s.send('ready',{ready:true});
  assert.equal(sockets[0].send('start').ok,true);
  if(count===8)assert.notEqual(sockets[0].state().code,code);
  else assert.equal(seen.has(sockets[0].state().question),false);
});

test('disconnect reserves seat, pauses contestant timer and rejects duplicate accounts',async()=>{
  const h=harness();const {sockets,code}=await open(h,3);
  h.advance(3000);
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
  assert.equal(duplicate.state().deadline-h.now(),7000);
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
    h.advance(3000);
    for(let i=0;i<settings.questions;i++)h.advance(7000);
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
  h.advance(3000);
  for(let i=0;i<settings.questions;i++)h.advance(7000);
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
  assert.equal(next.state().deadline-h.now(),3000);
  assert.ok(next.state().question);
});
test('an expired next contestant is skipped while the room waits for the following one',async()=>{
  const h=harness(),{sockets}=await open(h,3);
  h.advance(3000);
  for(let i=0;i<settings.questions;i++)h.advance(7000);
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
