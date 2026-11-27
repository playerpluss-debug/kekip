'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loginStreak}=require('../login-streak');
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
