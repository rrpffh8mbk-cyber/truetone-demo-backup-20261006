let mp = null;
let faceLandmarker = null;
let mpLoadError = null;

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export async function ensureFaceLandmarker(statusCb=()=>{}){
  if(faceLandmarker) return faceLandmarker;
  if(mpLoadError) throw mpLoadError;
  try{
    statusCb('正在加载 Face Landmarker…');
    mp = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32');
    const vision = await mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
    faceLandmarker = await mp.FaceLandmarker.createFromOptions(vision,{
      baseOptions:{modelAssetPath:MODEL_URL,delegate:'GPU'},
      runningMode:'IMAGE',numFaces:3,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false
    });
    statusCb('Face Landmarker 已就绪');
    return faceLandmarker;
  }catch(err){
    console.error(err);
    mpLoadError = err;
    statusCb('Face Landmarker 加载失败，将回退到整图色彩分析。');
    throw err;
  }
}

export function rgbToHsv(r,g,b){
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  let h=0;
  if(d!==0){
    if(max===r)h=((g-b)/d)%6;
    else if(max===g)h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60;if(h<0)h+=360;
  }
  const s=max===0?0:d/max;
  return {h,s:s*100,v:max*100};
}
export function hsvToRgb(h,s,v){
  s/=100;v/=100;
  const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
  let r=0,g=0,b=0;
  if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}
  return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
export function circularHueDistance(a,b){const d=Math.abs(a-b)%360;return Math.min(d,360-d)}

function samplePixels(ctx,w,h,mask=null){
  const image=ctx.getImageData(0,0,w,h), data=image.data;
  const maskData=mask?mask.getContext('2d').getImageData(0,0,w,h).data:null;
  let n=0,sumS=0,sumV=0,sumR=0,sumG=0,sumB=0,bright=0,highSat=0;
  const hues=[]; const step=Math.max(1,Math.floor(Math.sqrt((w*h)/70000)));
  for(let y=0;y<h;y+=step){for(let x=0;x<w;x+=step){
    const i=(y*w+x)*4;if(maskData && maskData[i+3]<100) continue;
    const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];if(a<40)continue;
    const hsv=rgbToHsv(r,g,b);n++;sumS+=hsv.s;sumV+=hsv.v;sumR+=r;sumG+=g;sumB+=b;
    hues.push(hsv.h);if(hsv.v>70)bright++;if(hsv.s>50)highSat++;
  }}
  if(!n)return null;
  let sx=0,sy=0;for(const h0 of hues){sx+=Math.cos(h0*Math.PI/180);sy+=Math.sin(h0*Math.PI/180)}
  let hue=Math.atan2(sy/n,sx/n)*180/Math.PI;if(hue<0)hue+=360;
  const hueStd=Math.sqrt(hues.reduce((acc,h0)=>acc+Math.pow(circularHueDistance(h0,hue),2),0)/n);
  return {hue:+hue.toFixed(1),saturation:+(sumS/n).toFixed(1),brightness:+(sumV/n).toFixed(1),hue_std:+hueStd.toFixed(1),brightness_ratio:+(bright/n*100).toFixed(1),high_saturation_ratio:+(highSat/n*100).toFixed(1),rgb:[Math.round(sumR/n),Math.round(sumG/n),Math.round(sumB/n)]};
}

function makeCanvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
function area(poly){let a=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];a+=p.x*q.y-q.x*p.y}return Math.abs(a/2)}

function buildCycles(connections,landmarks,w,h){
  const adj=new Map();
  for(const e of connections){
    if(!adj.has(e.start))adj.set(e.start,[]);if(!adj.has(e.end))adj.set(e.end,[]);
    adj.get(e.start).push(e.end);adj.get(e.end).push(e.start);
  }
  const seenEdges=new Set(),cycles=[];
  const edgeKey=(a,b)=>a<b?`${a}-${b}`:`${b}-${a}`;
  for(const start of adj.keys()){
    for(const n0 of adj.get(start)){
      if(seenEdges.has(edgeKey(start,n0)))continue;
      const path=[start];let prev=start,cur=n0;seenEdges.add(edgeKey(prev,cur));
      let guard=0;
      while(guard++<200){
        path.push(cur);if(cur===start)break;
        const nexts=(adj.get(cur)||[]).filter(n=>n!==prev);
        let next=nexts.find(n=>!seenEdges.has(edgeKey(cur,n)));
        if(next===undefined)next=nexts[0];
        if(next===undefined)break;
        prev=cur;cur=next;seenEdges.add(edgeKey(prev,cur));
      }
      if(path.length>5 && path[path.length-1]===start){
        const uniq=path.slice(0,-1).map(i=>({x:landmarks[i].x*w,y:landmarks[i].y*h,index:i}));
        cycles.push(uniq);
      }
    }
  }
  const uniq=[]; const sig=new Set();
  for(const c of cycles){const s=c.map(p=>p.index).sort((a,b)=>a-b).join(',');if(!sig.has(s)){sig.add(s);uniq.push(c)}}
  return uniq.sort((a,b)=>area(b)-area(a));
}

