'use strict';

const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
const sequence=(value,max)=>Number.isInteger(value)&&value>=0&&value<max;
const rotate=(cell,turns)=>{
 for(let i=0;i<turns;i++)cell=(cell%3)*3+2-Math.floor(cell/3);
 return cell;
};
const circuits=[
 {source:'A',targets:['D','F'],links:['AB','AC','BD','BE','CD','CF','EF']},
 {source:'B',targets:['D','F'],links:['AB','AC','BC','BD','CE','DF','EF']},
 {source:'C',targets:['A','F'],links:['AB','AC','BD','CE','DF','EF','BE']}
];
const routePatterns=[[0,1,4,7],[8,5,4,3],[2,1,4,5],[6,3,4,1],[0,3,6,7]];
function circuitDistance(puzzle,chosen){
 const connected=new Set([puzzle.source]);
 for(let pass=0;pass<puzzle.links.length;pass++){
  for(const index of chosen){
   const [a,b]=puzzle.links[index];
   if(connected.has(a)||connected.has(b)){connected.add(a);connected.add(b);}
  }
 }
 return puzzle.targets.filter(target=>connected.has(target)).length;
}
function efficientBudget(puzzle){
 let best=puzzle.links.length;
 for(let bits=1;bits<(1<<puzzle.links.length);bits++){
  const set=puzzle.links.map((_,index)=>index).filter(index=>bits&(1<<index));
  if(set.length<best&&circuitDistance(puzzle,set)===puzzle.targets.length)best=set.length;
 }
 return best;
}
function pairKey(ids){return ids.join(':');}
function orbitShot(angle,power){
 const radians=angle*Math.PI/18;
 const wind=power*1.2;
 const flightTime=2*wind*Math.sin(radians)/3;
 const range=wind*Math.cos(radians)*flightTime;
 const heightAt=distance=>{
  const time=distance/(wind*Math.cos(radians));
  return wind*Math.sin(radians)*time-1.5*time*time;
 };
 return {range,heightAt};
}
function pairs(players,random){
 const pool=[...players];
 for(let i=pool.length-1;i>0;i--){const j=random(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
 const result=new Map();
 for(let i=0;i<pool.length;i+=2){
  const [driver,operator]=pool.slice(i,i+2),key=pairKey([driver,operator]);
  result.set(driver,{key,partner:operator,role:'direction'});
  result.set(operator,{key,partner:driver,role:'speed'});
 }
 return result;
}
const extra={
 lock(random){
  return {duration:15_000,prompt:{period:4200,targets:Array.from({length:3},()=>20+random(61))}};
 },
 route(random){
  const path=routePatterns[random(routePatterns.length)],turns=1+random(3);
  return {duration:16_000,preview:4800,prompt:{path,turns,length:path.length},answer:path.map(cell=>rotate(cell,turns))};
 },
 rhythm(random){
  const beat=650+random(401);
  return {duration:7500,prompt:{beat,previewBeats:4}};
 },
 orbit(random){
  const strength=6+random(4),angle=3+random(4);
  const shot=orbitShot(angle,strength),wall=Math.round(shot.range/2);
  return {duration:17_000,prompt:{target:Math.round(shot.range),wall,height:Math.max(1,Math.floor(shot.heightAt(wall))-1)}};
 },
 circuit(random){
  const {source,targets,links}=circuits[random(circuits.length)];
  const puzzle={source,targets,links};
  return {duration:18_000,prompt:{...puzzle,budget:efficientBudget(puzzle)}};
 },
 'co-op'(random,players){
  return {duration:15_000,prompt:{direction:['Kuzey','Doğu','Güney','Batı'],speed:['Yavaş','Orta','Hızlı']},
    pairs:pairs(players,random),target:{direction:random(4),speed:random(3)}};
 },
 vault(random){
  const base=2+random(7),delta=2+random(5);
  const operator=random(2)===0?'+':'×';
  const answer=operator==='+'?base+delta:base*delta;
  const options=[answer,answer+1,answer-1,answer+delta];
  for(let i=options.length-1;i>0;i--){const j=random(i+1);[options[i],options[j]]=[options[j],options[i]];}
  return {duration:16_000,prompt:{base,delta,operator,options},answer};
 },
 move(random){
  const tiles=Array.from({length:6},(_,index)=>({name:['Ay','Elmas','Yıldız','Güneş','Dalga','Yaprak'][index],value:30+random(71)}));
  return {duration:13_000,prompt:{tiles},choices:new Map()};
 }
};

function extraPrompt(round,now,player){
 const prompt=round.prompt;
 switch(round.id){
  case 'route':
   return now<round.startsAt+round.preview?{path:prompt.path}:{turns:prompt.turns,length:prompt.length};
  case 'co-op':{
   const pair=round.pairs.get(player);
   if(!pair)return {};
   const clue=pair.role==='direction'?'speed':'direction';
   const received=round.actions.get(pair.partner)?.has('hint')?prompt[pair.role][round.target[pair.role]]:null;
   return {role:pair.role,options:prompt[pair.role],hint:prompt[clue][round.target[clue]],received};
  }
  case 'vault':{
   const risk=round.actions.get(player)?.has('risk');
   return risk?prompt:{decision:true};
  }
  default:return prompt;
 }
}
function extraAction(round,player,input,now,actions,oldScore){
 const elapsed=now-round.startsAt,p=round.prompt;
 switch(round.id){
  case 'lock':{
   const lock=Math.floor(elapsed/p.period);
   if(!sequence(lock,3)||input!==lock)return null;
   const phase=(elapsed%p.period)/p.period;
   const position=phase<.5?phase*200:(1-phase)*200;
   const tolerance=lock===0?18:18+Math.min(10,oldScore/8);
   return {key:lock,score:oldScore+Math.max(0,Math.round((lock===2?34:33)*(1-Math.abs(position-p.targets[lock])/tolerance)))};
  }
  case 'route':{
   if(elapsed<round.preview||!Array.isArray(input)||input.length!==p.length||!input.every(cell=>sequence(cell,9))||new Set(input).size!==input.length)return null;
   return {key:'answer',score:Math.round(100*input.filter((cell,index)=>cell===round.answer[index]).length/p.length)};
  }
  case 'rhythm':{
   if(!sequence(input,3)||input!==actions.size||elapsed<p.beat*p.previewBeats)return null;
   const expected=p.beat*(p.previewBeats+input+1),error=Math.abs(elapsed-expected);
   return {key:input,score:oldScore+Math.round((input===2?34:33)*clamp(1-error/(p.beat*.65),0,1))};
  }
  case 'orbit':{
   if(!Array.isArray(input)||input.length!==2||!sequence(input[0],10)||!sequence(input[1],11)||input[1]<1)return null;
   const shot=orbitShot(input[0],input[1]);
   const distance=Math.abs(shot.range-p.target);
   const score=shot.range>=p.wall&&shot.heightAt(p.wall)>=p.height?clamp(100-6*Math.round(distance),0,100):0;
   return {key:'answer',score};
  }
  case 'circuit':{
   if(!Array.isArray(input)||input.length>p.budget||new Set(input).size!==input.length||!input.every(i=>sequence(i,p.links.length)))return null;
   return {key:'answer',score:50*circuitDistance(p,input)};
  }
  case 'co-op':{
   const pair=round.pairs.get(player);
   if(!pair)return null;
   if(input==='hint')return {key:'hint',score:oldScore};
   if(!sequence(input,p[pair.role].length))return null;
   return {key:'answer',score:input===round.target[pair.role]?50:0};
  }
  case 'vault':
   if(input==='bank'&&!actions.size)return {key:'answer',score:55};
   if(input==='risk'&&!actions.size)return {key:'risk',score:0};
   if(actions.has('risk')&&p.options.includes(input))return {key:'answer',score:input===round.answer?100:0};
   return null;
  case 'move':
   if(!sequence(input,p.tiles.length)||actions.has('answer'))return null;
   round.choices.set(player,input);return {key:'answer',score:0};
  default:return null;
 }
}
function settleExtra(round,ids){
 if(round.id==='move'){
  for(const [player,choice] of round.choices){
   const duplicate=[...round.choices.values()].filter(value=>value===choice).length>1;
   if(ids.includes(player))round.scores.set(player,duplicate?0:round.prompt.tiles[choice].value);
  }
 }
 if(round.id==='co-op'){
  const scores=new Map(round.scores);
  for(const player of ids){
   const partner=round.pairs.get(player)?.partner;
   round.scores.set(player,(scores.get(player)||0)+(ids.includes(partner)?scores.get(partner)||0:0));
  }
 }
}

module.exports={extra,extraPrompt,extraAction,settleExtra};
