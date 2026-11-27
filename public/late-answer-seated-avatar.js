'use strict';
(function(root, factory){
  const poses=factory();
  if(typeof module==='object'&&module.exports)module.exports=poses;
  else root.KEKIPSeatedAvatar=poses;
})(globalThis,()=>{
  function alphaBounds(pixels,width,height){
    let left=width,right=-1,top=height,bottom=-1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      if(pixels[(y*width+x)*4+3]<80)continue;
      left=Math.min(left,x);right=Math.max(right,x);
      top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    return right<0?null:{left,right,top,bottom};
  }

  function seatedRig(bounds){
    const height=bounds.bottom-bounds.top+1;
    // The saved portraits share a front-facing rig. Bend the legs at hip, knee and ankle.
    const hip=Math.round(height*.61),knee=Math.round(height*.79),ankle=Math.round(height*.915);
    const lap=Math.max(1,Math.round((knee-hip)*.43));
    const shin=Math.max(1,Math.round((ankle-knee)*.77));
    const feet=height-ankle;
    return {height,hip,knee,ankle,lap,shin,feet,posedHeight:hip+lap+shin+feet};
  }

  function draw(canvas,image){
    const w=image.naturalWidth,h=image.naturalHeight;
    if(!w||!h)return false;
    const original=document.createElement('canvas');
    original.width=w;original.height=h;
    const src=original.getContext('2d',{willReadFrequently:true});
    if(!src)return false;
    src.drawImage(image,0,0);
    const pixels=src.getImageData(0,0,w,h).data;
    const bounds=alphaBounds(pixels,w,h);
    if(!bounds)return false;
    const {left,right,top}=bounds;
    const rig=seatedRig(bounds);
    const {hip,knee,ankle,lap,shin,feet,posedHeight}=rig;
    const pad=Math.ceil(w*.065),width=right-left+1;
    const split=Math.max(1,Math.min(width-1,Math.round(w*.5-left)));
    canvas.width=width+pad*2;canvas.height=posedHeight;
    const ctx=canvas.getContext('2d');
    if(!ctx)return false;
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(original,left,top,width,hip,pad,0,width,hip);
    const bend=Math.max(1,Math.round(width*.035));
    function lowerBody(from,to,start,length,beginSpread,endSpread){
      for(let row=0;row<length;row++){
        const t=row/Math.max(1,length-1);
        const spread=Math.round(beginSpread+(endSpread-beginSpread)*t);
        const y=top+from+row*(to-from)/length;
        const sourceHeight=(to-from)/length;
        const destY=start+row;
        const middleAlpha=pixels[(Math.floor(y)*w+left+split)*4+3];
        if(spread===0||middleAlpha>=80)ctx.drawImage(original,left,y,width,sourceHeight,pad,destY,width,1);
        else{
          ctx.drawImage(original,left,y,split,sourceHeight,pad-spread,destY,split,1);
          ctx.drawImage(original,left+split,y,width-split,sourceHeight,pad+spread+split,destY,width-split,1);
        }
      }
    }
    // Keep skirts and long tops intact across the lap. The split starts below the knee.
    lowerBody(hip,knee,hip,lap,0,0);
    lowerBody(knee,ankle,hip+lap,shin,0,bend);
    lowerBody(ankle,rig.height,hip+lap+shin,feet,bend,bend);
    canvas.style.aspectRatio=canvas.width+' / '+canvas.height;
    return true;
  }

  function mount(portrait,canvas){
    let current=null,rendered='';
    function refresh(){
      const image=portrait.querySelector('.kp-portrait-image');
      if(image!==current){
        current?.removeEventListener('load',refresh);
        current=image;
        current?.addEventListener('load',refresh);
      }
      const key=image?.getAttribute('src');
      if(!key||!image.complete){
        canvas.hidden=true;
        return;
      }
      if(key===rendered){
        canvas.hidden=false;
        return;
      }
      try{
        if(draw(canvas,image)){
          rendered=key;
          canvas.hidden=false;
          return;
        }
      }catch(error){
        console.warn('Oturan avatar hazırlanamadı:',error.message);
      }
      canvas.hidden=true;
    }
    const observer=new MutationObserver(refresh);
    observer.observe(portrait,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
    refresh();
    return ()=>{
      observer.disconnect();
      current?.removeEventListener('load',refresh);
    };
  }
  return {alphaBounds,seatedRig,mount};
});
