'use strict';

const {extra,extraPrompt,extraAction,settleExtra}=require('./arena-extra');
const catalog = Object.freeze([
  {id:'lock', title:'Kilit Hattı', category:'Zamanlama'},
  {id:'route', title:'Hayalet Rota', category:'Hafıza'},
  {id:'reaction', title:'Tepki Protokolü', category:'Refleks'},
  {id:'color', title:'Renk Şifresi', category:'Dikkat'},
  {id:'rhythm', title:'Nabız Dizisi', category:'Ritim'},
  {id:'missing', title:'Eksik Parça', category:'Gözlem'},
  {id:'orbit', title:'Yörünge Atışı', category:'Fizik'},
  {id:'circuit', title:'Devre Hattı', category:'Mantık'},
  {id:'words', title:'İpucu Zinciri', category:'Kelime'},
  {id:'co-op', title:'Çift Kumanda', category:'Takım', paired:true},
  {id:'vault', title:'Kasa Kararı', category:'Risk'},
  {id:'move', title:'Son Hamle', category:'Strateji'}
]);

const symbols=['Ay','Yıldız','Elmas','Güneş','Bulut','Yaprak','Dalga','Şimşek'];
const colors=['Mor','Altın','Turkuaz'];
const shapes=['Üçgen','Daire','Kare'];
const clues=[
  {clues:['Kabuğu var','Ağaçta yetişir','İçi beyne benzer'],answer:'Ceviz',wrong:['Fındık','Kestane','Badem']},
  {clues:['Karanlıkta kullanılır','Balmumundan yapılabilir','Fitili vardır'],answer:'Mum',wrong:['Fener','Meşale','Ampul']},
  {clues:['Haritada gösterilir','Su ile çevrilidir','Kıtadan küçüktür'],answer:'Ada',wrong:['Yarımada','Göl','Körfez']},
  {clues:['Yön buldurur','Kuzeyi gösterir','İğnesi döner'],answer:'Pusula',wrong:['Harita','Dürbün','Cetvel']},
  {clues:['Gökte oluşur','Yağmurdan sonra görülebilir','Birçok rengi vardır'],answer:'Gökkuşağı',wrong:['Yıldırım','Bulut','Kutup ışığı']},
  {clues:['Bir müzik aletidir','Tuşları vardır','İçindeki teller titreşir'],answer:'Piyano',wrong:['Keman','Flüt','Trompet']},
];

function shuffle(items,random){
  const result=[...items];
  for(let i=result.length-1;i>0;i--){
    const j=random(i+1);
    [result[i],result[j]]=[result[j],result[i]];
  }
  return result;
}

const games={
  ...extra,
  reaction(random){
    const target=symbols[random(symbols.length)];
    const other=shuffle(symbols.filter(symbol=>symbol!==target),random).slice(0,3);
    const frames=shuffle([target,target,...other],random);
    return {duration:9500,prompt:{target,frames,interval:1400,delay:1600},answer:target};
  },
  color(random){
    const rule=()=>({color:colors[random(colors.length)],shape:shapes[random(shapes.length)]});
    const rules=[rule(),rule()];
    if(rules[0].color===rules[1].color&&rules[0].shape===rules[1].shape){
      rules[1].shape=shapes[(shapes.indexOf(rules[0].shape)+1)%shapes.length];
    }
    const sets=rules.map(({color,shape})=>shuffle([{color,shape},{color,shape},...Array.from({length:6},()=>{
      const candidate=rule();
      if(candidate.color===color&&candidate.shape===shape)candidate.color=colors[(colors.indexOf(color)+1)%colors.length];
      return candidate;
    })],random));
    return {duration:16000,prompt:{rules,sets,interval:8000}};
  },
  missing(random){
    const shown=shuffle(symbols,random).slice(0,6);
    const answer=shown[random(shown.length)];
    return {duration:14000,preview:4200,prompt:{shown,remaining:shown.filter(symbol=>symbol!==answer),options:shuffle(symbols,random)},answer};
  },
  words(random){
    const clue=clues[random(clues.length)];
    return {duration:15000,prompt:{clues:clue.clues,options:shuffle([clue.answer,...clue.wrong],random)},answer:clue.answer};
  }
};

