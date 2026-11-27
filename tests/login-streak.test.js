'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loginStreak,creditLoginStreak}=require('../login-streak');
test('series crosses months and a leap day, counts the reward once, and ignores future records',()=>{
 const r=loginStreak('2028-03-01',['2028-02-28','2028-02-29','2028-03-01','2028-03-01','2028-03-02']);
 assert.equal(r.days,3);assert.equal(r.claimedToday,true);
});
test('series remains visible before today is claimed and resets after a missed day',()=>{
 assert.equal(loginStreak('2026-11-27',['2026-11-26','2026-11-25']).days,2);
 assert.equal(loginStreak('2026-11-28',['2026-11-26']).days,0);
});
test('seven, fourteen and thirty day goals follow the actual streak without a cap',()=>{
 const today='2026-11-27',dates=Array.from({length:34},(_,i)=>new Date(Date.parse(today)-i*86400000).toISOString().slice(0,10));
 assert.equal(loginStreak(today,dates).days,34);
 assert.deepEqual(loginStreak(today,dates.slice(0,14)).milestones.map(x=>x.reached),[true,true,false]);
 assert.equal(loginStreak('2026-03-01',['2026-02-30']).days,0);
});

test('milestone awards are permanent and retries only sum newly inserted amounts',async()=>{
 const today='2026-11-30',dates=Array.from({length:30},(_,i)=>new Date(Date.parse(today)-i*86400000).toISOString().slice(0,10));
 const paid=new Set(),streak=loginStreak(today,dates);
 assert.deepEqual(streak.milestones.map(row=>row.amount),[100,200,400]);
 const db={async query(sql,[account,targets,amounts]){
  assert.equal(account,'a');
  assert.match(sql,/ON CONFLICT\(account_id,source_kind,source_id\) DO NOTHING/);
  return {rows:targets.flatMap((target,i)=>{
   if(paid.has(target))return [];paid.add(target);return [{amount:amounts[i]}];
  })};
 }};
 assert.equal(await creditLoginStreak(db,'a',streak),700);
 assert.equal(await creditLoginStreak(db,'a',streak),0);
 const broken=loginStreak('2026-12-05',dates,[...paid].map(String));
 assert.equal(broken.days,0);
 assert.equal(broken.milestones.every(row=>row.paid&&!row.reached),true);
});
