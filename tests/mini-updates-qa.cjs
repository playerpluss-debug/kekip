'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const accounts=require('../accounts');
const Wardrobe=require('../wardrobe');
const base='http://127.0.0.1:3000';
const key=process.env.KEKIP_ADMIN_KEY;
const password='QA-test-password-2026';
const check=async(action,body={},cookie='',expected=200)=>{
 const r=await fetch(base+'/api/account/'+action,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,expected,action+': '+JSON.stringify(data));
 return {data,cookie:r.headers.getSetCookie().find(x=>x.startsWith('kekip_session='))?.split(';')[0]||''};
};
async function main(){
 assert.equal(new URL(process.env.DATABASE_URL).hostname,'127.0.0.1','Only isolated local database permitted');
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/kekip_qa','Only QA database permitted');
 assert.equal(process.env.KEKIP_ADMIN_USERNAMES,'qa_admin');
 const db=await accounts.database();
 await db.query('INSERT INTO kekip_football_accounts(id,username,password_hash) VALUES($1,$2,$3)',['qa-admin-id','qa_admin',await accounts.passwordHash(password)]);
 const server=spawn(process.execPath,['server.js'],{stdio:'inherit'});
 let browser;
 try{
  for(let n=0;;n++){try{const r=await fetch(base);if(r.ok)break}catch{}if(n===59)throw Error('Server did not start');await new Promise(r=>setTimeout(r,1000));}
  const admin=(await check('login',{username:'qa_admin',password})).cookie;
  assert.ok(admin);
  const registration=await check('register',{username:'qa_player',password},'',202);assert.equal(registration.data.status,'pending');assert.equal(registration.cookie,'');
  await check('login',{username:'qa_player',password},'',403);
  await check('admin-registration-list',{adminKey:key},'',401);
  const list=(await check('admin-registration-list',{adminKey:key},admin)).data;assert.ok(list.requests.some(x=>x.username==='qa_player'));assert.ok(!list.requests.some(x=>'password_hash' in x));
  await check('admin-registration-approve',{adminKey:key,username:'qa_player'},admin);
  await check('admin-registration-approve',{adminKey:key,username:'qa_player'},admin,409);
  const player=(await check('login',{username:'qa_player',password})).cookie;assert.ok(player);
  await check('admin-registration-list',{adminKey:key},player,403);
  await check('register',{username:'qa_rejected',password},'',202);
  await check('admin-registration-reject',{adminKey:key,username:'qa_rejected'},admin);
  await check('login',{username:'qa_rejected',password},'',403);
  const row=await db.query("SELECT id FROM kekip_football_accounts WHERE username='qa_player'");assert.equal(row.rows.length,1);
  const cat=(await check('onboarding-catalog',{},player)).data.collections.gece;
  const slots=['av_hair','av_eye','av_brow','av_expression','av_top','av_bottom','av_shoes'];
  const draft={items:Object.fromEntries([...slots.map(s=>[s,cat.items.find(i=>i.slot===s).id]),['av_ear',null],['av_wrist',null]]),hairColor:'original',eyeColor:'gold',expressionBrows:true};
  await check('onboarding-complete',{username:'qa_player',character:'gece',draft},player);
  const shop=(await check('shop',{},player)).data;
  const neon=[...shop.geceCollection.items,...shop.golgeCollection.items].filter(i=>i.collection==='Neon Arcade');assert.equal(neon.length,14);assert.equal(neon.reduce((n,i)=>n+i.price,0),3870);
  for(const item of neon)await check('shop-buy',{username:'qa_player',id:item.id,expectedPrice:item.price},player,409);
  const after=(await check('shop',{},player)).data;assert.equal(after.balance,shop.balance);assert.deepEqual(after.owned.slice().sort(),shop.owned.slice().sort());
  const audit=await db.query("SELECT action FROM kekip_admin_audit WHERE username IN ('qa_player','qa_rejected')");assert.ok(audit.rows.some(r=>r.action==='admin-registration-approve'));assert.ok(audit.rows.some(r=>r.action==='admin-registration-reject'));
  console.log('PASS: real PostgreSQL registration, authorization, onboarding, catalog and blocked purchases');
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:800}});await context.addCookies([{name:'kekip_session',value:player.split('=')[1],url:base}]);const page=await context.newPage();
  for(const item of neon){await page.goto(base+item.previewPath);await page.locator('#avatar').waitFor({state:'visible',timeout:30000});await page.locator('#avatar').evaluate(i=>i.decode());assert.ok(await page.locator('#avatar').evaluate(i=>i.complete&&i.naturalWidth>0),item.id);console.log('PASS preview '+item.id);}
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]){await page.setViewportSize(viewport);for(const route of ['/','/profile.html','/shop.html']){await page.goto(base+route);await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(1000);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),route+' horizontal overflow '+viewport.width);console.log('PASS viewport '+viewport.width+' '+route);}}
 }finally{await browser?.close();server.kill('SIGTERM');await db.end();}
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