function playlist(selected,rounds,random,playerCount){
  const eligible=catalog.filter(game=>(!selected||selected.includes(game.id))&&
    (!game.paired||(playerCount>=4&&playerCount%2===0)));
  if(!eligible.length)throw Error('Çift Kumanda için 4, 6 veya 8 oyuncu gerekli. Oyuncu ekle veya başka bir listeyle yeni lobi kur.');
  const result=[];
  while(result.length<rounds){
    const cycle=shuffle(eligible,random);
    if(cycle.length>1&&result.at(-1)===cycle[0].id)cycle.push(cycle.shift());
    result.push(...cycle.map(game=>game.id));
  }
  return result.slice(0,rounds);
}

function openRound(id,now,random,players=[]){
  const challenge=games[id](random,players);
  const startsAt=now+2700;
  return {...challenge,id,startsAt,endsAt:startsAt+challenge.duration,scores:new Map(),actions:new Map()};
}

function visibleRound(round,now,player){
  const {id,startsAt,endsAt,prompt}=round;
  if(now<startsAt)return {id,startsAt,endsAt,prompt:null};
  if(Object.hasOwn(extra,id))return {id,startsAt,endsAt,prompt:extraPrompt(round,now,player)};
  if(id==='missing'){
    const {shown,remaining,options}=prompt;
    return {id,startsAt,endsAt,prompt:now<startsAt+round.preview?{shown}:{remaining,options}};
  }
  if(id==='reaction'){
    const {target,frames,delay,interval}=prompt;
    const index=Math.floor((now-startsAt-delay)/interval);
    return {id,startsAt,endsAt,prompt:{target,index,symbol:frames[index]||null}};
  }
  if(id==='words'){
    const count=Math.max(1,Math.min(3,1+Math.floor((now-startsAt)/3500)));
    return {id,startsAt,endsAt,prompt:{clues:prompt.clues.slice(0,count),options:prompt.options}};
  }
  const stage=now>=startsAt+prompt.interval?1:0;
  return {id,startsAt,endsAt,prompt:{stage,rule:prompt.rules[stage],tiles:prompt.sets[stage]}};
}

function scoreAction(round,player,input,now){
  if(now<round.startsAt||now>=round.endsAt)return false;
  const oldScore=round.scores.get(player)||0;
  const actions=round.actions.get(player)||new Set();
  let key,score;
  if(Object.hasOwn(extra,round.id)){
    const scored=extraAction(round,player,input,now,actions,oldScore);
    if(!scored)return false;
    ({key,score}=scored);
  }else if(round.id==='reaction'){
    const {frames,interval,delay}=round.prompt;
    const index=Math.floor((now-round.startsAt-delay)/interval);
    if(input!==index||index<0||index>=frames.length)return false;
    key=index;
    score=oldScore+(frames[index]===round.answer?50:-25);
  }else if(round.id==='color'){
    const stage=Math.floor((now-round.startsAt)/round.prompt.interval);
    if(!Number.isInteger(input)||input<stage*8||input>=stage*8+8)return false;
    key=input;
    const {color,shape}=round.prompt.rules[stage], tile=round.prompt.sets[stage][input%8];
    score=oldScore+(tile.color===color&&tile.shape===shape?25:-15);
  }else{
    if(round.id==='missing'&&now<round.startsAt+round.preview)return false;
    if(!round.prompt.options.includes(input))return false;
    key='answer';
    score=input===round.answer?100:0;
  }
  if(actions.has(key))return false;
  actions.add(key);
  round.actions.set(player,actions);
  round.scores.set(player,Math.min(100,score));
  return true;
}

module.exports={catalog,games,playlist,openRound,visibleRound,scoreAction,settleRound:settleExtra};
