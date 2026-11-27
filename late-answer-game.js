'use strict';

const { randomInt } = require('node:crypto');
const BANK = require('./late-answer-questions.json');
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const RESUME_MS = 60_000;
const TURN_MS = 60_000;
const SUMMARY_MS = 4_000;
const DEFAULT_SETTINGS = Object.freeze({visibility:'private'});

function validateSettings(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || !['public','private'].includes(value.visibility)) return null;
  return {visibility:value.visibility};
}

function drawQuestions(count, rng = randomInt, bank = BANK) {
  if (!Number.isInteger(count) || count < 1 || count > bank.length) throw new RangeError('Geçersiz soru sayısı');
  const pool = [...bank];
  for (let i = 0; i < count; i++) {
    const j = i + rng(pool.length - i);
    [pool[i],pool[j]]=[pool[j],pool[i]];
  }
  return pool.slice(0,count);
}

function createRoom(code,host,settings) {
  return {code,host:host.id,settings:{...settings},players:[host],phase:'lobby',ruleVersion:2,
    deadline:null,pausedRemaining:null,turn:-1,sequence:0,matchId:null,deck:[],cursor:0,
    order:[],questionIndex:null,expectedIndex:null,last:null,persisted:false};
}

function canStart(room) {
  return room.phase==='lobby'&&room.players.length>=MIN_PLAYERS&&room.players.length<=MAX_PLAYERS&&
    room.players.every(player=>player.online&&player.ready);
}
function start(room,now,matchId,rng) {
  if(!canStart(room))return false;
  room.matchId=matchId;room.order=room.players.map(player=>player.id);
  room.deck=drawQuestions(BANK.length,rng);room.cursor=0;
  for(const player of room.players)Object.assign(player,{score:0,correct:0,juryAgreed:0,completed:false,left:false});
  room.turn=-1;nextTurn(room);return true;
}

function contestant(room){
  return room.players.find(player=>player.id===room.order[room.turn]&&!player.left);
}
function reader(room){
  if(room.turn<0||room.turn>=room.order.length)return;
  for(let offset=1;offset<room.order.length;offset++){
    const nextId=room.order[(room.turn+offset)%room.order.length];
    const next=room.players.find(player=>player.id===nextId&&!player.left);
    if(next)return next;
  }
}
function nextTurn(room){
  do{room.turn++;}while(room.turn<room.order.length&&!contestant(room));
  room.sequence++;room.deadline=null;room.pausedRemaining=null;room.last=null;
  room.questionIndex=null;room.expectedIndex=null;
  room.phase=room.turn<room.order.length?'turn_ready':'final';
}
function nextQuestion(room){
  const index=room.cursor%room.deck.length;
  room.cursor++;
  return index;
}
function readyTurn(room,playerId,sequence,now){
  const player=contestant(room);
  if(room.phase!=='turn_ready'||!player?.online||player.id!==playerId||sequence!==room.sequence||!reader(room))return false;
  room.turnStart=new Map(room.players.map(p=>[p.id,{score:p.score,correct:p.correct,juryAgreed:p.juryAgreed}]));
  room.phase='intro';room.questionIndex=nextQuestion(room);
  room.expectedIndex=null;room.sequence++;room.deadline=now+TURN_MS;
  return true;
}
function advance(room,now){
  if(room.deadline===null||now<room.deadline)return false;
  if(['intro','answer'].includes(room.phase)){
    const player=contestant(room);
    if(player)player.completed=true;
    room.phase='summary';room.deadline=now+SUMMARY_MS;
    room.last={kind:'turn',correct:player?.correct||0};
    return true;
  }
  if(room.phase==='summary'){nextTurn(room);return true;}
  return false;
}
function vote(room,playerId,input,now){
  const activeReader=reader(room);
  if(!['intro','answer'].includes(room.phase)||room.deadline===null||now>=room.deadline||
     activeReader?.id!==playerId||!activeReader.online||!input||typeof input.correct!=='boolean'||
     input.sequence!==room.sequence||(room.phase==='intro'&&!input.correct))return false;
  if(room.phase==='answer'){
    if(input.correct)contestant(room).correct++;
    room.last={kind:'answer',correct:input.correct};
  }
  room.expectedIndex=room.questionIndex;
  room.questionIndex=nextQuestion(room);
  room.phase='answer';room.sequence++;
  return true;
}

