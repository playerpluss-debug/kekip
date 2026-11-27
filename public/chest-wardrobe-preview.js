/* 0.51.19.6 — exclusive complete sets only; individual cosmetics live in ordinary wardrobe categories. */
(()=>{
 'use strict';
 const character=document.currentScript?.dataset.character;
 if(!['gece','golge'].includes(character))return;
 const q=new URLSearchParams(location.search);
 if(q.has('profile')||q.has('item')||q.has('preview'))return;
 const main=document.querySelector('main'),header=main?.querySelector('header');if(!header||document.querySelector('#chest-mythic-sets'))return;
 const make=(tag,txt)=>{const e=document.createElement(tag);if(txt)e.textContent=txt;return e;};
 const css=make('style');css.textContent=`
 #chest-mythic-sets{margin:auto;width:min(720px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;border:1px solid #59416e;border-radius:16px;background:#20172e;padding:16px;color:#f5eaff;box-sizing:border-box}
 #chest-mythic-sets::backdrop{background:rgba(10,6,18,.76)}
 #chest-mythic-sets .kp-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
 #chest-mythic-sets button,#kp-chest-wardrobe-open{border:1px solid #8c6bb5;border-radius:9px;background:#38284f;color:#fff;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;white-space:normal}
 #chest-mythic-sets button:disabled{opacity:.45;cursor:not-allowed}
 #kp-chest-wardrobe-open{flex:none;white-space:nowrap;font-weight:700}
 #chest-mythic-sets .kp-chest-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:10px;margin:12px 0}
 #chest-mythic-sets .kp-chest-grid img{width:100%;height:140px;aspect-ratio:auto;object-fit:contain}
 #chest-mythic-sets .kp-chest-grid button{width:100%;margin-top:5px}
 #chest-mythic-sets h2{margin:0 0 6px;font-size:18px}#chest-mythic-sets p{margin:5px 0;color:#cdbbdf;font-size:13px;line-height:1.5}
 #chest-mythic-sets .kp-set-card{display:grid;grid-template-columns:minmax(95px,135px) minmax(0,1fr);gap:14px;align-items:center;border:1px solid #76445e;border-radius:12px;background:#291a34;padding:12px;margin:12px 0;min-width:0}
 #chest-mythic-sets img{display:block;width:100%;height:auto;aspect-ratio:480/660;object-fit:contain;background:#18111e;border-radius:8px}
 #chest-mythic-sets strong{display:block;overflow-wrap:anywhere;font-size:16px;color:#ffd4df}#chest-mythic-sets .kp-set-state{color:#f0a6c2;font-weight:700}
 #chest-mythic-sets a{display:inline-block;color:#e3c8ff;text-decoration:underline;padding:6px 0}#chest-mythic-sets small{display:block;color:#d7c5e6;font-size:12px;margin:5px 0}
 @media(max-width:420px){#chest-mythic-sets{padding:12px}#chest-mythic-sets .kp-set-card{grid-template-columns:90px minmax(0,1fr);gap:10px;padding:10px}}
 `;document.head.append(css);
 const section=make('dialog');section.id='chest-mythic-sets';section.setAttribute('aria-labelledby','chest-mythic-title');
 const title=make('h2','Mitik Setler');title.id='chest-mythic-title';
 const desc=make('p','Sandığa özel komple setler. Parçalar ayrı ayrı giyilmez veya başka kıyafetlerle kombinlenmez.');
 const card=make('div');card.className='kp-set-card';
 const image=make('img');image.alt='';image.loading='lazy';image.width=300;image.height=410;
 const text=make('div'),name=make('strong'),tag=make('small','Mitik · Komple set · %1'),state=make('p','Durum kontrol ediliyor…');state.className='kp-set-state';state.setAttribute('role','status');
 const note=make('small','Set tek başına giyilir. Önceki normal kombin saklanır.');const equip=make('button','Seti giy');equip.type='button';equip.disabled=true;const remove=make('button','Seti çıkar');remove.type='button';remove.hidden=true;const feedback=make('p');feedback.setAttribute('role','status');let currentUser=null,currentSet=null,active=false,previousNormal=false,busy=false;
 const link=make('a','Gizemli Sandık');link.href='/mystery-chest.html';
 const names={gece:['Ay Tutulması Seti','ay-tutulmasi-set'],golge:['Karanlık Hükümdar Seti','karanlik-hukumdar-set']};
 name.textContent=names[character][0];image.alt=name.textContent+' önizlemesi';image.src='/images/chest-collections/'+character+'/'+names[character][1]+'/preview.webp';
 text.append(name,tag,state,note,equip,remove,feedback);card.append(image,text);const inventoryTitle=make('h2','Sandıktan kazanılan kozmetikler');
 const inventoryState=make('p','Envanter kontrol ediliyor…');inventoryState.setAttribute('role','status');
 const inventoryList=make('div');inventoryList.className='kp-chest-grid';
 const open=make('button','Mitik Setler');open.hidden=true;open.id='kp-chest-wardrobe-open';open.type='button';open.setAttribute('aria-haspopup','dialog');open.setAttribute('aria-controls',section.id);
 const close=make('button','Kapat');close.type='button';const head=make('div');head.className='kp-dialog-head';head.append(title,close);
 const inventoryFeedback=make('p');inventoryFeedback.setAttribute('role','status');
 section.append(head,desc,card);document.body.append(section);
 (header.querySelector('.header-actions')||header).append(open);
 open.onclick=()=>{if(!section.open){section.showModal();close.focus();}};close.onclick=()=>section.close();section.addEventListener('close',()=>open.focus());
  async function api(action,body={}){const r=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||'Hesap bilgisi alınamadı.');return j;}
 async function changeSet(action){if(busy||!currentUser||!currentSet)return;busy=true;const username=currentUser,id=currentSet.id;equip.disabled=true;remove.disabled=true;feedback.textContent='Kaydediliyor…';try{const result=await api(action,{username,character,id});if(!result.persisted||result.username!==username)throw Error('Kayıt doğrulanamadı.');location.href=location.pathname;}catch(e){feedback.textContent=e.message;busy=false;equip.disabled=!currentSet?.owned;remove.disabled=false;}}
 equip.onclick=()=>changeSet('wardrobe-set-equip');remove.onclick=()=>{if(previousNormal)changeSet('wardrobe-set-clear');else location.href=location.pathname+'?normal=1';};
 let epoch=0;
 async function refresh(){const stamp=++epoch;currentUser=null;currentSet=null;equip.disabled=true;remove.disabled=true;state.textContent='Durum kontrol ediliyor…';try{const me=await api('me');if(stamp!==epoch)return;const username=me.user?.username;if(!username){state.textContent='Giriş yap · Önizleme';return;}const [info,wardrobe]=await Promise.all([api('chest-status',{username}),api('wardrobe',{username,character})]);if(stamp!==epoch)return;const c=info.chests?.find(x=>x.character===character);const set=c?.items?.find(x=>x.rarity==='mythic'&&x.completeSet===true);if(info.username!==username||wardrobe.username!==username||!set)throw Error('Set verisi doğrulanamadı.');currentUser=username;currentSet=set;active=wardrobe.saved?.setId===set.id;previousNormal=!!wardrobe.saved?.normal;state.textContent=active?(q.has('normal')?'Normal kombin düzenleniyor · kaydedince set çıkar':'Giyili · Profilinde görünür'):set.owned?'Kazanıldı · Giyilebilir':set.visualApprovalPending?'Önizleme · Görsel onayı bekleniyor':'Kilitli · Sandıktan kazanılabilir';equip.hidden=active;equip.disabled=busy||!set.owned;remove.hidden=!active||q.has('normal');remove.disabled=busy;const editor=document.querySelector('.layout > section:nth-child(2)');if(editor)editor.hidden=active&&!q.has('normal');open.hidden=!(set.owned||active);if(active&&!q.has('normal'))open.textContent='Mitik Seti çıkar';else open.textContent='Mitik Setler';}catch{if(stamp===epoch){state.textContent='Durum alınamadı · Önizleme';}}}
 window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(document.hidden){++epoch;currentUser=null;currentSet=null;equip.disabled=true;remove.disabled=true;state.textContent='Önizleme';}else refresh();});refresh();
})();
