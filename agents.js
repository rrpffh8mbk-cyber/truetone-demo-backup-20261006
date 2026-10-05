import {detectLipLandmarks,createLipMask} from './lips.js';
export const ANALYSIS_KEYWORDS = ['偏暗','偏亮','偏粉','偏紫','偏红','偏橘','偏棕','色差','滤镜','原图','自然光','暖光','冷光','氧化','深唇','浅唇','薄涂','厚涂','显白','荧光','不一样','差距','假货','批次','素颜','无滤镜'];

export function circularHueDistance(a,b){const d=Math.abs(a-b)%360;return Math.min(d,360-d)}
export function rgbToHsv(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0;if(d){if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4)}if(h<0)h+=360;return [h,max?d/max*100:0,max*100]}
export function hsvToRgb(h,s,v){s/=100;v/=100;const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return [Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)]}
export function hsvToHex(h,s,v){const [r,g,b]=hsvToRgb(h,s,v);return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('')}

function loadImage(file){return new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=reject;img.src=url})}
function canvasURL(c,q=.82){return c.toDataURL('image/jpeg',q)}

export async function analyzeImageFile(file){
 const img=await loadImage(file);const scale=Math.min(1,720/Math.max(img.naturalWidth,img.naturalHeight));const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
 const base=document.createElement('canvas');base.width=w;base.height=h;const ctx=base.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);const data=ctx.getImageData(0,0,w,h);const px=data.data;
 let detection,roiReason='';
 try{detection=await detectLipLandmarks(base)}catch(e){roiReason='唇部识别暂不可用，请稍后重试。'}
 const mask=detection?.landmarks?createLipMask(detection.landmarks,w,h):null;
 const maskPixels=mask?.getContext('2d').getImageData(0,0,w,h).data;
 if(!mask&&!roiReason)roiReason='未识别到唇部，请上传正脸、嘴唇清晰的照片。';
 const isLip=i=>Boolean(maskPixels&&maskPixels[i+3]>=128&&px[i+3]>0);
 let sr=0,sg=0,sb=0,sv=0,ss=0,highSat=0,bright=0,dark=0;const hues=[];const cand=[];
 for(let i=0;i<px.length;i+=4){const r=px[i],g=px[i+1],b=px[i+2];sr+=r;sg+=g;sb+=b;const [H,S,V]=rgbToHsv(r,g,b);sv+=V;ss+=S;if(S>75)highSat++;if(V>80)bright++;if(V<30)dark++;if(isLip(i)){hues.push(H);cand.push([i,H,S,V])}}
 const n=px.length/4,sceneBrightness=sv/n,sceneSaturation=ss/n;let hue=0,sat=0,val=0;if(cand.length){let sx=0,sy=0;cand.forEach(x=>{sx+=Math.cos(x[1]*Math.PI/180);sy+=Math.sin(x[1]*Math.PI/180)});hue=(Math.atan2(sy,sx)*180/Math.PI+360)%360;const ss2=cand.map(x=>x[2]).sort((a,b)=>a-b),vv=cand.map(x=>x[3]).sort((a,b)=>a-b);sat=ss2[Math.floor(ss2.length/2)];val=vv[Math.floor(vv.length/2)]}else{hue=null;sat=null;val=null;roiReason=roiReason||'唇部区域过小，无法稳定分析。'}
 const warm=(sr/n)-(sb/n);let lighting='中性光';if(sceneBrightness>82)lighting='过曝';else if(sceneBrightness<28)lighting='偏暗';else if(warm>18)lighting='暖光';else if(warm<-12)lighting='冷光';
 let R=0;if(hues.length){let x=0,y=0;hues.forEach(v=>{x+=Math.cos(v*Math.PI/180);y+=Math.sin(v*Math.PI/180)});R=Math.sqrt(x*x+y*y)/hues.length}const hueStd=R>0?Math.sqrt(Math.max(0,-2*Math.log(R)))*180/Math.PI:180;
 const metrics={width:w,height:h,roiDetected:cand.length>0,roiSource:cand.length?'mediapipe-lips':'unavailable',roiReason,faces:detection?.faces||0,hue:hue===null?null:+hue.toFixed(1),saturation:sat===null?null:+sat.toFixed(1),brightness:val===null?null:+val.toFixed(1),sceneBrightness:+sceneBrightness.toFixed(1),sceneSaturation:+sceneSaturation.toFixed(1),highSaturationRatio:+(highSat/n*100).toFixed(1),brightRatio:+(bright/n*100).toFixed(1),darkRatio:+(dark/n*100).toFixed(1),hueStd:+hueStd.toFixed(1),candidateRatio:+(cand.length/n*100).toFixed(1),lighting};
 const roi=document.createElement('canvas'),satC=document.createElement('canvas'),briC=document.createElement('canvas'),combo=document.createElement('canvas');[roi,satC,briC,combo].forEach(c=>{c.width=w;c.height=h});
 const roiD=roi.getContext('2d').createImageData(w,h),satD=satC.getContext('2d').createImageData(w,h),briD=briC.getContext('2d').createImageData(w,h),comD=combo.getContext('2d').createImageData(w,h);
 for(let i=0;i<px.length;i+=4){const r=px[i],g=px[i+1],b=px[i+2];const [H,S,V]=rgbToHsv(r,g,b);const isCand=isLip(i);for(const d of [roiD,satD,briD,comD])d.data[i+3]=255;roiD.data[i]=isCand?r:Math.round(r*.18);roiD.data[i+1]=isCand?g:Math.round(g*.18);roiD.data[i+2]=isCand?b:Math.round(b*.18);const heatS=Math.round(S/100*255);satD.data[i]=heatS;satD.data[i+1]=Math.round(55*(1-S/100));satD.data[i+2]=255-heatS;const heatB=Math.round(V/100*255);briD.data[i]=heatB;briD.data[i+1]=heatB;briD.data[i+2]=heatB;comD.data[i]=isCand?Math.min(255,r+35):Math.round(r*.35);comD.data[i+1]=isCand?Math.round(g*.85):Math.round(g*.35);comD.data[i+2]=isCand?Math.round(b*.85):Math.round(b*.35)}
 roi.getContext('2d').putImageData(roiD,0,0);satC.getContext('2d').putImageData(satD,0,0);briC.getContext('2d').putImageData(briD,0,0);combo.getContext('2d').putImageData(comD,0,0);
 return {fileName:file.name,metrics,views:{original:canvasURL(base),roi:canvasURL(roi),saturation:canvasURL(satC),brightness:canvasURL(briC),composite:canvasURL(combo)}};
}

