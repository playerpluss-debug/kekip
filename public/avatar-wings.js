(() => {
'use strict';

const styles = new Set(["wing_silver","wing_frost","wing_moth","wing_obsidian","wing_seraph","wing_chronos","wing_phoenix","wing_nova"]);

const style = document.createElement('style');
style.textContent = `
.kp-wing-layer,.kp-wing-backdrop{position:absolute;inset:0;pointer-events:none}
.kp-wing-backdrop{z-index:0;border-radius:inherit}
.kp-wing-layer{display:grid;place-items:center;container-type:size;z-index:1}
.stage > .kp-wing-layer{z-index:0}
.kp-wing-pair{position:relative;display:flex;width:min(100cqw,72.727cqh);aspect-ratio:480/660}
.kp-wing-product{position:relative;min-height:170px;background:radial-gradient(ellipse,#43305c,#211830 76%)}
.kp-wing-product .kp-wing-pair{width:min(95cqw,170cqh);aspect-ratio:480/265}
.kp-wing-pair > .kp-wing-left,.kp-wing-pair > .kp-wing-right{
  position:relative;inset:auto;flex:none;display:block;width:50%;height:40.15%;top:25%;
  min-width:0;object-fit:fill;pointer-events:none
}
.kp-wing-product .kp-wing-pair > div{top:0;height:100%}
.kp-wing-pair img.kp-wing-art{position:static;display:block;width:100%;height:100%;max-width:none;object-fit:fill}
.kp-wing-right > img{transform:scaleX(-1)}
.kp-wing-left{transform-origin:98% 57%}
.kp-wing-right{transform-origin:2% 57%}
.kp-wing-layer[data-motion] .kp-wing-left{animation:kp-wing-sweep 2.7s ease-in-out infinite}
.kp-wing-layer[data-motion] .kp-wing-right{animation:kp-wing-sweep-right 2.7s ease-in-out infinite}
.kp-wing-layer[data-motion="wing_nova"] .kp-wing-left,.kp-wing-layer[data-motion="wing_nova"] .kp-wing-right{animation-duration:4.2s}
@keyframes kp-wing-sweep{0%,100%{transform:rotate(-4deg) scaleX(.91);filter:brightness(.97)}50%{transform:rotate(7deg) scaleX(1.02);filter:brightness(1.19)}}
@keyframes kp-wing-sweep-right{0%,100%{transform:rotate(4deg) scaleX(.91);filter:brightness(.97)}50%{transform:rotate(-7deg) scaleX(1.02);filter:brightness(1.19)}}
@media(prefers-reduced-motion:reduce){.kp-wing-layer[data-motion] .kp-wing-left,.kp-wing-layer[data-motion] .kp-wing-right{animation:none}}
`;
document.head.append(style);

function attach(host, id, background = '') {
  let layer=host.querySelector(':scope > .kp-wing-layer');
  let backdrop=host.querySelector(':scope > .kp-wing-backdrop');
  if (!styles.has(id)) {
    layer?.remove();
    backdrop?.remove();
    return;
  }
  if (background) {
    if (!backdrop) {
      backdrop=document.createElement('div');
      backdrop.className='kp-wing-backdrop';
      host.prepend(backdrop);
    }
    if (backdrop.style.background!==background) backdrop.style.background=background;
  } else backdrop?.remove();
  if (layer?.dataset.wing===id) return;
  layer?.remove();
  layer=document.createElement('div');
  layer.className='kp-wing-layer';
  layer.dataset.wing=id;
  layer.setAttribute('aria-hidden','true');
  if (id==='wing_phoenix'||id==='wing_nova') layer.dataset.motion=id;
  const pair=document.createElement('div');
  pair.className='kp-wing-pair';
  for (const side of ['left','right']) {
    const panel=document.createElement('div');
    panel.className='kp-wing-'+side;
    const image=new Image();
    image.className='kp-wing-art';
    image.alt='';
    image.decoding='async';
    image.draggable=false;
    image.src='/images/avatar-wings/'+id+'.webp';
    panel.append(image);
    pair.append(panel);
  }
  layer.append(pair);
  host.prepend(layer);
}

window.KEKIPWings={attach,has:id=>styles.has(id)};
})();
