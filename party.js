'use strict';

const {randomUUID}=require('node:crypto');
const games=Object.freeze({
  battleship:{min:2,max:2},
  football:{min:2,max:8},
  late_answer:{min:3,max:8},
  arena:{min:2,max:8}
});
const usernamePattern=/^[a-z0-9_]{3,24}$/;
const idPattern=/^[0-9a-f-]{36}$/;
const onlineFor=22000, inviteFor=300000, idleFor=4*60*60*1000, resumeFor=60000;

function fail(message,status=409){throw Object.assign(new Error(message),{status});}

function createPartyService(adapters,{now=Date.now,id=randomUUID}={}){
 const groups=new Set(), byAccount=new Map(), invitations=new Map(), lastInvite=new Map();

 function leave(accountId){
  const party=byAccount.get(accountId);
  if(!party)return;
  byAccount.delete(accountId);party.members.delete(accountId);
  if(!party.members.size){groups.delete(party);return;}
  if(party.leader===accountId){
   party.leader=party.members.keys().next().value;
   for(const [key,invite] of invitations)if(invite.party===party)invitations.delete(key);
  }
  for(const member of party.members.values())member.ready=false;
 }

 function sweep(t){
  for(const [key,v] of invitations)if(v.expires<=t||!groups.has(v.party))invitations.delete(key);
  for(const [account,at] of lastInvite)if(t-at>inviteFor)lastInvite.delete(account);
  for(const party of groups){
   if(!party.busy&&party.touched+idleFor<=t){
    for(const accountId of party.members.keys())byAccount.delete(accountId);
    groups.delete(party);
   }else{
    if(party.launch?.expires<=t)party.launch=null;
    for(const member of party.members.values())if(member.seen+onlineFor<=t)member.ready=false;
   }
  }
 }

 function add(party,account,t){
  party.members.set(account.id,{id:account.id,username:account.username,seen:t,joined:t,ready:false,lastMessage:-Infinity});
  byAccount.set(account.id,party);party.touched=t;
  for(const member of party.members.values())member.ready=false;
 }
 function leader(party,a){if(party.leader!==a.id)fail('Bu işlemi yalnızca parti lideri yapabilir.',403);}
 function get(party){if(!party)fail('Bir partiye katılmalısın.');if(party.busy)fail('Parti oyuna geçiyor.');return party;}
 function memberView(party,account,t){
  const self=party.members.get(account.id);
  return {leader:party.members.get(party.leader).username,ready:self.ready,busy:party.busy,
   members:[...party.members.values()].map(m=>({username:m.username,online:m.seen+onlineFor>t,ready:m.ready})),
   messages:party.messages.filter(m=>m.at>=self.joined),launch:party.launch?.recipients.has(account.id)?party.launch.route:null};
 }
 function view(account,t){
  const party=byAccount.get(account.id);
  const invites=[...invitations.values()].filter(v=>v.to===account.id&&v.expires>t&&groups.has(v.party))
   .map(v=>({id:v.id,leader:v.fromName,expires:v.expires}));
  return {username:account.username,party:party?memberView(party,account,t):null,invites};
 }
 async function friend(db,from,username){
  const q=await db.query(`SELECT u.id,u.username FROM kekip_football_accounts u
    JOIN kekip_friendships f ON f.low_id=LEAST(u.id,$1) AND f.high_id=GREATEST(u.id,$1) AND f.status='accepted'
    WHERE u.username=$2 AND u.blocked_at IS NULL`,[from,username]);
  if(!q.rows.length)fail('Yalnızca arkadaşlarına parti daveti gönderebilirsin.',403);
  return q.rows[0];
 }
 async function friends(db,a){
  const q=await db.query(`SELECT u.username FROM kekip_friendships f JOIN kekip_football_accounts u
    ON u.id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END
    WHERE (f.low_id=$1 OR f.high_id=$1) AND f.status='accepted' AND u.blocked_at IS NULL ORDER BY u.username`,[a.id]);
  return q.rows.map(r=>r.username);
 }
 async function run(db,a,action,b={}){
  const t=now();sweep(t);
  let party=byAccount.get(a.id);
  if(party){party.members.get(a.id).seen=t;party.touched=t;}
  if(action==='state')return view(a,t);
  if(action==='friends')return {friends:await friends(db,a)};
  if(b.username!==a.username)fail('Hesap değişti. Sayfayı yenile.');
  if(action==='create'){
   if(!party){
    if(groups.size>=300)fail('Şu anda yeni parti açılamıyor.',503);
    party={voiceId:randomUUID(),leader:a.id,members:new Map(),messages:[],touched:t,busy:false,launch:null};
    groups.add(party);add(party,a,t);
   }
  }else if(action==='invite'){
   get(party);leader(party,a);
   if(typeof b.target!=='string'||!usernamePattern.test(b.target)||b.target===a.username)fail('Davet bilgisi geçersiz.',400);
   if(party.members.size>=8)fail('Parti dolu.');
   if(t-(lastInvite.get(a.id)??-Infinity)<1200)fail('Biraz bekleyip tekrar dene.',429);
   lastInvite.set(a.id,t);
   const target=await friend(db,a.id,b.target);
   if(byAccount.get(a.id)!==party)fail('Parti değişti.');
   get(party);leader(party,a);
   if(byAccount.has(target.id))fail('Bu oyuncu zaten bir partide.');
   if(![...invitations.values()].some(v=>v.party===party&&v.to===target.id)){
    if([...invitations.values()].filter(v=>v.party===party||v.to===target.id).length>=12)fail('Bekleyen davet sınırı doldu.',429);
    const key=id();
    invitations.set(key,{id:key,party,to:target.id,from:a.id,fromName:a.username,expires:now()+inviteFor});
   }
  }else if(action==='accept'||action==='decline'){
   if(typeof b.id!=='string'||!idPattern.test(b.id))fail('Davet geçersiz.',400);
   const invite=invitations.get(b.id);
   if(!invite||invite.to!==a.id||invite.expires<=t||!groups.has(invite.party))fail('Davet artık geçerli değil.');
   if(action==='accept'){
    if(party)fail('Önce mevcut partinden ayrıl.');
    const sender=await friend(db,a.id,invite.fromName);
    if(sender.id!==invite.from||invitations.get(b.id)!==invite||invite.expires<=now()||
       !groups.has(invite.party)||invite.party.leader!==invite.from)fail('Davet artık geçerli değil.');
    if(byAccount.has(a.id))fail('Önce mevcut partinden ayrıl.');
    party=get(invite.party);
    if(party.members.size>=8)fail('Parti dolu.');
    add(party,a,now());
    for(const [key,v] of invitations)if(v.to===a.id)invitations.delete(key);
   }else invitations.delete(b.id);
  }else{
   get(party);
   const member=party.members.get(a.id);
   if(action==='leave')leave(a.id);
   else if(action==='ready'){
    if(typeof b.ready!=='boolean')fail('Hazır durumu geçersiz.',400);
    member.ready=b.ready;
   }else if(action==='leader'){
    leader(party,a);
    const next=[...party.members.values()].find(m=>m.username===b.target&&m.id!==a.id);
    if(!next)fail('Parti üyesi bulunamadı.',404);
    party.leader=next.id;
    for(const [key,v] of invitations)if(v.party===party)invitations.delete(key);
   }else if(action==='chat'){
    const body=typeof b.text==='string'?b.text.trim():'';
    if(!body||body.length>240||/[\u0000-\u001f\u007f]/.test(body))fail('Mesaj 1–240 karakter olmalı.',400);
    if(t-member.lastMessage<1000)fail('Biraz bekleyip tekrar dene.',429);
    member.lastMessage=t;
    party.messages.push({id:id(),username:a.username,text:body,at:t});
    if(party.messages.length>60)party.messages.shift();
   }else if(action==='launch'){
    leader(party,a);
    const game=typeof b.game==='string'&&Object.hasOwn(games,b.game)?b.game:null;
    if(!game||typeof adapters[game]!=='function')fail('Oyun geçersiz.',400);
    const {min,max}=games[game],members=[...party.members.values()];
    if(members.length<min||members.length>max)fail('Bu oyun için '+(min===max?min:min+'–'+max)+' oyuncu gerekiyor.');
    if(members.some(m=>!m.ready||m.seen+onlineFor<=t))fail('Tüm parti üyeleri çevrimiçi ve hazır olmalı.');
    if(party.launch&&party.launch.started+10000>t)fail('Önce mevcut geçişin tamamlanmasını bekle.');
    party.busy=true;
    const stable=()=>groups.has(party)&&party.leader===a.id&&party.members.size===members.length&&members.every(m=>party.members.get(m.id)===m&&m.seen+onlineFor>now());
    try{
     const checked=await db.query('SELECT id FROM kekip_football_accounts WHERE id=ANY($1::text[]) AND blocked_at IS NULL',[members.map(m=>m.id)]);
     if(checked.rows.length!==members.length||!stable())fail('Parti değişti. Herkes hazır olduğunda tekrar dene.');
     const ordered=[member,...members.filter(m=>m!==member)].map(({id,username})=>({id,username}));
     const url=await adapters[game](db,ordered,stable);
     const started=now();
     party.launch={route:{id:id(),game,url},recipients:new Set(ordered.map(m=>m.id)),started,expires:started+resumeFor};
     for(const item of members)item.ready=false;
    }finally{party.busy=false;}
   }else fail('Parti işlemi bulunamadı.',404);
  }
  return view(a,now());
 }
 function voiceRoom(accountId){
  const t=now();
  sweep(t);
  const party=byAccount.get(accountId);
  const member=party?.members.get(accountId);
  return member&&member.seen+onlineFor>t?party.voiceId:null;
 }
 return {run,removeAccount:leave,voiceRoom};
}

function attachParty(app,accounts,adapters){
 const service=createPartyService(adapters);
 const json=require('express').json({limit:'3kb'});
 app.post('/api/party/:action',json,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   accounts.safeRequest(req);
   const db=await accounts.database(),account=await accounts.requireAccount(db,req);
   return res.json(await service.run(db,account,req.params.action,req.body||{}));
  }catch(e){
   if(!e.status)console.error('KEKIP Parti:',e.code||e.message);
   return res.status(e.status||503).json({error:e.status?e.message:'Parti sunucusuna erişilemiyor. Tekrar dene.'});
  }
 });
 return service;
}

module.exports={createPartyService,attachParty};
