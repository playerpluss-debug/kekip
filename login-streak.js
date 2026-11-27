'use strict';

const milestones=[7,14,30];
function dayNumber(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const ms=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms/86400000:null;
}
function loginStreak(today,claimDates){
 const day=dayNumber(today);
 if(day===null)throw Error('Invalid server reward day');
 const claims=new Set(claimDates.map(dayNumber).filter(n=>n!==null&&n<=day));
 const claimedToday=claims.has(day);
 let cursor=day-(claimedToday?0:1),days=0;
 while(claims.has(cursor)){days++;cursor--;}
 return {days,claimedToday,milestones:milestones.map(target=>({target,reached:days>=target}))};
}
async function readLoginStreak(db,accountId,today){
 const {rows}=await db.query(
  "SELECT source_id FROM kekip_coin_ledger WHERE account_id=$1 AND source_kind='daily_login' AND source_id<=$2",
  [accountId,today]
 );
 return loginStreak(today,rows.map(row=>row.source_id));
}
module.exports={loginStreak,readLoginStreak};
