'use strict';

const milestones=Object.freeze([
 Object.freeze({target:7,amount:100,rarity:'rare',icon:'📅'}),
 Object.freeze({target:14,amount:200,rarity:'epic',icon:'🔥'}),
 Object.freeze({target:30,amount:400,rarity:'legendary',icon:'🏅'})
]);
function dayNumber(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const ms=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms/86400000:null;
}
function loginStreak(today,claimDates,paid=[]){
 const day=dayNumber(today);
 if(day===null)throw Error('Invalid server reward day');
 const claims=new Set(claimDates.map(dayNumber).filter(n=>n!==null&&n<=day));
 const claimedToday=claims.has(day);
 let cursor=day-(claimedToday?0:1),days=0;
 while(claims.has(cursor)){days++;cursor--;}
 return {days,claimedToday,milestones:milestones.map(({target,amount})=>({target,amount,reached:days>=target,paid:paid.includes(String(target))}))};
}
async function readLoginStreak(db,accountId,today){
 const {rows}=await db.query(
  "SELECT source_kind,source_id FROM kekip_coin_ledger WHERE account_id=$1 AND ((source_kind='daily_login' AND source_id<=$2) OR source_kind='login_streak')",
  [accountId,today]
 );
 return loginStreak(today,rows.filter(row=>row.source_kind==='daily_login').map(row=>row.source_id),rows.filter(row=>row.source_kind==='login_streak').map(row=>row.source_id));
}
async function creditLoginStreak(db,accountId,streak){
 const eligible=streak.milestones.filter(row=>row.reached&&!row.paid);
 if(!eligible.length)return 0;
 const q=await db.query(`INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount)
 SELECT $1,'login_streak',target::text,'Giriş Serisi · '||target::text||' Gün',amount
 FROM unnest($2::int[],$3::int[]) AS awards(target,amount)
 ON CONFLICT(account_id,source_kind,source_id) DO NOTHING RETURNING amount`,
 [accountId,eligible.map(i=>i.target),eligible.map(i=>i.amount)]);
 return q.rows.reduce((sum,row)=>sum+Number(row.amount),0);
}
module.exports={loginStreak,readLoginStreak,creditLoginStreak,milestones};