export function createLipMask(landmarks,w,h){
  if(!mp) return null;
  const conns=mp.FaceLandmarker.FACE_LANDMARKS_LIPS;
  const cycles=buildCycles(conns,landmarks,w,h);
  const canvas=makeCanvas(w,h),ctx=canvas.getContext('2d');
  if(!cycles.length)return null;
  const draw=(poly)=>{ctx.beginPath();ctx.moveTo(poly[0].x,poly[0].y);for(let i=1;i<poly.length;i++)ctx.lineTo(poly[i].x,poly[i].y);ctx.closePath();ctx.fill()};
  ctx.fillStyle='#fff';draw(cycles[0]);
  if(cycles[1]){ctx.globalCompositeOperation='destination-out';draw(cycles[1]);ctx.globalCompositeOperation='source-over'}
  const blurred=makeCanvas(w,h),bctx=blurred.getContext('2d');bctx.filter='blur(1.6px)';bctx.drawImage(canvas,0,0);bctx.filter='none';
  return {canvas:blurred,cycles};
}

function faceBox(landmarks,w,h){
  const xs=landmarks.map(p=>p.x*w),ys=landmarks.map(p=>p.y*h);return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys),area:(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys))}
}
function patchMean(ctx,w,h,cx,cy,r=7){
  const x0=Math.max(0,Math.floor(cx-r)),y0=Math.max(0,Math.floor(cy-r)),x1=Math.min(w,Math.ceil(cx+r)),y1=Math.min(h,Math.ceil(cy+r));
  const d=ctx.getImageData(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0)).data;let rr=0,gg=0,bb=0,n=0;
  for(let i=0;i<d.length;i+=4){rr+=d[i];gg+=d[i+1];bb+=d[i+2];n++}return n?[rr/n,gg/n,bb/n]:null;
}
function meanRgb(arr){if(!arr.length)return null;return arr.reduce((a,v)=>[a[0]+v[0],a[1]+v[1],a[2]+v[2]],[0,0,0]).map(x=>Math.round(x/arr.length))}

export async function analyzeBitmap(bitmap,{useFace=true,statusCb=()=>{}}={}){
  const max=1000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));
  const canvas=makeCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,w,h);
  const overall=samplePixels(ctx,w,h);
  let face=null,lip=null,lipMask=null,faceColor=null,faces=0;
  if(useFace){
    try{
      const fl=await ensureFaceLandmarker(statusCb);const result=fl.detect(canvas);faces=result.faceLandmarks?.length||0;
      if(faces){
        let best=result.faceLandmarks[0],bestArea=0;
        for(const lm of result.faceLandmarks){const b=faceBox(lm,w,h);if(b.area>bestArea){bestArea=b.area;best=lm}}
        face=best;
        const m=createLipMask(best,w,h);if(m){lipMask=m.canvas;lip=samplePixels(ctx,w,h,lipMask)}
        const idx=[234,454,93,323,10,152].filter(i=>best[i]);
        const patches=idx.map(i=>patchMean(ctx,w,h,best[i].x*w,best[i].y*h,Math.max(5,Math.round(w*.008)))).filter(Boolean);
        faceColor=meanRgb(patches);
      }
    }catch(e){}
  }
  const lighting=overall.brightness>80?'明显偏亮/可能过曝':overall.brightness<28?'偏暗':overall.rgb[0]-overall.rgb[2]>22?'偏暖':overall.rgb[2]-overall.rgb[0]>22?'偏冷':'中性/混合光';
  const quality=(overall.brightness<20||overall.brightness>92)?'较低':faces&&lip?'较高':'可用';
  return {canvas,overall,lip,lipMask,face,faceColor,faces,lighting,quality,width:w,height:h};
}

export function applyVirtualLip(originalCanvas,mask,targetHue,targetSaturation=42){
  const out=makeCanvas(originalCanvas.width,originalCanvas.height),ctx=out.getContext('2d',{willReadFrequently:true});ctx.drawImage(originalCanvas,0,0);
  if(!mask)return out;
  const img=ctx.getImageData(0,0,out.width,out.height),m=mask.getContext('2d').getImageData(0,0,out.width,out.height).data;
  for(let i=0;i<img.data.length;i+=4){
    const alpha=m[i+3]/255;if(alpha<.03)continue;
    const r=img.data[i],g=img.data[i+1],b=img.data[i+2],hsv=rgbToHsv(r,g,b);
    if((hsv.v>77&&hsv.s<22)||hsv.v<13)continue;
    const sat=Math.max(hsv.s*.35,targetSaturation);const [nr,ng,nb]=hsvToRgb(targetHue,sat,hsv.v);
    const mix=.58*alpha;img.data[i]=Math.round(r*(1-mix)+nr*mix);img.data[i+1]=Math.round(g*(1-mix)+ng*mix);img.data[i+2]=Math.round(b*(1-mix)+nb*mix);
  }
  ctx.putImageData(img,0,0);return out;
}

export function canvasToHex(rgb){return '#'+rgb.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}