function removePlayer(room,id,now){
  const player=room.players.find(p=>p.id===id&&!p.left);
  if(!player)return false;
  const wasContestant=contestant(room)===player;
  player.online=false;
  if(room.phase==='lobby'||room.phase==='final')room.players=room.players.filter(p=>p.id!==id);
  else{
    player.left=true;
    if(wasContestant&&['intro','answer'].includes(room.phase)){
      for(const p of room.players){const before=room.turnStart?.get(p.id);if(before)Object.assign(p,before);}
      room.last={kind:'cancelled'};room.phase='summary';room.deadline=now+SUMMARY_MS;
    }else if(wasContestant&&room.phase==='turn_ready')nextTurn(room);
    if(room.players.filter(p=>!p.left).length<2){room.phase='final';room.deadline=null;}
  }
  if(room.host===id)room.host=(room.players.find(p=>!p.left&&p.online)||room.players.find(p=>!p.left))?.id??null;
  return true;
}

function rows(room){
  const completed=room.players.filter(p=>!p.left&&p.completed).sort((a,b)=>b.correct-a.correct);
  return room.players.map(p=>{
    const complete=!p.left&&!!p.completed;
    const rank=complete?completed.findIndex(other=>other.correct===p.correct)+1:null;
    const points=rank===null?0:completed.length-rank+1;
    return {accountId:p.id,result:{complete,forfeited:!!p.left,win:completed.length>=2&&rank===1,
      rank,scoreHalf:points*2,correct:p.correct||0,juryAgreed:0}};
  });
}

function migrateCheckpoint(room,rng){
  if(room.ruleVersion===2)return;
  room.ruleVersion=2;room.settings=validateSettings(room.settings)||{...DEFAULT_SETTINGS};
  room.deck=drawQuestions(BANK.length,rng);room.cursor=0;room.questionIndex=null;room.expectedIndex=null;
  if(['intro','answer'].includes(room.phase)){
    const player=contestant(room),before=room.turnStart?.get(player?.id);
    if(player)player.correct=before?.correct||0;
    room.phase='turn_ready';room.deadline=null;room.pausedRemaining=null;room.sequence++;room.last=null;
  }
}

function snapshot(room,id,now){
  const player=contestant(room),activeReader=reader(room);
  const me=room.players.find(p=>p.id===id&&!p.left);
  const playing=['intro','answer'].includes(room.phase);
  const question=playing&&room.questionIndex!==null?room.deck[room.questionIndex]:null;
  const expected=room.phase==='answer'&&activeReader?.id===id?room.deck[room.expectedIndex]:null;
  const final=room.phase==='final'?new Map((room.finalRows||rows(room)).map(row=>[row.accountId,row.result])):null;
  return {code:room.code,settings:room.settings,phase:room.phase,now,deadline:room.deadline,
    me:me?.username,host:room.players.find(p=>p.id===room.host)?.username,
    contestant:player?.username??null,reader:activeReader?.username??null,turn:Math.min(room.turn+1,room.order.length),turns:room.order.length,
    sequence:room.sequence,question:question?.question??null,category:question?.category??null,
    answers:expected?.answers??null,
    pausedFor:playing&&!room.deadline?(!player?.online?'contestant':'reader'):null,
    last:room.last,persisted:room.persisted,savingError:!!room.savingError,
    players:room.players.map(p=>{
      const result=final?.get(p.id);
      return {username:p.username,score:result?(result.scoreHalf||0)/2:0,correct:result?.correct??p.correct??0,
        rank:result?.rank??null,online:p.online,ready:p.ready,left:!!p.left,microphone:!!p.microphone,
        win:result?.win??false,complete:result?.complete??false};
    })};
}
module.exports={MIN_PLAYERS,MAX_PLAYERS,RESUME_MS,TURN_MS,DEFAULT_SETTINGS,validateSettings,drawQuestions,
  createRoom,canStart,start,readyTurn,advance,vote,removePlayer,snapshot,rows,reader,migrateCheckpoint};