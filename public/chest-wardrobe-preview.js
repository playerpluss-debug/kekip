/* 0.51.18.5.1 — read-only Mythic set section. No ownership or outfit writes. */
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
 const note=make('small','Set giyme ve gerçek sandık açılışı sonraki entegrasyon aşamalarında etkinleşecek.');
 const link=make('a','Gizemli Sandık');link.href='/mystery-chest.html';
 const names={gece:['Ay Tutulması Seti','ay-tutulmasi-set'],golge:['Karanlık Hükümdar Seti','karanlik-hukumdar-set']};
 name.textContent=names[character][0];image.alt=name.textContent+' önizlemesi';image.src='/images/chest-collections/'+character+'/'+names[character][1]+'/preview.webp';
 text.append(name,tag,state,note);card.append(image,text);section.append(title,desc,card,link);main.append(section);
 async function api(action,body={}){const r=await fetch('/api/account/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Hesap bilgisi alınamadı.');return r.json();}
 let epoch=0;
 async function refresh(){const stamp=++epoch;state.textContent='Durum kontrol ediliyor…';try{const me=await api('me');if(stamp!==epoch)return;const username=me.user?.username;if(!username){state.textContent='Giriş yap · Önizleme';return;}const info=await api('chest-status',{username});if(stamp!==epoch)return;const c=info.chests?.find(x=>x.character===character);const set=c?.items?.find(x=>x.rarity==='mythic'&&x.completeSet===true);if(info.username!==username||!set)throw Error('Set verisi doğrulanamadı.');state.textContent=set.owned?'Kazanıldı · Giyme henüz kapalı':set.visualApprovalPending?'Önizleme · Görsel onayı bekleniyor':'Kilitli · Sandık henüz kapalı';}catch{if(stamp===epoch)state.textContent='Durum alınamadı · Önizleme';}}
 window.addEventListener('pageshow',e=>{if(e.persisted)refresh();});window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(document.hidden){++epoch;state.textContent='Önizleme';}else refresh();});refresh();
})();