export function runFourAgents(analyses,product=null){
 const findings=[];let penalty=0;
 analyses.forEach((a,idx)=>{const m=a.metrics;const add=(type,severity,points,evidence,impact)=>{findings.push({type,severity,imageIndex:idx,evidence,impact});penalty+=points};if(m.saturation>75)add('试色区域高饱和','medium',2,`候选色区饱和度 ${m.saturation}%`,'可能让颜色看起来更鲜艳');if(m.sceneBrightness>80)add('画面过曝/提亮','medium',2,`整体亮度 ${m.sceneBrightness}%`,'可能削弱深色与灰调');if(m.sceneBrightness<30)add('画面偏暗','low',1,`整体亮度 ${m.sceneBrightness}%`,'可能让颜色看起来更深');if(m.roiDetected!==false&&m.hueStd>120)add('色相异常分散','high',4,`色相离散度 ${m.hueStd}°`,'当前图不适合作为稳定色彩参考');if(m.highSaturationRatio>70)add('大面积高饱和','medium',2,`${m.highSaturationRatio}% 像素为高饱和`,'存在增强视觉冲击的可能');if(m.lighting==='暖光'||m.lighting==='冷光')add('明显色温影响','low',1,m.lighting,`可能使口红整体${m.lighting==='暖光'?'更橘/更棕':'更冷/更紫'}`)});
 const lipAnalyses=analyses.filter(a=>a.metrics.roiDetected!==false);
 analyses.forEach((a,idx)=>{if(a.metrics.roiDetected===false)findings.push({type:'唇部区域未识别',severity:'low',imageIndex:idx,evidence:a.metrics.roiReason,impact:'无法判断唇色差异，请上传嘴唇清晰的正脸照片'})});
 if(lipAnalyses.length>1){const s=lipAnalyses.map(x=>x.metrics.saturation),v=lipAnalyses.map(x=>x.metrics.brightness),h=lipAnalyses.map(x=>x.metrics.hue);const sd=Math.max(...s)-Math.min(...s),vd=Math.max(...v)-Math.min(...v);let hd=0;for(let i=0;i<h.length;i++)for(let j=i+1;j<h.length;j++)hd=Math.max(hd,circularHueDistance(h[i],h[j]));if(sd>30){findings.push({type:'跨图饱和度差异',severity:'medium',evidence:`最大差异 ${sd.toFixed(1)}%`,impact:'不同图片的鲜艳程度不一致'});penalty+=4}if(vd>35){findings.push({type:'跨图亮度差异',severity:'medium',evidence:`最大差异 ${vd.toFixed(1)}%`,impact:'不同拍摄条件可能影响颜色判断'});penalty+=4}if(hd>60){findings.push({type:'跨图色相差异',severity:'high',evidence:`最大环形色相差异 ${hd.toFixed(1)}°`,impact:'建议不要仅参考其中一张图片'});penalty+=8}}
 if(product&&analyses.length){const c=product.analysis.center;analyses.forEach((a,idx)=>{if(a.metrics.roiDetected===false)return;const d=circularHueDistance(a.metrics.hue,c.hue);if(d>60){findings.push({type:'与多来源参考色域偏离',severity:'medium',imageIndex:idx,evidence:`与当前 TrueTone 色域中心相差 ${d.toFixed(1)}°`,impact:'该图片不宜单独作为购买依据'});penalty+=2}})}
 const score=Math.max(25,Math.min(95,82-penalty));const high=findings.filter(x=>x.severity==='high').length,med=findings.filter(x=>x.severity==='medium').length;
 let summary='当前图片可作为辅助参考，但建议结合多来源证据。';if(!findings.length)summary='当前未发现明显的高风险视觉异常；仍建议结合不同光照与相似唇色用户的真实返图。';else if(high)summary='当前证据中存在较明显的跨图或色彩异常，不建议只依赖这些图片做购买判断。';else if(med>=2)summary='当前存在若干可能影响色彩判断的因素，建议优先参考自然光、低偏差样本。';
 if(!lipAnalyses.length)summary='未能识别唇部，当前仅分析整图光照；无法判断唇色是否可信。';
 const suggestions=[];if(findings.some(x=>x.type.includes('饱和')))suggestions.push({title:'降低后期饱和度',why:'当前检测到较高饱和或跨图饱和差异',impact:'减少试色图对真实颜色的视觉夸张'});if(findings.some(x=>x.type.includes('过曝')||x.type.includes('色温')||x.type.includes('亮度')))suggestions.push({title:'使用标准中性光源',why:'当前图片存在亮度或色温差异',impact:'减少不同内容间的色相与明暗偏移'});if(analyses.length>1)suggestions.push({title:'统一拍摄条件',why:'多图比较需要可比的光照与曝光',impact:'提高跨图一致性与可解释性'});suggestions.push({title:'标注拍摄条件与素唇参考',why:'消费者需要理解色差来自哪里',impact:'帮助区分个体差异与内容失真'});
 return {score:lipAnalyses.length?score:null,findings,summary,suggestions,confidence:lipAnalyses.length?Math.max(45,Math.min(96,55+lipAnalyses.length*8-findings.filter(x=>x.severity==='high').length*4)):0};
}

