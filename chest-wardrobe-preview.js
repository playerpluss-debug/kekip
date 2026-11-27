/* 0.51.18.5.3 — owned chest items and exclusive Mythic set controls. */
(()=>{
 'use strict';
 const character=document.currentScript?.dataset.character;
 if(!['gece','golge'].includes(character))return;
 const q=new URLSearchParams(location.search);
 if(q.has('profile')||q.has('item')||q.has('preview'))return;
 const main=document.querySelector('main');if(!main||document.querySelector('#chest-mythic-sets'))return;
 const make=(tag,txt)=>{const e=document.createElement(tag);if(txt)e.textContent=txt;return e;};
 const css=make('style');css.textContent=`
 #chest-mythic-sets{margin-top:18px;border:1px solid #59416e;border-radius:16px;background:#20172e;padding:16px;color:#f5eaff;box-sizing:border-box}
 #chest-mythic-sets h2{margin:0 0 6px;font-size:18px}#chest-mythic-sets p{margin:5px 0;color:#cdbbdf;font-size:13px;line-height:1.5}
 #chest-mythic-sets .kp-set-card{display:grid;grid-template-columns:minmax(95px,135px) minmax(0,1fr);gap:14px;align-items:center;border:1px solid #76445e;border-radius:12px;background:#291a34;padding:12px;margin:12px 0;min-width:0}
 #chest-mythic-sets img{display:block;width:100%;height:auto;aspect-ratio:480/660;object-fit:contain;background:#18111e;border-radius:8px}
 #chest-mythic-sets strong{display:block;overflow-wrap:anywhere;font-size:16px;color:#ffd4df}#chest-mythic-sets .kp-set-state{color:#f0a6c2;font-weight:700}
 #chest-mythic-sets a{display:inline-block;color:#e3c8ff;text-decoration:underline;padding:6px 0}#chest-mythic-sets small{display:block;color:#d7c5e6;font-size:12px;margin:5px 0}
 @media(max-width:420px){#chest-mythic-sets{padding:12px}#chest-mythic-sets .kp-set-card{grid-template-columns:90px minmax(0,1fr);gap:10px;padding:10px}}
 `;document.head.append(css);
 const section=make('section');section.id='chest-mythic-sets';section.setAttribute('aria-labelledby','chest-mythic-title');
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
 const inventoryList=make('div');inventoryList.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:10px;margin:12px 0';
 section.append(title,desc,card,link,inventoryTitle,inventoryState,inventoryList);main.append(section);
 function showInventory(items){inventoryList.replaceChildren();const owned=items.filter(i=>i.character===character&&!i.completeSet);inventoryState.textContent=owned.length?owned.length+' / 9 kozmetik kazanıldı · Seç ve kombinini kaydet.':'Henüz kazanılmış tekil sandık kozmetiği yok.';for(const item of owned){const tile=make('div');tile.style.cssText='border:1px solid #59416e;border-radius:10px;padding:8px;background:#291a34;min-width:0';const img=make('img');img.alt=item.name;img.loading='lazy';img.src=item.thumbnail;const label=make('strong',item.name);label.style.fontSize='13px';const rarity=make('small',item.rarityLabel);const pick=make('button','Kombine ekle');pick.type='button';pick.disabled=active&&!q.has('normal');pick.onclick=async()=>{try{if(!window.KPChestWardrobe)throw Error('Gardırop henüz hazır değil.');await window.KPChestWardrobe.selectItem(item);feedback.textContent=item.name+' seçildi. Normal kombini kaydet.';}catch(e){feedback.textContent=e.message;}};tile.append(img,label,rarity,pick);inventoryList.append(tile);}}
 function clearInventory(message){inventoryList.replaceChildren();inventoryState.textContent=message;}

 async function api(action,body={}){const r=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||'Hesap bilgisi alınamadı.');return j;}
 async function changeSet(action){if(busy||!currentUser||!currentSet)return;busy=true;const username=currentUser,id=currentSet.id;equip.disabled=true;remove.disabled=true;feedback.textContent='Kaydediliyor…';try{const result=await api(action,{username,character,id});if(!result.persisted||result.username!==username)throw Error('Kayıt doğrulanamadı.');location.href=location.pathname;}catch(e){feedback.textContent=e.message;busy=false;equip.disabled=!currentSet?.owned;remove.disabled=false;}}
 equip.onclick=()=>changeSet('wardrobe-set-equip');remove.onclick=()=>{if(previousNormal)changeSet('wardrobe-set-clear');else location.href=location.pathname+'?normal=1';};
 let epoch=0;
 async function refresh(){const stamp=++epoch;currentUser=null;currentSet=null;equip.disabled=true;remove.disabled=true;state.textContent='Durum kontrol ediliyor…';clearInventory('Envanter kontrol ediliyor…');try{const me=await api('me');if(stamp!==epoch)return;const username=me.user?.username;if(!username){state.textContent='Giriş yap · Önizleme';clearInventory('Envanter için giriş yap.');return;}const [info,inv,wardrobe]=await Promise.all([api('chest-status',{username}),api('chest-inventory',{username,character}),api('wardrobe',{username,character})]);if(stamp!==epoch)return;const c=info.chests?.find(x=>x.character===character);const set=c?.items?.find(x=>x.rarity==='mythic'&&x.completeSet===true);if(info.username!==username||inv.username!==username||wardrobe.username!==username||!Array.isArray(inv.items)||!set)throw Error('Set verisi doğrulanamadı.');currentUser=username;currentSet=set;active=wardrobe.saved?.setId===set.id;previousNormal=!!wardrobe.saved?.normal;state.textContent=active?(q.has('normal')?'Normal kombin düzenleniyor · kaydedince set çıkar':'Giyili · Profilinde görünür'):set.owned?'Kazanıldı · Giyilebilir':set.visualApprovalPending?'Önizleme · Görsel onayı bekleniyor':'Kilitli · Sandık henüz kapalı';equip.hidden=active;equip.disabled=busy||!set.owned;remove.hidden=!active||q.has('normal');remove.disabled=busy;const editor=document.querySelector('.layout > section:nth-child(2)');if(editor)editor.hidden=active&&!q.has('normal');showInventory(inv.items);}catch{if(stamp===epoch){state.textContent='Durum alınamadı · Önizleme';clearInventory('Envanter alınamadı.');}}}
 window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(document.hidden){++epoch;currentUser=null;currentSet=null;equip.disabled=true;remove.disabled=true;state.textContent='Önizleme';clearInventory('Envanter kontrol edilecek.');}else refresh();});refresh();
})();
