'use strict';

const responseWindow=2000;
const colorWindow=4000;
const gameOptions=Object.freeze([
 {id:'reflex',title:'Refleks Testi'},
 {id:'color',title:'Renk Farkı'}
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
function openRound(now,random,game='reflex'){
 const startsAt=now+2000;
 const round={game,startsAt,flashAt:null,litAt:null,phase:'prepare',presses:new Map(),
  responseWindow:game==='color'?colorWindow:responseWindow};
 if(game==='color'){
  const [h,s,l,dh,dl]=nearColors[random(nearColors.length)],direction=random(2)?1:-1;
  const base=hsl(h,s,l),odd=hsl(h+dh*direction,s,l+dl*direction);
  round.odd=random(3);
  round.colors=Array.from({length:3},(_,index)=>index===round.odd?odd:base);
 }else round.flashAt=startsAt+500+random(4401);
 return round;
}

function advanceRound(round,now){
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
 return round.game==='color'?{kind:'answer',choice:press.choice}:press;
}
function visibleRound(round,player){
 return {game:round.game,phase:round.phase,startsAt:round.startsAt,
  endsAt:round.litAt===null?null:round.litAt+round.responseWindow,
  press:visiblePress(round,round.presses.get(player)),
  ...(round.game==='color'&&round.phase==='lit'?{colors:round.colors}:{})};
}

function registerPress(round,player,now,choice){
 if(round.phase==='prepare'||round.presses.has(player))return null;
 if(round.litAt!==null&&now>=round.litAt+round.responseWindow)return null;
 if(round.game==='color'&&(!Number.isInteger(choice)||choice<0||choice>2))return null;
 const ms=round.litAt===null?null:Math.max(0,now-round.litAt);
 const press=round.game==='color'?{kind:choice===round.odd?'hit':'wrong',ms,choice}:
  ms===null?{kind:'early'}:{kind:'hit',ms};
 round.presses.set(player,press);
 return visiblePress(round,press);
}
function settleRound(round,players){
 const ranked=players.map(id=>round.presses.get(id)).filter(press=>press?.kind==='hit').map(press=>press.ms).sort((a,b)=>a-b);
 return new Map(players.map(id=>{
  const press=round.presses.get(id);
  if(!press)return [id,{kind:'miss',points:0}];
  return [id,{...press,points:press.kind==='hit'?100-12*ranked.indexOf(press.ms):0}];
 }));
}
module.exports={gameOptions,gameModes,buildPlaylist,openRound,advanceRound,visibleRound,registerPress,settleRound,responseWindow};
