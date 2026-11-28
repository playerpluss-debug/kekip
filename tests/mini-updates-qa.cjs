'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const accounts=require('../accounts');
const Wardrobe=require('../wardrobe');
const Chest=require('../mystery-chest');
const Collections=require('../chest-collections.json');
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
 const server=spawn(process.execPath,['server.js'],{stdio:'inherit',env:{...process.env,KEKIP_CHESTS_ENABLED:'true'}});
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
  assert.ok(neon.every(i=>i.status==='available'&&!i.starter&&!i.onboardingEligible));
  assert.ok(shop.geceCollection.saleEnabled&&shop.golgeCollection.saleEnabled);
  const before=(await check('shop',{},player)).data;
  await check('shop-buy',{username:'qa_player',id:neon[0].id,expectedPrice:neon[0].price+1},player,409);
  await check('shop-buy',{username:'qa_player',id:neon[0].id,expectedPrice:neon[0].price},'',401);
  const unchanged=(await check('shop',{},player)).data;assert.equal(unchanged.balance,before.balance);assert.deepEqual(unchanged.owned.slice().sort(),before.owned.slice().sort());
  await db.query("INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'qa','neon-release','Isolated QA credit',4000)",[row.rows[0].id]);
  const funded=(await check('shop',{},player)).data;
  for(const item of neon){await check('shop-buy',{username:'qa_player',id:item.id,expectedPrice:item.price},player);await check('shop-buy',{username:'qa_player',id:item.id,expectedPrice:item.price},player,409);}
  const after=(await check('shop',{},player)).data;assert.equal(after.balance,funded.balance-3870);assert.deepEqual(after.owned.slice().sort(),[...new Set([...funded.owned,...neon.map(i=>i.id)])].sort());
  const purchases=await db.query("SELECT source_id,amount FROM kekip_coin_ledger WHERE account_id=$1 AND source_kind='cosmetic'",[row.rows[0].id]);for(const i of neon){const entry=purchases.rows.filter(p=>p.source_id===i.id);assert.equal(entry.length,1);assert.equal(entry[0].amount,-i.price);assert.ok(Wardrobe.access(i.character,after.owned).includes(i.id));}
  const audit=await db.query("SELECT action FROM kekip_admin_audit WHERE username IN ('qa_player','qa_rejected')");assert.ok(audit.rows.some(r=>r.action==='admin-registration-approve'));assert.ok(audit.rows.some(r=>r.action==='admin-registration-reject'));
  console.log('PASS: real PostgreSQL registration, authorization, onboarding, catalog and 14 purchases with exact debits and duplicate protection');
  const chestItems=Chest.eligibleItems(Collections,'gece'),grouped=Chest.groups(chestItems,[]);
  assert.deepEqual(Chest.effectiveOdds(grouped).map(t=>t.percent),[59,30,9,2]);
  assert.equal(Chest.effectiveOdds(grouped,{chestMultiplier:150}).find(t=>t.id==='mythic').percent,2);
  assert.equal(Chest.draw(grouped,()=>0,null,true).item.chestRarity,'mythic');
  const id=row.rows[0].id, rare=chestItems.filter(i=>i.chestRarity==='rare');
  for(const i of rare)await db.query('INSERT INTO kekip_cosmetic_inventory(account_id,item_id) VALUES($1,$2)',[id,i.id]);
  const testWrite=async(db,a,fn)=>{const conn=await db.connect();try{await conn.query('BEGIN');await conn.query('SELECT id FROM kekip_football_accounts WHERE id=$1 FOR UPDATE',[a.id]);const r=await fn(conn);await conn.query('COMMIT');return r;}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}};
  const service=Chest.createService({collections:Collections,coinBalance:async(c,a)=>Number((await c.query('SELECT COALESCE(SUM(amount),0) AS balance FROM kekip_coin_ledger WHERE account_id=$1',[a.id])).rows[0].balance),write:testWrite,enabled:true,randomInt:()=>0});
  const a={id,username:'qa_player'},body={username:a.username,character:'gece'};
  await db.query("INSERT INTO kekip_coin_ledger(account_id,source_kind,source_id,label,amount) VALUES($1,'qa','chest-credit','QA only',1000)",[id]);
  const status=()=>service(db,a,'chest-status',body);
  const open=(n,price=100,character='gece')=>service(db,a,'chest-open',{...body,character,requestId:n.toString(16).padStart(32,'0'),expectedPrice:price});
  const start=await status();assert.equal(start.tickets,0);assert.equal(start.pity,0);
  await assert.rejects(()=>open(1,0),e=>e.status===409);
  for(let n=1;n<=3;n++){const r=await open(n);assert.equal(r.reward.type,'ticket');assert.equal(r.reward.tickets,1);}
  let s=await status();assert.equal(s.tickets,3);assert.equal(s.pity,3);assert.equal(s.balance,start.balance-300);
  const free=await open(4,0);assert.equal(free.price,0);assert.equal(free.reward.type,'ticket');
  assert.equal((await open(4,0)).duplicate,true);
  s=await status();assert.equal(s.tickets,1);assert.equal(s.pity,4);assert.equal(s.balance,start.balance-300);
  await db.query('UPDATE kekip_chest_progress SET pity=99,tickets=3 WHERE account_id=$1',[id]);
  s=await status();assert.equal(s.chests.find(c=>c.character==='golge').guaranteed,true);
  const mythic=await open(5,0,'golge');assert.equal(mythic.reward.rarity,'mythic');assert.equal(mythic.reward.completeSet,true);
  s=await status();assert.equal(s.pity,0);assert.equal(s.tickets,0);assert.equal(s.balance,start.balance-300);
  await db.query('UPDATE kekip_chest_progress SET pity=99 WHERE account_id=$1',[id]);
  assert.equal((await status()).chests.find(c=>c.character==='golge').guaranteed,false);
  await open(6,100,'golge');assert.equal((await status()).pity,100);
  const guaranteed=await open(7);assert.equal(guaranteed.reward.rarity,'mythic');assert.equal((await status()).pity,0);
  const receipts=(await service(db,a,'chest-history',body)).history;assert.equal(receipts.filter(x=>x.price===0).length,2);
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM kekip_coin_ledger WHERE account_id=$1 AND source_kind='mystery_chest_refund'",[id])).rows[0].count),0);
  console.log('PASS chest odds, ticket awards, free openings, idempotency, shared guarantee and historical receipts');
  browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:800}});await context.addCookies([{name:'kekip_session',value:player.split('=')[1],url:base}]);const page=await context.newPage();
  await page.goto(base+'/mystery-chest.html');await page.waitForFunction(()=>document.getElementById('ticketText')?.textContent.includes('Sandık biletleri: 1')===false&&document.getElementById('ticketText')?.textContent.includes('ücretsiz açılış'));assert.ok(await page.locator('#pityBar').count());assert.ok(await page.locator('#ticketBar').count());
  const fs=require('node:fs/promises');await fs.mkdir('qa-neon',{recursive:true});
  assert.equal(await page.locator('#demo,#tier').count(),0);
  // Real authenticated opening in the isolated database. Force a ticket by owning all but one tier,
  // and exercise both the motion and reduced-motion path using deterministic server receipts.
  await db.query("DELETE FROM kekip_cosmetic_inventory WHERE account_id=$1 AND item_id LIKE 'gece_chest_%'",[id]);
  await db.query("UPDATE kekip_chest_progress SET pity=99,tickets=3 WHERE account_id=$1",[id]);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(base+'/mystery-chest.html');
  await page.waitForFunction(()=>document.getElementById('ticketText')?.textContent.includes('Sandık biletleri: 3'));
  await page.waitForFunction(()=>window.KEKIPPreferences?.status().ready===true);
  const beforeSpin=await status();
  page.once('dialog',d=>d.accept());
  await page.locator('#purchase').click();
  await page.locator('#reel .winner').waitFor({timeout:15000});
  await page.locator('#result').waitFor({timeout:15000});
  const won=await page.locator('#reel .winner').getAttribute('data-reward-id');
  assert.equal(won,chestItems.find(i=>i.chestRarity==='mythic').id);
  assert.ok(await page.locator('#reel .winner').evaluate(el=>{const a=el.getBoundingClientRect(),b=document.getElementById('reelViewport').getBoundingClientRect();return Math.abs((a.left+a.width/2)-(b.left+b.width/2))<2;}));
  const afterSpin=await status();assert.equal(afterSpin.tickets,beforeSpin.tickets-3);assert.equal(afterSpin.balance,beforeSpin.balance);assert.equal(afterSpin.pity,0);
  await page.screenshot({path:'qa-neon/chest-reel-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(base+'/mystery-chest.html');await page.waitForFunction(()=>!document.getElementById('purchase').disabled);
  page.once('dialog',d=>d.accept());await page.locator('#purchase').click();await page.locator('#result').waitFor({timeout:15000});
  const last=(await service(db,a,'chest-history',body)).history[0].reward;
  assert.equal(await page.locator('#reel .winner').getAttribute('data-reward-id'),last.type==='cosmetic'?last.id:last.type);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3));
  await page.screenshot({path:'qa-neon/chest-reel-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:800});await page.emulateMedia({reducedMotion:'no-preference'});
  console.log('PASS real chest reel receipt, centered winner, free ticket debit, mobile and reduced motion');

  async function imageReady(id){await page.waitForFunction(id=>{const i=document.getElementById(id);return i&&!i.hidden&&i.complete&&i.naturalWidth>0},id,{timeout:30000});return page.locator('#'+id).evaluate(async i=>{await i.decode();return {width:i.naturalWidth,height:i.naturalHeight,src:i.src};});}
  for(const item of neon){
   await page.goto(base+item.previewPath);
   const full=await imageReady('avatar'),detail=await imageReady('detail');assert.equal(full.width,480);assert.equal(full.height,660);assert.ok(detail.width>40&&detail.height>40,item.id);
   const alpha=await page.locator('#avatar').evaluate(i=>{const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const g=c.getContext('2d');g.drawImage(i,0,0);const p=g.getImageData(0,0,c.width,c.height).data;let n=0;for(let k=3;k<p.length;k+=4)if(p[k]>16)n++;return n/(c.width*c.height)});
   assert.ok(alpha>.03&&alpha<.95,item.id+' invalid transparency');
   await page.screenshot({path:'qa-neon/'+item.id+'.png',fullPage:true});
   console.log('PASS visual preview '+item.id+' 480x660 and isolated detail '+detail.width+'x'+detail.height);
  }
  for(const character of ['gece','golge']){
   const item=neon.find(i=>i.character===character);await page.goto(base+item.previewPath);
   const single=await imageReady('avatar');await page.locator('#full').click();const full=await imageReady('avatar');assert.notEqual(full.src,single.src,character+' full collection');
   await page.screenshot({path:'qa-neon/'+character+'-full.png',fullPage:true});
   await page.locator('#base').click();const basic=await imageReady('avatar');assert.notEqual(basic.src,full.src,character+' base comparison');await page.screenshot({path:'qa-neon/'+character+'-base.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),character+' mobile overflow');await page.screenshot({path:'qa-neon/'+character+'-mobile.png',fullPage:true});await page.setViewportSize({width:1280,height:800});
   console.log('PASS collection comparison '+character);
  }
  for(const viewport of [{width:1280,height:800},{width:390,height:844}]){await page.setViewportSize(viewport);for(const route of ['/','/profile.html','/shop.html']){await page.goto(base+route);await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(1000);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3),route+' horizontal overflow '+viewport.width);console.log('PASS viewport '+viewport.width+' '+route);}}
 }finally{await browser?.close();server.kill('SIGTERM');await db.end();}
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
