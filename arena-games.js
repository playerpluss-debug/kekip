'use strict';

const responseWindow=2000;

function openRound(now,random){
 const startsAt=now+2000;
 return {startsAt,flashAt:startsAt+500+random(4401),litAt:null,phase:'prepare',presses:new Map()};
}

function advanceRound(round,now){
 if(round.phase==='prepare'&&now>=round.startsAt){
  round.phase='waiting';
  return true;
 }
 if(round.phase==='waiting'&&now>=round.flashAt){
  round.phase='lit';
  round.litAt=now;
  return true;
 }
 return false;
}

function visibleRound(round,player){
 return {phase:round.phase,startsAt:round.startsAt,endsAt:round.litAt===null?null:round.litAt+responseWindow,
  press:round.presses.get(player)||null};
}

function registerPress(round,player,now){
 if(round.phase==='prepare'||round.presses.has(player))return null;
 if(round.litAt!==null&&now>=round.litAt+responseWindow)return null;
 const press=round.litAt===null?{kind:'early'}:{kind:'hit',ms:Math.max(0,now-round.litAt)};
 round.presses.set(player,press);
 return press;
}

function settleRound(round,players){
 const ranked=players.map(id=>round.presses.get(id)).filter(press=>press?.kind==='hit').map(press=>press.ms).sort((a,b)=>a-b);
 return new Map(players.map(id=>{
  const press=round.presses.get(id);
  if(!press)return [id,{kind:'miss',points:0}];
  return [id,{...press,points:press.kind==='hit'?100-12*ranked.indexOf(press.ms):0}];
 }));
}

module.exports={openRound,advanceRound,visibleRound,registerPress,settleRound,responseWindow};