export function buildProductConsumerSummary(product,lipProfile='all'){
 const a=product.analysis||{};const media=product.media||[];const allReviews=product.reviews||[];
 const top=media.filter(m=>(a.topMediaIds||[]).includes(m.id)).sort((x,y)=>(y.referenceScore||0)-(x.referenceScore||0));
 const reviews=allReviews.filter(r=>(a.representativeReviewIds||[]).includes(r.id));
 const filtered=lipProfile==='all'?reviews:reviews.filter(r=>(r.text||'').includes(lipProfile));
 const chosen=(filtered.length?filtered:reviews).slice(0,8);
 const diff=a.platformDiff||{hue:0,saturation:0,brightness:0},kw=a.keywordCounts||{},normal=[];
 if(kw['深唇']||kw['浅唇'])normal.push('不同原生唇色会改变显色，深唇与浅唇反馈应分开看');
 if(kw['薄涂']||kw['厚涂'])normal.push('薄涂与厚涂会改变明度、饱和度和覆盖力');
 if(kw['氧化'])normal.push('部分用户提到氧化/成膜后的颜色变化');
 if(kw['自然光']||kw['暖光'])normal.push('光照条件会改变照片中的冷暖与明暗');
 let conclusion='当前多来源视觉样本整体较接近，可作为辅助参考。';
 if(diff.hue>35)conclusion='不同平台间存在明显色相差异，建议优先看高参考分的真实返图。';
 else if(Math.abs(diff.brightness)>15)conclusion='两类来源的亮度存在一定差异，颜色本身较接近，但不要把曝光差异当成色号差异。';
 if(product.key==='lancome-274'&&(product.skuLines||[]).length>1)conclusion+=' 同为 274 的不同产品线需要分开比较。';
 if(product._summaryOnly)conclusion+=' 当前公开页已载入完整聚合统计；逐条评论与原始高分辨率媒体将在安全数据层接入后展开。';
 return {conclusion,top:top.slice(0,3),reviews:chosen,normal};
}
