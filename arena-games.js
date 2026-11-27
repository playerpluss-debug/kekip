'use strict';

const responseWindow=2000;
const choiceWindow=4000;
const lengthPreview=2200;
const cupsPreview=1250;
const cupsCover=360;
const timingWindow=10000;
const gameOptions=Object.freeze([
 {id:'reflex',title:'Refleks Testi'},
 {id:'color',title:'Renk Farkı'},
 {id:'length',title:'Hedef Boyu'},
 {id:'cups',title:'Bardak Altında'},
 {id:'timing',title:'Tam Zamanında'}
]);
const gameModes=gameOptions.map(game=>game.id);
function shuffle(values,random){
 const result=[...values];
 for(let i=result.length-1;i>0;i--){
  const j=random(i+1);
  [result[i],result[j]]=[result[j],result[i]];
 }
 return result;
}
function buildPlaylist(games,rounds,random){
 const shuffled=shuffle(games,random);
 return shuffle(Array.from({length:rounds},(_,index)=>shuffled[index%shuffled.length]),random);
}
const nearColors=[
 [8,69,54,4,0], [43,79,53,0,3], [91,52,45,5,0],
 [150,50,46,0,3], [181,57,46,5,0], [216,67,56,0,3],
 [258,57,57,5,0], [296,51,55,0,3], [330,62,54,5,0]
];
const hsl=(h,s,l)=>'hsl('+h+' '+s+'% '+l+'%)';
function cupSwaps(ballSlot,random){
 const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
 const trackedMoves=new Set(shuffle([0,1,2,3,4,5],random).slice(0,3));
 const durations=shuffle([416,417,417].flatMap(base=>{
  const variation=random(31);
  return [base-variation,base+variation];
 }),random);
 const swaps=[];
 let position=ballSlot,previous=null;
 for(let i=0;i<6;i++){
  const options=pairs.filter(pair=>pair!==previous&&(!trackedMoves.has(i)||pair.includes(position)));
  const pair=options[random(options.length)],direction=random(2)?1:-1;
  swaps.push({from:pair[0],to:pair[1],duration:durations[i],direction});
  if(pair[0]===position)position=pair[1];
  else if(pair[1]===position)position=pair[0];
  previous=pair;
 }
 return {swaps,position};
}
function openRound(now,random,game='reflex'){
 const startsAt=now+2000;
 const round={game,startsAt,flashAt:null,litAt:null,phase:'prepare',presses:new Map(),
  responseWindow:game==='reflex'?responseWindow:game==='timing'?timingWindow:choiceWindow};
 if(game==='color'){
  const [h,s,l,dh,dl]=nearColors[random(nearColors.length)],direction=random(2)?1:-1;
  const base=hsl(h,s,l),odd=hsl(h+dh*direction,s,l+dl*direction);
  round.odd=random(3);
  round.colors=Array.from({length:3},(_,index)=>index===round.odd?odd:base);
 }else if(game==='length'){
  round.target=48+random(25);
  const direction=random(2)?1:-1;
  round.lengths=shuffle([-7,-4,0,3,6,9].map(offset=>round.target+direction*offset),random);
  round.odd=round.lengths.indexOf(round.target);
 }else if(game==='cups'){
  round.ballSlot=random(4);
  const {swaps,position}=cupSwaps(round.ballSlot,random);
  round.swaps=swaps;
  round.odd=position;
 }else if(game==='timing')round.targetMs=3000+random(501)*10;
 else round.flashAt=startsAt+500+random(4401);
 return round;
}

function advanceRound(round,now){
 if(round.phase==='prepare'&&now>=round.startsAt&&['length','cups','timing'].includes(round.game)){
  round.phase='preview';round.previewEndsAt=now+(round.game==='cups'?cupsPreview:lengthPreview);
  return true;
 }
 if(round.phase==='preview'&&now>=round.previewEndsAt&&round.game==='cups'){
  round.phase='mix';round.coverStartsAt=now;round.mixStartsAt=now+cupsCover;
  round.mixEndsAt=round.mixStartsAt+round.swaps.reduce((total,swap)=>total+swap.duration,0)+180;
  return true;
 }
 if(round.phase==='mix'&&now>=round.mixEndsAt){round.phase='lit';round.litAt=now;return true;}
 if(round.phase==='preview'&&now>=round.previewEndsAt){
  round.phase='lit';round.litAt=now;
  return true;
 }
 if(round.phase==='prepare'&&now>=round.startsAt){
  round.phase=round.game==='color'?'lit':'waiting';
  if(round.game==='color')round.litAt=now;
  return true;
 }
 if(round.phase==='waiting'&&now>=round.flashAt){
  round.phase='lit';
  round.litAt=now;
  return true;
 }
 return false;
}

function visiblePress(round,press){
 if(!press)return null;
 if(round.game==='reflex'||round.game==='timing')return press;
 return {kind:'answer',choice:press.choice,
  ...(round.game==='length'&&press.kind==='wrong'?{wrong:true}:{})};
}
function visibleRound(round,player){
 return {game:round.game,phase:round.phase,startsAt:round.startsAt,
  endsAt:round.litAt===null?null:round.litAt+round.responseWindow,
  press:visiblePress(round,round.presses.get(player)),
  ...(round.game==='color'&&round.phase==='lit'?{colors:round.colors}:{}),
  ...(round.game==='length'&&round.phase==='preview'?{target:round.target,previewEndsAt:round.previewEndsAt}:{}),
  ...(round.game==='length'&&round.phase==='lit'?{lengths:round.lengths}:{}),
  ...(round.game==='cups'&&round.phase==='preview'?{ballSlot:round.ballSlot}:{}),
  ...(round.game==='cups'&&round.phase==='mix'?{ballSlot:round.ballSlot,swaps:round.swaps,coverStartsAt:round.coverStartsAt,mixStartsAt:round.mixStartsAt}:{}),
  ...(round.game==='timing'&&['preview','lit'].includes(round.phase)?{targetMs:round.targetMs,previewEndsAt:round.previewEndsAt,startedAt:round.litAt}:{})};
}

function registerPress(round,player,now,choice){
 if(round.presses.has(player)||(round.phase!=='lit'&&(round.game!=='reflex'||round.phase!=='waiting')))return null;
 if(round.litAt!==null&&now>=round.litAt+round.responseWindow)return null;
 const optionCount=round.game==='length'?round.lengths.length:round.game==='cups'?4:3;
 if(!['reflex','timing'].includes(round.game)&&(!Number.isInteger(choice)||choice<0||choice>=optionCount))return null;
 const ms=round.litAt===null?null:Math.max(0,now-round.litAt);
 const press=round.game==='timing'?{kind:'hit',ms,errorMs:Math.abs(ms-round.targetMs)}:
  round.game!=='reflex'?{kind:choice===round.odd?'hit':'wrong',ms,choice}:
  ms===null?{kind:'early'}:{kind:'hit',ms};
 round.presses.set(player,press);
 return visiblePress(round,press);
}
function settleRound(round,players){
 const metric=press=>round.game==='timing'?press.errorMs:press.ms;
 const ranked=players.map(id=>round.presses.get(id)).filter(press=>press?.kind==='hit').map(metric).sort((a,b)=>a-b);
 return new Map(players.map(id=>{
  const press=round.presses.get(id);
  if(!press)return [id,{kind:'miss',points:0}];
  return [id,{...press,points:press.kind==='hit'?100-12*ranked.indexOf(metric(press)):0}];
 }));
}
module.exports={gameOptions,gameModes,buildPlaylist,openRound,advanceRound,visibleRound,registerPress,settleRound,responseWindow};
