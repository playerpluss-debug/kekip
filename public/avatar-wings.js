(() => {
'use strict';

const palette = {
  wing_silver:   ['#172438', '#647d9d', '#f3f8ff', '#a8ddff', 'feather'],
  wing_frost:    ['#12355d', '#37b6e4', '#d5fbff', '#83edff', 'shard'],
  wing_moth:     ['#22132e', '#9b4bbb', '#edb4ff', '#f39fff', 'moth'],
  wing_obsidian: ['#180e21', '#672638', '#e75850', '#ff864e', 'dragon'],
  wing_seraph:   ['#734221', '#e5a745', '#fff9cb', '#ffda73', 'seraph'],
  wing_chronos:  ['#222333', '#ad7049', '#f2cf82', '#81faff', 'metal'],
  wing_phoenix:  ['#6f1334', '#ee4f22', '#fff1a3', '#ffb12f', 'fire'],
  wing_nova:     ['#150f45', '#6735cc', '#87eeff', '#e2bbff', 'nova']
};

const style = document.createElement('style');
style.textContent = `
.kp-wing-layer,.kp-wing-backdrop{position:absolute;inset:0;pointer-events:none}
.kp-wing-backdrop{z-index:0;border-radius:inherit}
.kp-wing-layer{display:grid;place-items:center;container-type:size;z-index:1}
.stage > .kp-wing-layer{z-index:0}
.kp-wing-pair{display:flex;width:min(100cqw,72.727cqh);aspect-ratio:480/660}
.kp-wing-product{position:relative;min-height:170px;background:radial-gradient(ellipse,#43305c,#211830 76%)}
.kp-wing-product .kp-wing-pair{width:min(95cqw,170cqh);aspect-ratio:480/265}
.kp-wing-pair canvas{display:block;width:50%;height:100%;min-width:0}
.kp-wing-right{scale:-1 1}
.kp-wing-left{transform-origin:98% 39%}
.kp-wing-right{transform-origin:2% 39%}
.kp-wing-layer[data-motion] .kp-wing-left{animation:kp-wing-sweep 2.7s ease-in-out infinite}
.kp-wing-layer[data-motion] .kp-wing-right{animation:kp-wing-sweep-right 2.7s ease-in-out infinite}
.kp-wing-layer[data-motion="wing_nova"] canvas{animation-duration:4.2s}
@keyframes kp-wing-sweep{0%,100%{transform:rotate(-4deg) scaleX(.88);filter:brightness(.95)}50%{transform:rotate(7deg) scaleX(1.05);filter:brightness(1.35)}}
@keyframes kp-wing-sweep-right{0%,100%{transform:rotate(4deg) scaleX(.88);filter:brightness(.95)}50%{transform:rotate(-7deg) scaleX(1.05);filter:brightness(1.35)}}
@media(prefers-reduced-motion:reduce){.kp-wing-layer[data-motion] canvas{animation:none}}
`;
document.head.append(style);

const art = new Map();
function draw(id) {
  const [shadow, mid, light, glow, kind] = palette[id];
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 1320;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  function paint(svgPath, from, to, edge = shadow) {
    const path = new Path2D(svgPath);
    const gradient = ctx.createLinearGradient(232, 297, 38, 132);
    gradient.addColorStop(0, from);
    gradient.addColorStop(.58, mid);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.25;
    ctx.stroke(path);
    ctx.fill(path);
  }

  function vein(svgPath, color = light, opacity = .48, width = 1.15) {
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(new Path2D(svgPath));
    ctx.globalAlpha = 1;
  }

  if (kind === 'feather' || kind === 'seraph' || kind === 'fire') {
    const count = kind === 'feather' ? 9 : 12;
    for (let i = count - 1; i >= 0; i--) {
      const x = 11 + i * 10, y = 139 + i * 18;
      paint(`M239 267 Q${120+i*6} ${126+i*10} ${x} ${y}
        Q${x+18} ${y+46} ${x+58} ${y+68}
        Q${x+91} ${y+82} 231 ${290+i*2} Z`, shadow, i%2 ? glow : light);
      vein(`M228 ${271+i*2} Q${x+67} ${y+55} ${x+17} ${y+17}`);
    }
    for (let i = 8; i >= 0; i--) {
      const x = 39 + i*13, y = 151 + i*13;
      paint(`M237 263 Q${153+i*4} ${y-30} ${x} ${y} Q${x+35} ${y+45} ${x+82} ${y+55} L235 282Z`, shadow, light);
      vein(`M${x+9} ${y+4} Q${x+56} ${y+9} 222 265`, glow, .75);
    }
    if (kind === 'seraph') {
      paint('M238 267 Q174 247 113 191 Q128 250 193 282 Q213 295 240 285Z', shadow, light, glow);
      vein('M225 277 Q166 259 129 211', glow, .9, 2.4);
    }
  } else if (kind === 'shard' || kind === 'metal') {
    for (let i = 7; i >= 0; i--) {
      const x = 14 + i*13, y = 142 + i*22;
      const shape = kind === 'metal'
        ? `M238 273 L${x+74} ${y+5} ${x+20} ${y-12} ${x} ${y+9} ${x+43} ${y+57} 230 ${289+i*2}Z`
        : `M237 273 L${x+39} ${y+9} ${x} ${y-10} ${x+23} ${y+57} 227 ${292+i*2}Z`;
      paint(shape,shadow,light,mid);
      vein(`M225 ${281+i*2} L${x+41} ${y+33} ${x+13} ${y+1}`, glow, .82, kind==='metal'?2:1);
      vein(`M${x+43} ${y+33} l-11 12`, light, .8);
    }
    paint('M238 277 L174 196 150 198 185 250 229 292Z', shadow, light, glow);
  } else {
    const upper = kind === 'moth'
      ? 'M238 269 C155 118 57 100 14 158 C5 201 53 254 101 270 C39 260 57 323 100 348 C147 365 212 309 238 281Z'
      : kind === 'nova'
      ? 'M239 271 C185 183 104 182 15 118 Q42 183 75 205 Q48 211 28 200 Q61 265 131 259 Q112 276 77 285 Q137 311 179 288 Q176 317 154 340 Q219 320 239 281Z'
      : 'M238 267 C187 201 133 140 12 131 L49 177 Q36 197 39 228 Q74 212 91 254 Q129 228 144 299 Q171 268 197 331 Q211 289 238 283Z';
    paint(upper, shadow, light, mid);
    for (const [x,y] of [[18,141],[49,180],[42,224],[91,249],[145,295],[192,321]]) {
      vein(`M233 275 Q${x+62} ${y-20} ${x} ${y}`, glow, kind==='dragon'?.7:.6, kind==='dragon'?1.9:1.35);
    }
    if (kind === 'moth') {
      for (const [x,y,r] of [[79,199,22],[108,292,14],[127,221,8]]) {
        ctx.strokeStyle=glow;ctx.fillStyle=shadow;ctx.lineWidth=2;
        ctx.beginPath();ctx.ellipse(x,y,r,r*.7,-.55,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.fillStyle=light;ctx.beginPath();ctx.arc(x,y,r*.21,0,Math.PI*2);ctx.fill();
      }
    }
  }

  if (kind === 'fire' || kind === 'nova') {
    for (let i=0;i<32;i++) {
      const x=13+(i*59)%197, y=122+(i*43)%209;
      ctx.globalAlpha=.3+(i%5)*.13;
      ctx.fillStyle=i%3===0?light:glow;
      ctx.beginPath();ctx.arc(x,y,i%7===0?2:1,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=1;
      if(kind==='nova'&&i%7===0)vein(`M${x-5} ${y} h10 M${x} ${y-5} v10`, light,.8);
    }
  }
  return canvas;
}

function attach(host, id, background = '') {
  let layer=host.querySelector(':scope > .kp-wing-layer');
  let backdrop=host.querySelector(':scope > .kp-wing-backdrop');
  if (!Object.hasOwn(palette, id)) {
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
  if (!art.has(id)) art.set(id,draw(id));
  layer=document.createElement('div');
  layer.className='kp-wing-layer';
  layer.dataset.wing=id;
  layer.setAttribute('aria-hidden','true');
  if (id==='wing_phoenix'||id==='wing_nova') layer.dataset.motion=id;
  const pair=document.createElement('div');
  pair.className='kp-wing-pair';
  const product=host.classList.contains('kp-wing-product');
  for (const side of ['left','right']) {
    const canvas=document.createElement('canvas');
    canvas.className='kp-wing-'+side;
    canvas.width=480;
    canvas.height=product?530:1320;
    canvas.getContext('2d').drawImage(art.get(id),0,product?-218:0);
    pair.append(canvas);
  }
  layer.append(pair);
  host.prepend(layer);
}

window.KEKIPWings={attach,has:id=>Object.hasOwn(palette,id)};
})();
