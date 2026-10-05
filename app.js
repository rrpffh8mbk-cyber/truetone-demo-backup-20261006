import {analyzeImageFile,runFourAgents,buildProductConsumerSummary,hsvToHex,ANALYSIS_KEYWORDS,circularHueDistance} from './agents.js';
import {createVirtualTryOn} from './tryon.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const app=$('#app'),toast=$('#toast'),modal=$('#modal-backdrop'),modalContent=$('#modal-content');
// Defensive initial state: never allow the modal overlay to block the app on first paint.
modal.style.display='none';modal.style.pointerEvents='none';modal.hidden=true;modal.setAttribute('aria-hidden','true');
let manifest, evidenceCatalog, referenceDistributions, cache=new Map(), cloudCache=new Map(), verifyFiles=[], verifyAnalyses=[], selfieFile=null, selfieResult=null, purchaseTargetKey=null, seededFiles=[];
const USER_TAG_SCHEMA={lip:['浅唇','中唇','深唇'],skin:['白皙偏冷','白皙偏暖','自然黄调','自然中性','橄榄调','健康深肤'],makeup:['素颜','淡妆','浓妆'],lighting:['自然光','室内暖光','室内冷光','混合光','不确定'],application:['薄涂','正常涂','厚涂','不确定'],source_platform:['小红书','淘宝','官方','其他']};
const PARTS={'ysl-610':4,'ysl-1936':4,'lancome-274':0,'lancome-275':0};
const FALLBACK_REVIEWS={
 'lancome-274':[
  {platform:'小红书',type:'正文',text:'兰蔻274经典奶茶色真香。刚上嘴我一直觉得太棕，但等成膜/氧化后颜色会变浅、更奶茶；深唇要谨慎，和YSL 610相比更厚重。',negativeEvidence:true},
  {platform:'小红书',type:'正文',text:'浅奶茶调刚上嘴几乎融唇，素颜时一度觉得没气色；现在更偏爱淡妆后，反而觉得薄涂温柔、低饱和、日常通勤很合适。'},
  {platform:'淘宝',type:'评价',text:'274颜色和实物相差比较大，我这里呈现得更暗、更土，是一次踩雷体验。',sku:'「声色」限定#274[原声裸茶]；基本款',negativeEvidence:true},
  {platform:'淘宝',type:'评价',text:'274奶茶裸低饱和，素颜薄涂提气色，淡妆厚涂更有氛围感。',sku:'兰蔻粉金管唇膏#274'},
  {platform:'小红书',type:'正文',text:'网上产品图和拿到手差别会很大；我本身唇色很淡又偏干，274在我这里很提气色。',negativeEvidence:true},
  {platform:'淘宝',type:'问大家回答',text:'我买过274唇釉，在我这里并不合适；不同人上嘴差异很明显。',repeatBuyer:true,negativeEvidence:true}
 ],
 'lancome-275':[
  {platform:'淘宝',type:'评价',text:'之前买过274，这次尝试275；刚擦上去颜色还好，但很快会氧化发暗，掉色也比较明显。',sku:'兰蔻菁纯裸唇釉#275 法式裸茶',repeatBuyer:true,negativeEvidence:true},
  {platform:'小红书',type:'正文',text:'用唇刷把275晕染开后更接近广告里的裸色，带大地色系奶茶调；覆盖力可以，深唇也能遮一些。',negativeEvidence:true},
  {platform:'淘宝',type:'评价',text:'本人浅唇，275涂出来和广告颜色比较接近，没有很偏橘，掉色也不是很严重。',sku:'兰蔻菁纯裸唇釉#275 法式裸茶'},
  {platform:'淘宝',type:'问大家回答',text:'275更适合素颜；如果想要更浓一些的显色，可以考虑其他方向。'},
  {platform:'淘宝',type:'问大家回答',text:'我是深唇，带妆会更好看一点；无美颜无滤镜，只看颜色，希望能帮到你。',negativeEvidence:true},
  {platform:'小红书',type:'正文',text:'我这里素颜效果并不好，而且偏拔干；网上很多好评不一定适合每个人。',negativeEvidence:true}
 ]};
const fmt=n=>new Intl.NumberFormat('zh-CN').format(n||0);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const shadeTarget=p=>p.tryOnColor||p.analysis.center; const color=p=>{const c=shadeTarget(p);return hsvToHex(c.hue,c.saturation,c.brightness)};
function toastMsg(s){toast.textContent=s;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),1900)}
async function ungzipB64(parts){const txt=(await Promise.all(parts.map(u=>fetch(u).then(r=>{if(!r.ok)throw Error('数据文件未部署完整');return r.text()})))).join('').trim();const bin=Uint8Array.from(atob(txt),c=>c.charCodeAt(0));if(!('DecompressionStream'in window))throw Error('当前浏览器不支持数据解压，请使用最新版 Chrome / Edge / Safari');const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text())}
async function getManifest(){if(manifest)return manifest;manifest=await fetch('./data/manifest.json').then(r=>r.json());return manifest}
async function getEvidenceCatalog(){if(evidenceCatalog)return evidenceCatalog;try{evidenceCatalog=await fetch('./data/catalog/evidence_claims_v1.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)}catch(_){evidenceCatalog=null}return evidenceCatalog}
async function getReferenceDistributions(){if(referenceDistributions)return referenceDistributions;try{referenceDistributions=await fetch('./data/catalog/reference_distributions_v1.json',{cache:'no-store'}).then(r=>r.ok?r.json():null)}catch(_){referenceDistributions=null}return referenceDistributions}
function summaryFallback(k){
 const m=manifest.products.find(x=>x.key===k);
 if(!m)throw Error('未找到该色号数据');
 const ids=m.analysis?.topMediaIds||[];
 const media=ids.map((id,i)=>{
   const platform=id.startsWith('xhs-')?'小红书':'淘宝';
   const pm=m.analysis?.platform?.[platform]||m.analysis?.center||{hue:0,saturation:0,brightness:50};
   return {id,platform,type:'离线真实试色记录',thumb:null,referenceScore:Math.max(60,92-i*2),
     metrics:{hue:pm.hue,saturation:pm.saturation,brightness:pm.brightness,sceneBrightness:pm.brightness,lighting:'媒体记录',dominant:hsvToHex(pm.hue,pm.saturation,pm.brightness)},
     reasons:['该媒体 ID 来自完整离线数据的 Top reference 排名；原始高清文件将在阿里云 OSS 数据层展示']};
 });
 const reviews=(FALLBACK_REVIEWS[k]||[]).map((r,i)=>({id:`fallback-${k}-${i+1}`,...r,genericTemplate:false}));
 return {...m,media,reviews,asks:[],_summaryOnly:true};
}
async function getProduct(k){
 if(cache.has(k))return cache.get(k);
 const n=PARTS[k]||0;
 if(!n){const p=summaryFallback(k);cache.set(k,p);return p}
 const urls=Array.from({length:n},(_,i)=>`./data/full/${k}.${i+1}.b64`);
 const p=await ungzipB64(urls);cache.set(k,p);return p
}
function meta(k){return manifest.products.find(x=>x.key===k)}
function page(x){app.innerHTML=`<div class="page">${x}</div>`;window.scrollTo(0,0)}
function go(h){location.hash=h}
function shadeCard(p){return `<a class="shade-card" href="#/shade/${p.key}"><div><div class="shade-brand">${esc(p.brand)}</div><div class="shade-code">#${p.shade}</div><div class="shade-name">${esc(p.name)} · ${esc(p.product)}</div><div class="shade-meta"><span class="mini-chip">${p.analysis.counts.visual} 份视觉素材</span><span class="mini-chip">${p.analysis.counts.text} 条文字证据</span><span class="mini-chip">证据充分度 ${p.analysis.evidenceSufficiency}</span></div></div><div class="shade-swatch" style="background:radial-gradient(circle at 38% 35%,${color(p)} 0,#6b352e 48%,#271715 100%)"></div></a>`}
function opts(sel){return manifest.products.map(p=>`<option value="${p.key}" ${p.key===sel?'selected':''}>${esc(p.brand)} #${p.shade} ${esc(p.name)}</option>`).join('')}
function highlight(t){let s=esc(t);for(const k of ANALYSIS_KEYWORDS)s=s.replaceAll(k,`<mark class="highlight">${k}</mark>`);return s}
function reviewCard(r){return `<article class="review"><p>${highlight(r.text)}</p><small><span>${r.platform}</span><span>${r.type||'评论'}</span>${r.sku?`<span>${esc(r.sku)}</span>`:''}${r.repeatBuyer?'<span>复购线索</span>':''}${r.negativeEvidence?'<span>含负向体验</span>':''}</small></article>`}
async function fetchCloudReferenceMedia(productKey){
 const api=(window.TRUETONE_CONFIG?.apiBase||'').replace(/\/$/,'');if(!api)return [];
 const cacheKey='truetone-media:'+productKey;
 try{
   const saved=sessionStorage.getItem(cacheKey),parsed=saved&&JSON.parse(saved);
   if(parsed?.savedAt&&Date.now()-parsed.savedAt<5*60*1000&&Array.isArray(parsed.value)&&parsed.value.length)return parsed.value;
 }catch(_){}
 for(let attempt=0;attempt<2;attempt++){
   try{
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
     const r=await fetch(api+'/api/media?product_key='+encodeURIComponent(productKey),{cache:'no-store',signal:controller.signal});
     clearTimeout(timer);
     if(!r.ok)throw Error('HTTP '+r.status);
     const out=await r.json(),media=Array.isArray(out?.media)?out.media.filter(x=>x&&x.url).slice(0,3):[];
     if(media.length){try{sessionStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now(),value:media}))}catch(_){};return media}
   }catch(e){
     console.warn('Reference image attempt '+(attempt+1)+' unavailable',e);
     if(attempt===0)await wait(300);
   }
 }
 return [];
}
function cloudReferenceCard(m,i){
 const platform=esc(m.platform||'真实来源'),label=esc(m.label||'真实试色参考'),reason=esc(m.reason||'来自已核验的真实样本，用于辅助购买判断。');
 return `<article class="media-card cloud-media-card" data-cloud-url="${esc(m.url)}">
   <div class="cloud-thumb-wrap"><img src="${esc(m.url)}" alt="${platform}真实试色参考 ${i+1}" loading="lazy" referrerpolicy="no-referrer"><span class="media-source-badge">${platform} · OSS真实样本</span></div>
   <div class="media-card-body"><div class="rank">#${i+1} · 真实样本</div><div class="source-line">${label}</div><div class="reason">${reason}</div></div>
 </article>`;
}

function mediaCard(m,i){const score=Number.isFinite(m.referenceScore)?Math.round(m.referenceScore)+'/100':'优先参考';return `<article class="media-card" data-media="${m.id}">${m.thumb?`<img src="${m.thumb}" alt="真实试色参考图 ${i+1}">`:'<div class="skeleton media-placeholder" style="height:210px"><span>真实媒体记录<br><small>图片暂时没有加载出来</small></span></div>'}<div class="media-card-body"><div class="rank">#${i+1} · ${score}</div><div class="source-line">${m.platform} · ${m.metrics?.lighting||m.type}</div><div class="reason">${esc((m.reasons||[])[0]||'接近多来源参考色域')}</div></div></article>`}
function metric(label,v,max=100,u='%'){return `<div class="metric-row"><label>${label}</label><div class="bar"><i style="width:${Math.min(100,Math.abs(v)/max*100)}%"></i></div><span>${Number(v).toFixed(1)}${u}</span></div>`}
function evidenceScoreText(a){return `视觉 ${a.counts.images} 图 + ${a.counts.videos} 视频元数据 · 文字 ${fmt(a.counts.text)} 条 · ${a.counts.sources} 类来源`}
function creatorAdviceForProduct(p){
 const a=p.analysis||{},kw=a.keywordCounts||{},out=[];
 const add=(title,issue,how,why,impact)=>out.push({title,issue,how,why,impact});
 if((a.findings||[]).some(f=>/过曝|明暗/.test(f.type)))add('统一拍摄曝光','当前样本存在明暗/曝光异常','使用中性、稳定光源并锁定曝光','减少明暗变化被消费者误读成色号差异','提高跨内容可比性');
 if((a.findings||[]).some(f=>/饱和/.test(f.type)))add('减少非必要增饱和','部分样本浓淡偏离主要色域','保留无滤镜原图并标注后期处理','降低颜色被视觉强化的风险','让消费者更容易判断真实显色范围');
 if(kw['深唇']||kw['浅唇'])add('补充素唇与唇色背景','消费者反馈显示原生唇色会影响呈现','增加素唇对比，并标注浅唇/深唇','避免把个体差异误解为内容失真','让相似唇色用户更快找到可参考证据');
 if(kw['薄涂']||kw['厚涂'])add('同时展示薄涂 / 厚涂','数据中存在不同涂抹厚度的描述','同一光线下并列展示薄涂与厚涂','控制涂抹厚度这一影响变量','减少“为什么和博主不一样”的误差');
 if(kw['氧化'])add('补充成膜/氧化后效果','消费者反馈提到上嘴后颜色变化','增加刚涂与成膜一段时间后的对比','让购买者看到时间维度上的正常变化','降低到手后的预期落差');
 add('标注拍摄条件','社媒与电商图片来源和环境不完全一致','注明自然光/暖光/冷光、设备与是否滤镜','帮助消费者区分拍摄环境与产品本身差异','提升内容透明度与信任');
 return out.slice(0,5);
}


function reviewPersonalScore(r,profile){
 const t=(r.text||'');let s=0;
 if(profile.lip&&t.includes(profile.lip))s+=10;
 if(profile.makeup==='素颜'&&t.includes('素颜'))s+=7;
 if(profile.makeup==='淡妆'&&/淡妆|日常|通勤/.test(t))s+=6;
 if(profile.makeup==='浓妆'&&/浓妆|完整妆|厚涂|带妆/.test(t))s+=6;
 const skinMap={'白皙偏冷':/冷白|白皙|白皮/,'白皙偏暖':/暖白|白皙|白皮/,'自然黄调':/黄皮|黄调/,'自然中性':/中性皮|自然肤色/,'橄榄调':/橄榄皮|橄榄调/,'健康深肤':/深肤|健康肤色/};
 if(skinMap[profile.skin]?.test(t))s+=8;
 if(r.repeatBuyer)s+=4;if(r.negativeEvidence)s+=4;if(r.genericTemplate)s-=7;
 s+=Math.min(5,t.length/60);return s;
}
function personalizedReviews(p,profile){
 const arr=(p.reviews||[]).filter(r=>r.text&&!r.genericTemplate).map(r=>({r,s:reviewPersonalScore(r,profile)})).sort((a,b)=>b.s-a.s);
 return arr.slice(0,3).map(x=>x.r);
}
function personalizedMedia(p,selfie){
 const light=selfie?.light?.label||'中性光',b=selfie?.light?.brightness??60;
 return (p.media||[]).filter(m=>m.metrics).map(m=>{
   let s=Number.isFinite(m.referenceScore)?m.referenceScore:72;
   const ml=m.metrics.lighting||'中性光';if(ml===light)s+=5;else if(['暖光','冷光'].includes(ml))s-=3;
   s-=Math.min(10,Math.abs((m.metrics.sceneBrightness??m.metrics.brightness??60)-b)*.12);
   return {...m,personalScore:Math.max(25,Math.min(99,s))};
 }).sort((a,b)=>b.personalScore-a.personalScore).slice(0,3);
}
function personalMatchScore(p,selfie,profile,reviews){
 let s=66;const a=p.analysis||{},kw=a.keywordCounts||{};
 if(a.evidenceSufficiency==='高')s+=7;
 if((a.platformDiff?.hue??99)<12)s+=5;
 if(selfie?.light?.label==='中性光')s+=4;
 if(profile.lip&&kw[profile.lip])s+=6;
 if(profile.makeup==='素颜'&&kw['素颜'])s+=5;
 if(profile.makeup==='淡妆'&&(kw['薄涂']||kw['素颜']))s+=3;
 if(profile.makeup==='浓妆'&&kw['厚涂'])s+=4;
 if(reviews.length>=3)s+=4;
 return Math.round(Math.max(45,Math.min(94,s)));
}
function expectedAppearance(p,selfie){
 const c=shadeTarget(p),light=selfie.light||{label:'中性光',brightness:60};
 const b=Math.max(5,Math.min(95,c.brightness+(light.brightness-60)*.12));
 let tone='接近多来源参考色域';if(light.label==='暖光')tone='在当前暖光下可能更偏橘/棕';if(light.label==='冷光')tone='在当前冷光下可能更偏冷/紫';if(light.label==='偏暗')tone='当前照片偏暗，实际上嘴可能比预览更亮';
 return {h:c.hue,s:c.saturation,b:+b.toFixed(1),tone};
}
async function callCloudAgent(p,profile,selfie,reviews,match){
 const api=(window.TRUETONE_CONFIG?.apiBase||'').replace(/\/$/,'');if(!api)return null;
 const evidence={
  product:{key:p.key,brand:p.brand,shade:p.shade,name:p.name,product:p.product,texture:p.texture,skuLines:p.skuLines||[]},
  trust_score:p.analysis.score,evidence_sufficiency:p.analysis.evidenceSufficiency,
  counts:p.analysis.counts,platform_diff:p.analysis.platformDiff,keyword_counts:p.analysis.keywordCounts,
  representative_reviews:reviews.map(r=>({platform:r.platform,type:r.type,text:r.text,sku:r.sku||'',repeatBuyer:!!r.repeatBuyer,negativeEvidence:!!r.negativeEvidence})),
  deterministic_match_score:match
 };
 const payload={product_key:p.key,profile,selfie_features:{light:selfie.light,faceRef:selfie.faceRef},evidence};
 const cacheKey='truetone-cloud:'+JSON.stringify([p.key,profile,selfie.light?.label,Math.round(selfie.light?.brightness||0),match]);
 if(cloudCache.has(cacheKey))return cloudCache.get(cacheKey);
 try{
   const saved=sessionStorage.getItem(cacheKey);
   if(saved){const parsed=JSON.parse(saved);if(parsed?.savedAt&&Date.now()-parsed.savedAt<30*60*1000){cloudCache.set(cacheKey,parsed.value);return parsed.value}}
 }catch(_){}
 try{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
   const r=await fetch(api+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal,cache:'no-store'});
   clearTimeout(timer);
   if(!r.ok)throw Error('HTTP '+r.status);
   const out=await r.json();
   if(!out||out.error)throw Error(out?.error||'incomplete cloud result');
   cloudCache.set(cacheKey,out);
   try{sessionStorage.setItem(cacheKey,JSON.stringify({savedAt:Date.now(),value:out}))}catch(_){}
   return out;
 }catch(e){
   console.warn('Cloud Agent unavailable; stable local result will be used.',e);
   return null;
 }
}

function normalizeTargetInput(s){
 return String(s||'')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .toLowerCase()
  .replace(/[＃#\s·._\-\/\\()（）【】\[\],，:：'"“”‘’]/g,'');
}
function brandAliasesForProduct(p){
 if(p.key.startsWith('ysl-'))return ['ysl','圣罗兰','saintlaurent','yvessaintlaurent','yslbeauty'];
 if(p.key.startsWith('lancome-'))return ['lancome','兰蔻'];
 return [p.brand||''];
}
function shadeAliasesForProduct(p){
 return [p.shade,p.name,...(p.shadeAliases||[]),...(p.skuLines||[])]
  .map(normalizeTargetInput)
  .filter(Boolean);
}
function tokenMatches(input,tokens){
 if(!input)return false;
 return tokens.some(t=>t&&(input===t||input.includes(t)||t.includes(input)));
}
function resolveDemoProduct(brandRaw,shadeRaw){
 const brandInput=normalizeTargetInput(brandRaw);
 const shadeInput=normalizeTargetInput(shadeRaw);
 const combined=normalizeTargetInput(String(brandRaw||'')+' '+String(shadeRaw||''));

 const scored=manifest.products.map(p=>{
   const brandAliases=brandAliasesForProduct(p).map(normalizeTargetInput);
   const shadeAliases=shadeAliasesForProduct(p);

   const brandHit=tokenMatches(brandInput,brandAliases);
   const shadeHit=tokenMatches(shadeInput,shadeAliases);
   const combinedBrandHit=tokenMatches(combined,brandAliases);
   const combinedShadeHit=tokenMatches(combined,shadeAliases);

   let score=0;
   if(brandHit)score+=4;
   if(shadeHit)score+=6;
   if(combinedBrandHit)score+=2;
   if(combinedShadeHit)score+=3;

   // Exact shade number is the strongest signal in this 4-product Demo.
   const exactShade=normalizeTargetInput(p.shade);
   if(shadeInput===exactShade||combined.includes(exactShade))score+=8;

   return {p,score,brandHit:brandHit||combinedBrandHit,shadeHit:shadeHit||combinedShadeHit};
 }).filter(x=>x.shadeHit&&x.score>0).sort((a,b)=>b.score-a.score);

 if(!scored.length)return null;

 // If the user entered a brand, require that it resolves to the same product family.
 if(brandInput){
   const branded=scored.filter(x=>x.brandHit);
   if(branded.length===1)return branded[0].p;
   if(branded.length>1&&branded[0].score>branded[1].score)return branded[0].p;
   return null;
 }

 // Shade-only input is allowed when it uniquely identifies one Demo product (e.g. 274).
 const uniqueKeys=[...new Set(scored.map(x=>x.p.key))];
 if(uniqueKeys.length===1)return scored[0].p;

 // Combined free text such as "ysl610" / "圣罗兰610" is also accepted.
 const combinedBranded=scored.filter(x=>x.brandHit);
 if(combinedBranded.length===1)return combinedBranded[0].p;

 return null;
}
function detectBrandOnly(brandRaw){
 const b=normalizeTargetInput(brandRaw);
 if(!b)return null;
 const groups=[
  {id:'ysl',label:'圣罗兰 YSL',aliases:['ysl','圣罗兰','saintlaurent','yvessaintlaurent','yslbeauty']},
  {id:'lancome',label:'兰蔻 Lancôme',aliases:['lancome','兰蔻']}
 ];
 return groups.find(g=>tokenMatches(b,g.aliases.map(normalizeTargetInput)))||null;
}

function getUserProfile(){
 try{
  const x=JSON.parse(sessionStorage.getItem('truetone-user-profile')||'null');
  if(x&&x.lip&&x.skin&&x.makeup)return x;
 }catch(_){}
 return null;
}
function saveUserProfile(p){sessionStorage.setItem('truetone-user-profile',JSON.stringify(p))}
function profileSummary(p){
 if(!p)return '尚未填写';
 return [p.lip,p.skin,p.makeup].filter(Boolean).join(' · ');
}
function profileOption(values,selected=''){return '<option value="">请选择</option>'+values.map(v=>'<option '+(v===selected?'selected':'')+'>'+esc(v)+'</option>').join('')}
function renderProfileChips(p){return '<span>'+esc(p.lip)+'</span><span>'+esc(p.skin)+'</span><span>'+esc(p.makeup)+'</span>'}

async function home(){
 await getManifest();selfieFile=null;selfieResult=null;purchaseTargetKey=null;seededFiles=[];
 const saved=getUserProfile();
 page(`
 <section class="consumer-hero gateway-hero">
   <div class="eyebrow">TRUETONE · TRUST FIRST, THEN FIT</div>
   <h1>先认识你，<br>再决定什么值得相信。</h1>
   <p>同一支口红，在不同唇色、肤色和妆面上可能完全不同。TrueTone 先记录你主动提供的使用条件，再判断一条种草内容是否值得参考，或帮你从真实样本里找到更接近你的试色。</p>
 </section>

 <section class="profile-onboarding panel-soft">
   <div class="step-num">01</div>
   <div class="step-copy"><div class="eyebrow">先告诉我们一点关于你</div><h2>你的真实使用条件</h2><p>这些信息只用于匹配真实样本；不会从自拍推断种族、年龄或身份。</p></div>
   <div class="profile-fields profile-first">
     <label>原生唇色<select id="profile-lip" class="select">${profileOption(USER_TAG_SCHEMA.lip,saved?.lip||'')}</select></label>
     <label>肤色表现<select id="profile-skin" class="select">${profileOption(USER_TAG_SCHEMA.skin,saved?.skin||'')}</select></label>
     <label>平时妆面<select id="profile-makeup" class="select">${profileOption(USER_TAG_SCHEMA.makeup,saved?.makeup||'')}</select></label>
   </div>
   <button class="primary-btn profile-save" id="profile-save" disabled>${saved?'更新我的信息':'保存并继续'}</button>
 </section>

 <section class="gateway-question ${saved?'':'hidden'}" id="gateway-question">
   <div class="eyebrow">02 · 从你的真实购买场景出发</div>
   <h2>你最近有被一支口红种草到吗？</h2>
   <p>两条路径共用同一个真实样本库、评论证据和 TrueTone 可信度逻辑。</p>
   <div class="gateway-cards">
    <button class="gateway-card" id="gateway-seeded">
      <span class="gateway-index">A</span><b>有，我看到了一条很心动的种草</b>
      <small>上传种草图片和/或文字，看看它到底值不值得作为你的购买参考。</small>
      <em>帮我鉴别这条种草 →</em>
    </button>
    <button class="gateway-card" id="gateway-selfie">
      <span class="gateway-index">B</span><b>还没有，我想从自己开始选</b>
      <small>上传自拍与目标色号，从可信真实样本中寻找更接近你的参考。</small>
      <em>从自拍开始 →</em>
    </button>
   </div>
 </section>
 `);
 const lip=$('#profile-lip'),skin=$('#profile-skin'),makeup=$('#profile-makeup'),save=$('#profile-save'),question=$('#gateway-question');
 const update=()=>save.disabled=!(lip.value&&skin.value&&makeup.value);
 [lip,skin,makeup].forEach(x=>x.onchange=update);update();
 save.onclick=()=>{
   const p={lip:lip.value,skin:skin.value,makeup:makeup.value};
   saveUserProfile(p);save.textContent='已保存';question.classList.remove('hidden');question.scrollIntoView({behavior:'smooth',block:'center'});
 };
 if(saved){question.classList.remove('hidden')}
 $('#gateway-seeded').onclick=()=>{if(!getUserProfile())return toastMsg('请先填写你的使用条件');go('/seeded')};
 $('#gateway-selfie').onclick=()=>{if(!getUserProfile())return toastMsg('请先填写你的使用条件');go('/selfie')};
}

async function selfieHome(){
 await getManifest();selfieFile=null;selfieResult=null;
 const profile=getUserProfile();if(!profile){go('/');return}
 page(`
 <section class="route-head consumer-route-head"><div><div class="eyebrow">从自己开始选</div><h1>看看这支口红对你有多大参考价值</h1><p>先上传自拍，再告诉 TrueTone 你正在考虑的色号。我们会先筛选可信内容，再找与你条件更接近的真实参考。</p></div><a href="#/" class="ghost-btn">修改我的信息</a></section>
 <div class="profile-summary-bar"><b>你的条件</b>${renderProfileChips(profile)}</div>
 <section class="consumer-builder">
   <div class="builder-step">
     <div class="step-num">01</div>
     <div class="step-copy"><div class="eyebrow">上传当前自拍</div><h2>让我们看到当前光线下的你</h2><p>优先使用自然光、无滤镜、正脸、嘴唇清晰的照片。自拍只在当前浏览器内用于本次预览。</p></div>
     <label class="selfie-uploader" id="consumer-selfie-zone" for="consumer-selfie-input">
       <input id="consumer-selfie-input" class="native-image-input" type="file" accept="image/*">
       <div id="consumer-selfie-empty"><div class="upload-icon">＋</div><b>点击上传自拍</b><span>手机相册 / JPG / PNG / HEIC / WEBP</span></div>
       <img id="consumer-selfie-preview" class="hidden" alt="自拍预览">
       <span class="replace-photo hidden" id="consumer-replace-photo">更换照片</span>
     </label>
   </div>

   <div class="builder-step">
     <div class="step-num">02</div>
     <div class="step-copy"><div class="eyebrow">告诉我们你想买什么</div><h2>输入品牌和目标色号</h2><p>当前 Demo 会在团队已收录的小红书 + 淘宝真实样本库中匹配。</p></div>
     <div class="target-entry">
       <div class="target-fields">
         <label><span>品牌名</span><input id="consumer-brand" class="target-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="直接输入，如 ysl / 圣罗兰 / 兰蔻"></label>
         <label><span>色号 / 色号名</span><input id="consumer-shade" class="target-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="直接输入，如 610 / 274 / 冰乌龙"></label>
       </div>
       <div class="target-match empty-state" id="target-match">输入品牌和色号后，TrueTone 会确认是否已收录该产品。</div>
       <p class="demo-support">支持直接输入中英文品牌名和色号：YSL / 圣罗兰 610、1936；Lancôme / 兰蔻 274、275。</p>
     </div>
   </div>

   <div class="consumer-start">
     <button class="primary-btn big-action" id="consumer-run" disabled>上传自拍后开始分析</button>
     <p>我们会把“网络内容是否值得参考”和“这些内容与你是否接近”分开判断。</p>
   </div>
 </section>
 <section id="consumer-analysis"></section>
 `);

 const input=$('#consumer-selfie-input'),zone=$('#consumer-selfie-zone'),preview=$('#consumer-selfie-preview'),empty=$('#consumer-selfie-empty'),replace=$('#consumer-replace-photo'),run=$('#consumer-run'),brandInput=$('#consumer-brand'),shadeInput=$('#consumer-shade'),matchBox=$('#target-match');
 function updateRunState(){
   const ok=!!selfieFile&&!!purchaseTargetKey;run.disabled=!ok;
   run.textContent=!selfieFile?'上传自拍后开始分析':!purchaseTargetKey?'请输入已收录的品牌与色号':'开始 TrueTone 分析';
 }
 function updateTargetMatch(){
   const p=resolveDemoProduct(brandInput.value,shadeInput.value);purchaseTargetKey=p?.key||null;
   if(p){
     matchBox.className='target-match matched';
     matchBox.innerHTML=`<span class="shade-dot" style="background:${color(p)}"></span><div><b>已找到：${esc(p.brand)} #${p.shade} · ${esc(p.name)}</b><small>${fmt(p.analysis.counts.visual)} 份视觉素材 · ${fmt(p.analysis.counts.text)} 条文字证据</small></div><em>可分析</em>`;
   }else if(brandInput.value||shadeInput.value){
     const brandOnly=detectBrandOnly(brandInput.value);
     matchBox.className='target-match no-match';
     matchBox.textContent=brandOnly&&!shadeInput.value.trim()
       ? '已识别品牌：'+brandOnly.label+'。请继续直接输入色号或色号名。'
       : '还没有匹配到完整产品。可以直接输入 ysl / 圣罗兰 / 兰蔻，以及 610 / 1936 / 274 / 275 或已收录别称。';
   }else{matchBox.className='target-match empty-state';matchBox.textContent='直接输入品牌和色号；不需要从下拉列表选择。'}
   updateRunState();
 }
 function chooseFile(file){
   if(!file)return;const name=String(file.name||'').toLowerCase();
   const looksLikeImage=(file.type||'').startsWith('image/')||/\.(jpe?g|png|webp|heic|heif)$/i.test(name);
   if(!looksLikeImage){toastMsg('请选择照片文件');return}
   selfieFile=file;const objectUrl=URL.createObjectURL(file);
   preview.onload=()=>URL.revokeObjectURL(objectUrl);preview.onerror=()=>{URL.revokeObjectURL(objectUrl);toastMsg('这张照片当前浏览器无法预览，请尝试 JPG / PNG 或重新选择。')};
   preview.src=objectUrl;preview.classList.remove('hidden');empty.classList.add('hidden');replace.classList.remove('hidden');updateRunState();
 }
 input.onchange=()=>chooseFile(input.files&&input.files[0]);
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('drag')};zone.ondragleave=()=>zone.classList.remove('drag');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drag');chooseFile(e.dataTransfer.files&&e.dataTransfer.files[0])};
 brandInput.oninput=updateTargetMatch;shadeInput.oninput=updateTargetMatch;
 updateRunState();run.onclick=runConsumerJourney;
}

function extractSeedTextSignals(text,p){
 const t=String(text||'').trim(),kw=p.analysis?.keywordCounts||{},flags=[],strengths=[],tags={lip:'',skin:'',makeup:'',lighting:'',application:''};
 const tagMap={
  lip:[['深唇',/深唇/],['中唇',/中唇|唇色中等/],['浅唇',/浅唇|唇色浅/]],
  skin:[['橄榄调',/橄榄皮|橄榄调/],['自然黄调',/黄皮|黄调/],['白皙偏冷',/冷白皮|白皮偏冷/],['白皙偏暖',/暖白皮|白皮偏暖/],['健康深肤',/深肤|健康肤色/]],
  makeup:[['素颜',/素颜/],['淡妆',/淡妆|日常妆|通勤妆/],['浓妆',/浓妆|完整妆/]],
  lighting:[['自然光',/自然光|日光/],['室内暖光',/暖光|黄光/],['室内冷光',/冷光|白光/]],
  application:[['薄涂',/薄涂/],['厚涂',/厚涂/],['正常涂',/正常涂|一层/]]
 };
 Object.entries(tagMap).forEach(([k,arr])=>{const m=arr.find(([,re])=>re.test(t));if(m)tags[k]=m[0]});
 const hype=[
  [/闭眼冲|无脑冲|谁涂谁好看|谁涂谁显白/,'用了过于绝对的推荐语'],
  [/全世界最好|天花板|封神|绝绝子/,'使用了强烈营销式表达'],
  [/所有.*(?:黄皮|白皮|深唇|浅唇)|任何人都/,'把个体差异说成了人人适用']
 ];
 hype.forEach(([re,msg])=>{if(re.test(t))flags.push(msg)});
 const contradictions=[
  [/不拔干|完全不干|一点都不干/,'拔干','文案称“不拔干”，但真实消费者样本中存在拔干反馈'],
  [/不沾杯|完全不沾杯/,'沾杯','文案称“不沾杯”，但真实消费者样本中存在沾杯反馈'],
  [/不氧化|不会氧化/,'氧化','文案称“不氧化”，但真实消费者样本中存在氧化/成膜后变化反馈'],
  [/完全没色差|和图片一模一样|实物和图一样/,'色差','文案把色差说得过于绝对，但样本库中存在颜色差异反馈']
 ];
 contradictions.forEach(([re,key,msg])=>{if(re.test(t)&&(kw[key]||0)>0)flags.push(msg)});
 const contextWords=['深唇','浅唇','薄涂','厚涂','素颜','淡妆','浓妆','自然光','无滤镜','氧化','拔干','沾杯'];
 const contextHits=contextWords.filter(x=>t.includes(x));
 if(contextHits.length>=2)strengths.push('写出了较具体的使用条件，而不是只给情绪化结论');
 if(/用了|小时|成膜|上嘴|实物|对比|复购|回购/.test(t))strengths.push('包含实际使用过程或购买后的信息');
 let score=84+Math.min(8,contextHits.length*2)-flags.length*7;
 score=Math.round(Math.max(35,Math.min(95,score)));
 const agreement=Math.round(Math.max(35,Math.min(95,88-flags.length*6+Math.min(6,contextHits.length))));
 return {score,agreement,flags,strengths,tags,contextHits};
}
function rangePenalty(v,range){
 if(!range||!Number.isFinite(v))return 0;
 if(v<range.p10)return Math.min(26,(range.p10-v)*1.5);
 if(v>range.p90)return Math.min(26,(v-range.p90)*1.5);
 return 0;
}
function seededVisualAgreement(p,analyses,distEntry=null){
 analyses=analyses.filter(x=>x.metrics.roiDetected!==false);
 if(!analyses.length)return null;
 const d=distEntry?.all,centerHue=d?.hue?.circular_center??p.analysis?.center?.hue??0;
 let total=0;
 analyses.forEach(x=>{
  const m=x.metrics;
  const huePenalty=Math.min(30,circularHueDistance(m.hue,centerHue)*.55);
  const satPenalty=rangePenalty(m.saturation,d?.saturation);
  const briPenalty=rangePenalty(m.brightness,d?.brightness);
  total+=Math.max(35,Math.min(96,96-huePenalty-satPenalty-briPenalty));
 });
 return Math.round(total/analyses.length);
}
function lightingMeaning(label){
 return {
  '暖光':'这张图偏暖，容易把口红拍得更橘、更棕，也可能让奶茶调看起来更浓。',
  '冷光':'这张图偏冷，容易把口红拍得更紫、更粉。',
  '过曝':'画面偏亮，深色和灰调会被冲淡，实物通常可能更深。',
  '偏暗':'画面偏暗，颜色容易显得更深、更土。',
  '中性光':'整体光线相对中性，对口红颜色的额外偏移较小。'
 }[label]||'当前光线没有足够信息做进一步判断。';
}
function nearestPlatform(m,distEntry){
 const ps=distEntry?.platforms||{};let best=null;
 Object.entries(ps).forEach(([name,d])=>{
  const v=circularHueDistance(m.hue,d.hue.circular_center)*.55+Math.abs(m.saturation-d.saturation.median)*.2+Math.abs(m.brightness-d.brightness.median)*.25;
  if(!best||v<best.v)best={name,v};
 });
 return best?.name||'全库';
}
function imageDetailEvidence(p,analyses,distEntry){
 const d=distEntry?.all;
 return analyses.map((x,i)=>{
  const m=x.metrics,notes=[lightingMeaning(m.lighting)];
  if(m.roiDetected===false)notes.push(m.roiReason);
  if(d&&m.roiDetected!==false){
   const dh=circularHueDistance(m.hue,d.hue.circular_center);
   const ds=m.saturation-d.saturation.median,db=m.brightness-d.brightness.median;
   notes.push(dh<10?'综合色调方向与样本库中心很接近。':dh<25?'综合色调与样本库有一定偏移，但仍可能由拍摄条件解释。':'综合色调与样本库常见方向偏差较大，不能单独作为准确色彩依据。');
   if(Math.abs(ds)>=5)notes.push('候选唇色区域比样本库中位水平'+(ds>0?'更浓约 ':'更淡约 ')+Math.abs(ds).toFixed(0)+' 个百分点。');
   if(Math.abs(db)>=6)notes.push('候选唇色区域比样本库中位水平'+(db>0?'更亮约 ':'更暗约 ')+Math.abs(db).toFixed(0)+' 个百分点。');
   notes.push('在现有平台样本中，它与'+nearestPlatform(m,distEntry)+'的综合色调更接近。');
  }
  return {index:i+1,view:x.views?.original,lighting:m.lighting,notes};
 });
}
function detect274Variant(text=''){
 const t=String(text||'');
 if(/粉金管|intimatte/i.test(t))return {id:'intimatte',label:'粉金管唇膏 #274',confidence:'高'};
 if(/声色|原声裸茶|cream.?gift/i.test(t))return {id:'cream_gift',label:'「声色」限定 #274 原声裸茶',confidence:'高'};
 if(/黑管哑光|奶茶裸/.test(t))return {id:'cream',label:'黑管哑光 #274 奶茶裸',confidence:'高'};
 if(/唇釉|镜面|小蛮腰/.test(t))return {id:'legacy',label:'历史/其他 274 产品线',confidence:'中'};
 return {id:'unknown',label:'无法仅凭当前文字确定版本',confidence:'低'};
}
function relevantEvidenceClaims(profile,rawText,evidenceEntry){
 const claims=evidenceEntry?.claims||{},wanted=[];
 const add=k=>{if(claims[k]&&!wanted.includes(k))wanted.push(k)};
 if(profile?.skin==='自然黄调'||/黄皮|黄黑皮/.test(rawText))add('yellow_skin');
 if(profile?.lip==='深唇'||/深唇/.test(rawText))add('deep_lip');
 if(profile?.lip==='浅唇'||/浅唇/.test(rawText))add('light_lip');
 if(profile?.makeup==='素颜'||/素颜/.test(rawText))add('bare_face');
 return wanted.map(k=>({key:k,...claims[k]}));
}
function claimEvidenceHtml(items){
 if(!items.length)return '<div class="plain-note">当前数据库没有足够明确、可稳定归类到你这些标签的支持/反对文本，因此这里不硬凑结论。</div>';
 return items.map(c=>{
  const total=(c.support_count||0)+(c.oppose_count||0);
  const supports=(c.support_examples||[]).slice(0,2).map(x=>`<blockquote class="evidence-quote support"><b>支持 · ${esc(x.platform)}${x.variant&&x.variant!=='default'?' · '+esc(x.variant):''}</b><span>${esc(x.text)}</span></blockquote>`).join('');
  const opposes=(c.oppose_examples||[]).slice(0,2).map(x=>`<blockquote class="evidence-quote oppose"><b>相悖 · ${esc(x.platform)}${x.variant&&x.variant!=='default'?' · '+esc(x.variant):''}</b><span>${esc(x.text)}</span></blockquote>`).join('');
  return `<div class="claim-evidence"><div class="claim-head"><b>${esc(c.label)}</b><span>可明确判断的 ${total} 条中：${c.support_count||0} 条支持 · ${c.oppose_count||0} 条相悖</span></div><div class="quote-grid">${supports}${opposes}</div></div>`;
 }).join('');
}
function variant274Html(entry,rawText){
 const vm=entry?.variant_model;if(!vm)return '';
 const detected=detect274Variant(rawText),x=vm.xiaohongshu;
 return `<section class="variant-insight-card">
  <div class="eyebrow">274 的特殊问题：同号不同版本</div>
  <h2>版本混淆不是噪音，本身就是消费者风险。</h2>
  <p>淘宝数据能明确拆成 3 个版本：${vm.taobao_variants.map(v=>esc(v.label)).join('、')}。但小红书的 ${x.main_posts} 篇主帖并没有统一的版本字段：其中 ${x.explicit_lipglaze_or_mirror_posts} 篇明确提到唇釉/镜面，${x.explicit_xiaomanyao_posts} 篇提到“小蛮腰”，还有 ${x.no_clear_variant_posts} 篇仅写“274”而无法确认。</p>
  <div class="variant-detection"><span>这次上传文字的版本识别</span><b>${esc(detected.label)}</b><em>置信度：${detected.confidence}</em></div>
  <p>因此 TrueTone 不会强行把所有小红书 274 内容塞进淘宝的三个版本。版本明确时做版本内比较；版本不明确时只用于“274 色号家族”层面的证据，并降低版本判断的确定性，而不是直接把它判成假。</p>
  <div class="plain-note"><b>真实混淆案例：</b>${esc(vm.cross_variant_example.text)}</div>
 </section>`;
}
function databaseComparisonDetails(p,profile,rawText,evidenceEntry,distEntry,visualAgreement){
 const kw=p.analysis?.keywordCounts||{},items=[];
 if(Number.isFinite(visualAgreement))items.push('图片与全部 '+(distEntry?.all?.n||p.analysis.counts.images)+' 张可解析真实图片的颜色分布比较后，视觉一致性约为 '+visualAgreement+'/100；不是只和单张“标准图”比较。');
 const riskPairs=[['色差','色差'],['拔干','拔干'],['沾杯','沾杯'],['氧化','氧化/成膜变化']].filter(([k])=>kw[k]);
 if(riskPairs.length)items.push('真实消费者反复提到的风险里，'+riskPairs.map(([k,l])=>l+' '+kw[k]+' 次').join('、')+'。这些会作为文案核对依据，而不是只看好评数量。');
 if((p.analysis?.consumerDifferenceMentions||0)>0)items.push('共有 '+p.analysis.consumerDifferenceMentions+' 条文本明确提到偏色、色差或“和图片不一样”，所以系统会特别检查上传内容是否把个体差异说成绝对结论。');
 const claims=relevantEvidenceClaims(profile,rawText,evidenceEntry);
 return {items,claims};
}
function seededPersonalRelevance(profile,textSignals,p){
 let score=58,matched=[],missing=[];
 const t=textSignals?.tags||{};
 [['lip','唇色'],['skin','肤色'],['makeup','妆面']].forEach(([k,label])=>{
  if(!t[k])missing.push(label);
  else if(t[k]===profile[k]){score+=12;matched.push(label+'相近')}
  else score-=7;
 });
 const reviews=personalizedReviews(p,profile);
 if(reviews.length>=3)score+=5;
 score=Math.round(Math.max(35,Math.min(95,score)));
 return {score,matched,missing,reviews};
}
function overallSeedReferenceValue(parts){
 const active=parts.filter(x=>Number.isFinite(x.score)&&x.weight>0);if(!active.length)return 0;
 const sw=active.reduce((s,x)=>s+x.weight,0);return Math.round(active.reduce((s,x)=>s+x.score*x.weight,0)/sw);
}
function seedFindingText(f){
 const map={
  '试色区域高饱和':'图片颜色偏艳，实际颜色可能没有这么饱和。',
  '画面过曝/提亮':'图片偏亮，实际颜色可能比画面里更深。',
  '画面偏暗':'图片偏暗，实际颜色可能比画面里更亮。',
  '色相异常分散':'这张图片的颜色信息比较混杂，不适合单独判断口红颜色。',
  '大面积高饱和':'画面整体偏艳，可能放大了颜色冲击感。',
  '明显色温影响':'拍摄光线会明显改变口红的冷暖观感。',
  '跨图饱和度差异':'你上传的几张图片之间浓淡差异较明显。',
  '跨图亮度差异':'你上传的几张图片之间明暗差异较明显。',
  '跨图色相差异':'你上传的几张图片颜色方向差异较明显。',
  '与多来源参考色域偏离':'这张图和现有真实样本的综合色调有一定距离。'
 };
 return map[f.type]||f.impact||f.type;
}
async function seeded(){
 await getManifest();const profile=getUserProfile();if(!profile){go('/');return}
 purchaseTargetKey=null;seededFiles=[];
 page(`
 <section class="route-head consumer-route-head"><div><div class="eyebrow">被种草之后，先别急着下单</div><h1>把那条让你心动的内容给 TrueTone</h1><p>图片和文字可以分别上传，也可以一起上传。我们只分析你实际提供的证据，不会因为缺少另一部分就扣分。</p></div><a href="#/" class="ghost-btn">修改我的信息</a></section>
 <div class="profile-summary-bar"><b>你的条件</b>${renderProfileChips(profile)}</div>

 <section class="seeded-form panel-soft">
  <div class="seeded-product">
   <div><div class="eyebrow">01 · 先确认是哪支口红</div><h2>品牌与色号</h2><p>准确匹配产品后，才能与整个真实样本库进行交叉比较。</p></div>
   <div class="target-fields">
    <label><span>品牌名</span><input id="seed-brand" class="target-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="直接输入，如 ysl / 圣罗兰 / 兰蔻"></label>
    <label><span>色号 / 别称</span><input id="seed-shade" class="target-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="直接输入，如 610 / 274 / 冰乌龙"></label>
   </div>
   <div class="target-match empty-state" id="seed-target-match">输入品牌和色号后，我们会确认当前数据库是否已收录。</div>
  </div>

  <div class="seeded-input-grid">
   <div class="seeded-upload-card">
    <div class="eyebrow">02A · 图片证据</div><h3>上传种草图</h3><p>可以 1 张，也可以多张。系统会分别看光线、颜色稳定性，以及它们与整个样本库是否一致。</p>
    <label class="seeded-drop" for="seed-images"><input class="native-image-input" id="seed-images" type="file" accept="image/*" multiple><b>＋ 选择一张或多张图片</b><span>JPG / PNG / HEIC / WEBP</span></label>
    <div class="seed-preview-grid" id="seed-preview-grid"></div>
   </div>
   <div class="seeded-text-card">
    <div class="eyebrow">02B · 文字证据</div><h3>粘贴正文、评论或种草文案</h3><p>没有图片也可以单独分析文字。我们会和现有消费者评论库交叉核对。</p>
    <textarea id="seed-text" class="seed-textarea" placeholder="例如：薄涂很自然，深唇也完全不显脏，黄皮闭眼冲……"></textarea>
    <small>只上传图片 / 只上传文字 / 两者一起上传都可以。</small>
   </div>
  </div>
  <button class="primary-btn big-action seed-run" id="seed-run" disabled>至少上传一种内容后开始分析</button>
 </section>
 <section id="seed-result"></section>
 `);
 const brand=$('#seed-brand'),shade=$('#seed-shade'),match=$('#seed-target-match'),input=$('#seed-images'),preview=$('#seed-preview-grid'),textInput=$('#seed-text'),run=$('#seed-run');
 function updateState(){
  const p=resolveDemoProduct(brand.value,shade.value);purchaseTargetKey=p?.key||null;
  if(p){match.className='target-match matched';match.innerHTML=`<span class="shade-dot" style="background:${color(p)}"></span><div><b>已找到：${esc(p.brand)} #${p.shade} · ${esc(p.name)}</b><small>${fmt(p.analysis.counts.visual)} 份视觉素材 · ${fmt(p.analysis.counts.text)} 条文字证据${p.key==='lancome-274'?' · 检测到同号多版本，分析时会先处理版本不确定性':''}</small></div><em>可分析</em>`}
  else if(brand.value||shade.value){
   const brandOnly=detectBrandOnly(brand.value);
   match.className='target-match no-match';
   match.textContent=brandOnly&&!shade.value.trim()
    ? '已识别品牌：'+brandOnly.label+'。请继续直接输入色号或别称。'
    : '还没有匹配到完整产品。可以直接输入 ysl / 圣罗兰 / 兰蔻，以及 610 / 1936 / 274 / 275 或已收录别称。';
  }
  else{match.className='target-match empty-state';match.textContent='直接输入品牌和色号；不需要从下拉列表选择。'}
  const hasEvidence=seededFiles.length>0||textInput.value.trim().length>0;run.disabled=!(purchaseTargetKey&&hasEvidence);
  run.textContent=!purchaseTargetKey?'请先确认品牌与色号':!hasEvidence?'至少上传一种内容后开始分析':'开始检查这条种草';
 }
 function renderPreviews(){
  preview.innerHTML=seededFiles.map((f,i)=>{const u=URL.createObjectURL(f);return `<div class="seed-preview"><img src="${u}" onload="URL.revokeObjectURL(this.src)"><span>图片 ${i+1}</span></div>`}).join('');
 }
 input.onchange=()=>{seededFiles=[...(input.files||[])].slice(0,6);renderPreviews();updateState()};
 brand.oninput=shade.oninput=textInput.oninput=updateState;updateState();
 run.onclick=runSeededAnalysis;
}

async function runSeededAnalysis(){
 const result=$('#seed-result'),run=$('#seed-run'),profile=getUserProfile();
 if(!purchaseTargetKey||!profile)return;
 const rawText=($('#seed-text')?.value||'').trim();
 run.disabled=true;run.textContent='正在和真实样本库交叉比较…';

 result.innerHTML=`<section class="consumer-progress">
   <div class="eyebrow">TrueTone 正在检查</div>
   <h2>只分析你上传的内容，再和整个样本库交叉验证。</h2>
   <div class="human-progress">
     <div class="hp active">读取上传内容</div>
     <div class="hp">检查图片本身是否稳定</div>
     <div class="hp">核对文字与真实消费者反馈</div>
     <div class="hp">和该色号整个样本库比较</div>
     <div class="hp">计算与你的参考相关性</div>
   </div>
   <div class="progress"><i id="seed-progress-bar"></i></div>
 </section>`;
 result.scrollIntoView({behavior:'smooth',block:'start'});

 const steps=()=>$$('.hp');
 const bar=()=>$('#seed-progress-bar');
 const mark=(index,className)=>{
   const list=steps();
   if(list[index])list[index].classList.add(className);
 };
 const setBar=width=>{
   const el=bar();
   if(el)el.style.width=width;
 };

 try{
  const p=await getProduct(purchaseTargetKey);
  const [evCatalog,distCatalog]=await Promise.all([getEvidenceCatalog(),getReferenceDistributions()]);
  const evidenceEntry=evCatalog?.products?.[p.key]||null;
  const distEntry=distCatalog?.products?.[p.key]||null;

  mark(0,'done');mark(1,'active');setBar('20%');

  const analyses=seededFiles.length
    ? await Promise.all(seededFiles.map(analyzeImageFile))
    : [];
  const visual=analyses.length?runFourAgents(analyses,p):null;

  mark(1,'done');mark(2,'active');setBar('42%');

  const textReport=rawText?extractSeedTextSignals(rawText,p):null;

  mark(2,'done');mark(3,'active');setBar('64%');

  const visualAgreement=seededVisualAgreement(p,analyses,distEntry);
  const databaseAgreement=overallSeedReferenceValue([
   {score:visualAgreement,weight:analyses.length?1:0},
   {score:textReport?.agreement,weight:textReport?1:0},
   {score:p.analysis.score,weight:.7}
  ]);

  mark(3,'done');mark(4,'active');setBar('84%');

  const personal=seededPersonalRelevance(profile,textReport,p);
  const overall=overallSeedReferenceValue([
   {score:visual?.score,weight:analyses.length?1.1:0},
   {score:textReport?.score,weight:textReport?1:0},
   {score:databaseAgreement,weight:1.25}
  ]);

  const cloudMedia=await fetchCloudReferenceMedia(p.key);

  mark(4,'done');setBar('100%');

  renderSeededResult({
   p,profile,rawText,analyses,visual,textReport,
   databaseAgreement,personal,overall,cloudMedia,
   evidenceEntry,distEntry,visualAgreement
  });
 }catch(e){
   console.error('runSeededAnalysis failed',e);
   result.innerHTML=`<section class="sku-warning"><b>这次没有稳定完成分析。</b><br>${esc(e?.message||String(e))}</section>`;
 }finally{
   run.disabled=false;
   run.textContent='重新分析这条种草';
 }
}

function renderSeededResult({p,profile,rawText,analyses,visual,textReport,databaseAgreement,personal,overall,cloudMedia,evidenceEntry,distEntry,visualAgreement}){
 const hasImage=analyses.length>0,hasText=!!textReport;
 const verdict=overall>=82?'整体值得参考，但仍要结合与你更接近的真实样本。':overall>=68?'有参考价值，但其中有些信息需要谨慎看。':'不建议只靠这条内容做购买决定。';
 const visualNotes=visual?(visual.findings||[]).slice(0,4).map(x=>'<li>'+esc(seedFindingText(x))+'</li>').join(''):'';
 const imageDetails=hasImage?imageDetailEvidence(p,analyses,distEntry):[];
 const imageDetailsHtml=imageDetails.map(d=>`<article class="image-evidence-detail">${d.view?`<img src="${d.view}" alt="上传图片 ${d.index}">`:''}<div><div class="image-detail-head"><b>图片 ${d.index}</b><span>${esc(d.lighting)}</span></div><ul>${d.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul></div></article>`).join('');
 const textFlags=textReport?.flags?.length?textReport.flags.map(x=>'<li>'+esc(x)+'</li>').join(''):'<li>暂未发现明显的绝对化或与样本库冲突的说法。</li>';
 const textStrength=textReport?.strengths?.length?textReport.strengths.map(x=>'<li>'+esc(x)+'</li>').join(''):'';
 const mediaHtml=cloudMedia?.length?cloudMedia.map((m,i)=>cloudReferenceCard(m,i)).join(''):'<div class="empty">真实参考图暂时没有稳定加载；数据库统计与文字证据仍已参与本次判断。</div>';
 const matchedReviews=personal.reviews||[];
 const reviewHtml=matchedReviews.length?matchedReviews.slice(0,3).map((r,i)=>`<article class="matched-review"><div class="match-rank">0${i+1}</div><div><div class="review-source">${esc(r.platform)} · ${esc(r.type||'消费者反馈')}</div><p>“${highlight(r.text)}”</p><small>这条反馈因为包含与你的唇色/妆面相近线索或较具体的使用体验，被优先展示。</small></div></article>`).join(''):'<div class="empty">当前没有足够明确的个性化文字样本。</div>';
 const profileText=profileSummary(profile);
 const dbDetail=databaseComparisonDetails(p,profile,rawText,evidenceEntry,distEntry,visualAgreement);
 const dbList=dbDetail.items.map(x=>'<li>'+esc(x)+'</li>').join('');
 $('#seed-result').innerHTML=`
 <section class="seed-report">
  <div class="seed-report-hero">
   <div><div class="eyebrow">这条种草值得信吗？</div><div class="big-score">${overall}<small>/100</small></div><h2>${verdict}</h2><p>本次使用了：${hasImage?analyses.length+' 张图片':''}${hasImage&&hasText?' + ':''}${hasText?'文字内容':''}。没有上传的部分不会被当成缺点扣分。</p></div>
   <div class="seed-score-grid">
    <div><span>图片参考价值</span><b>${hasImage?(visual.score??'无法判断'):'未提供'}</b></div>
    <div><span>文字参考价值</span><b>${hasText?textReport.score:'未提供'}</b></div>
    <div><span>与整个样本库一致性</span><b>${databaseAgreement}</b></div>
    <div><span>与你的相关性</span><b>${personal.score}</b></div>
   </div>
  </div>

  <div class="seed-two-col">
   <section class="seed-card"><div class="eyebrow">图片怎么看</div><h3>${hasImage?(visual.score===null?'未识别到唇部':'图片本身 '+visual.score+'/100'):'这次没有上传图片'}</h3>${hasImage?`<ul>${visualNotes||'<li>没有发现明显的高风险视觉异常。</li>'}</ul>`:'<p>所以本次不会对图片做任何推断。</p>'}</section>
   <section class="seed-card"><div class="eyebrow">文字怎么说</div><h3>${hasText?'文字内容 '+textReport.score+'/100':'这次没有上传文字'}</h3>${hasText?`<ul>${textFlags}${textStrength}</ul>`:'<p>所以本次不会因为缺少文案而降低总分。</p>'}</section>
  </div>

  ${hasImage?`<section class="deep-explain-card"><div class="section-head"><div><div class="eyebrow">图片分数到底怎么来的</div><h2>逐张告诉你：是什么光、偏在哪里、和全库差多少</h2></div><p>下面使用的是你上传图片本身的像素特征，并与当前色号全部 ${distEntry?.all?.n||p.analysis.counts.images} 张可解析真实图片的分布比较。</p></div><div class="image-evidence-list">${imageDetailsHtml}</div></section>`:''}

  ${p.key==='lancome-274'?variant274Html(evidenceEntry,rawText):''}

  <section class="database-agreement-card detailed-database">
   <div><div class="eyebrow">不是只报“数据库里有多少条”</div><h2>具体比较了什么？</h2><ul class="database-detail-list">${dbList}</ul><p>下面只统计能明确判断“支持 / 相悖”的文本；模糊、答非所问或版本不明的内容不会硬塞进支持率。</p></div>
   <div class="database-score"><b>${databaseAgreement}</b><span>/100<br>样本库一致性</span></div>
  </section>

  <section class="claim-evidence-panel">
   <div class="section-head"><div><div class="eyebrow">真实消费者怎么说</div><h2>支持意见和相悖意见都给你看</h2></div><p>不是只挑好评。系统会把与你本人条件或上传文案直接相关的观点拿出来做正反证据对照。</p></div>
   ${claimEvidenceHtml(dbDetail.claims)}
  </section>

  <section class="personal-relevance-card">
   <div class="section-head"><div><div class="eyebrow">即使是真的，它对你有用吗？</div><h2>与你的参考相关性 ${personal.score}/100</h2></div><div class="profile-chips">${renderProfileChips(profile)}</div></div>
   <p>${personal.matched.length?'这条内容里出现了与你相近的'+personal.matched.join('、')+'。':''}${personal.missing.length?' 但它没有明确说明'+personal.missing.join('、')+'，所以这部分不会被系统假装“已经匹配”。':''}</p>
  </section>

  <section class="panel report-section"><div class="section-head"><div><div class="eyebrow">交叉证据</div><h2>再看 3 张真实参考</h2></div><p>这些来自现有 OSS 样本库，用来帮助你确认上传内容是否落在真实消费者常见范围内。</p></div><div class="top-media">${mediaHtml}</div></section>

  <section class="matched-reviews-block"><div class="section-head"><div><div class="eyebrow">和你更相关的消费者反馈</div><h2>比“平均评价”更值得先看</h2></div><p>你的条件：${esc(profileText)}</p></div>${reviewHtml}</section>

  <section class="seed-cta"><div><div class="eyebrow">还喜欢这个颜色？</div><h2>下一步，可以看看它在你自拍上的方向。</h2><p>我们会沿用你刚刚填写的个人信息，不需要重新选择。</p></div><button class="primary-btn" id="seed-to-selfie">去自拍试色</button></section>
 </section>`;
 $('#seed-to-selfie').onclick=()=>{purchaseTargetKey=p.key;go('/selfie')};
}

async function runConsumerJourney(){
 if(!selfieFile||!purchaseTargetKey)return;
 const result=$('#consumer-analysis'),run=$('#consumer-run'),key=purchaseTargetKey;
 const profile=getUserProfile();if(!profile){go('/');return;}
 run.disabled=true;run.textContent='正在分析…';
 result.innerHTML=`<section class="consumer-progress"><div class="eyebrow">正在整理最值得你看的内容</div><h2>先判断网上什么值得信，再找什么最像你。</h2><div class="human-progress">
  <div class="hp active">读取这个色号的真实试色与评价</div><div class="hp">比较不同平台与不同拍摄条件</div><div class="hp">先排除不稳定、信息量低的内容</div><div class="hp">寻找与你条件更接近的评论与试色</div><div class="hp">整理成你能直接使用的购买参考</div>
 </div><div class="progress"><i id="consumer-progress-bar"></i></div></section>`;
 result.scrollIntoView({behavior:'smooth',block:'start'});
 try{
   const p=await getProduct(key),steps=$$('.hp'),bar=$('#consumer-progress-bar');
   steps[0].classList.add('done');steps[1].classList.add('active');bar.style.width='22%';await wait(180);
   selfieResult=await createVirtualTryOn(selfieFile,p,false);
   steps[1].classList.add('done');steps[2].classList.add('active');bar.style.width='48%';await wait(180);
   const reviews=personalizedReviews(p,profile),media=personalizedMedia(p,selfieResult);
   steps[2].classList.add('done');steps[3].classList.add('active');bar.style.width='72%';await wait(180);
   const match=personalMatchScore(p,selfieResult,profile,reviews),expected=expectedAppearance(p,selfieResult);
   steps[3].classList.add('done');steps[4].classList.add('active');bar.style.width='90%';
   const [cloudNarrative,cloudMedia]=await Promise.all([
     callCloudAgent(p,profile,selfieResult,reviews,match),
     fetchCloudReferenceMedia(p.key)
   ]);
   await wait(80);
   steps[4].classList.add('done');bar.style.width='100%';
   const stableCloud=cloudNarrative?{...cloudNarrative,reference_media:cloudMedia.length?cloudMedia:(cloudNarrative.reference_media||[])}:{reference_media:cloudMedia};
   renderConsumerResult(p,profile,reviews,media,match,expected,stableCloud);
 }catch(e){
   result.innerHTML=`<section class="sku-warning"><b>这次没有稳定完成自拍分析。</b><br>${esc(e.message)}<br>建议换一张自然光、正脸、嘴唇无遮挡的照片再试。</section>`;
 }finally{run.disabled=false;run.textContent='重新分析'}
}

function cloudArray(v){return Array.isArray(v)?v.filter(Boolean):[]}
function cloudText(x){if(typeof x==='string')return x;if(!x||typeof x!=='object')return '';const a=x.finding||x.title||x.label||x.type||'',b=x.explanation||x.reason||x.note||x.text||x.suggestion||x.why||'';return [a,b].filter(Boolean).join(a&&b?'：':'')}
function cloudEvidenceLabel(v){const s=String(v||'').toLowerCase();return s==='high'||s==='高'?'高':s==='medium'||s==='中'?'中':s==='low'||s==='低'?'低':(v||'—')}
function cloudMediaHtml(cloudNarrative,localMedia){
 const remote=cloudArray(cloudNarrative&&cloudNarrative.reference_media).filter(m=>m&&m.url);
 if(remote.length)return remote.slice(0,3).map((m,i)=>{
  const platform=esc(m.platform||'真实来源'),label=esc(m.label||'真实试色参考'),reason=esc(m.reason||'来自已核验真实样本，用于辅助判断不同环境下的综合查看色调。'),sku=m.sku?'<small>'+esc(m.sku)+'</small>':'';
  return '<article class="matched-media real-reference"><div class="real-media-frame"><img src="'+esc(m.url)+'" alt="'+platform+'试色参考 '+(i+1)+'" loading="lazy"><span class="media-source-badge">'+platform+' · 已核验样本</span></div><div class="media-card-copy"><div class="media-rank-line"><b>0'+(i+1)+'</b><span>'+label+'</span></div><p>'+reason+'</p>'+sku+'</div></article>';
 }).join('');
 if(localMedia&&localMedia.length)return localMedia.slice(0,3).map((m,i)=>{
  const pic=m.thumb?'<img src="'+esc(m.thumb)+'" alt="试色参考 '+(i+1)+'" loading="lazy">':'<div class="media-placeholder"><span>图片暂不可显示<br><small>该条证据仍参与分析</small></span></div>';
  return '<article class="matched-media">'+pic+'<div class="media-card-copy"><div class="media-rank-line"><b>0'+(i+1)+'</b><span>'+esc(m.platform||'真实来源')+'</span></div><p>'+esc((m.reasons||[])[0]||'在可信度与当前使用条件之间综合查看排序。')+'</p></div></article>';
 }).join('');
 return '<div class="empty">当前没有可稳定展示的真实试色图片。</div>';
}

function consumerPlatformSummary(a){
 const d=a.platformDiff||{},h=Math.abs(Number(d.hue)||0),s=Math.abs(Number(d.saturation)||0),b=Math.abs(Number(d.brightness)||0);
 const xhs=a.platform?.['小红书'],tb=a.platform?.['淘宝'];
 const tone=h<5?'综合查看色相基本一致':h<12?'色相有轻微差别':'色相差别比较明显';
 let bright='明暗差异不大';
 if(xhs&&tb&&b>=4)bright=xhs.brightness<tb.brightness?'小红书样本整体比淘宝偏暗一些':'小红书样本整体比淘宝偏亮一些';
 return tone+'；'+bright+'。因此更建议把两边的自然光/无滤镜内容放在一起看，而不是只相信单个平台的一张图。';
}
function consumerRiskItems(p){
 const a=p.analysis||{},kw=a.keywordCounts||{},out=[];
 const dark=(a.findings||[]).find(f=>/偏暗/.test(f.type));
 if(dark)out.push('有 '+(dark.count||'部分')+' 份样本明显偏暗，这类图片不适合单独作为颜色依据。');
 if((a.consumerDifferenceMentions||0)>0)out.push('有 '+a.consumerDifferenceMentions+' 条反馈明确提到偏色、色差或“和图片不一样”，说明购买前需要交叉看多条内容。');
 const texture=['拔干','沾杯'].filter(k=>kw[k]).sort((x,y)=>kw[y]-kw[x]);
 if(texture.length)out.push('使用体验里较常被提到的是'+texture.map(k=>k+'（'+kw[k]+'）').join('、')+'，这是质地体验风险，不等于颜色造假。');
 if(!out.length)out.push('目前没有强烈的视觉异常信号，但单张种草图仍不足以代表所有人的上唇效果。');
 return out.slice(0,3);
}
function consumerNormalItems(p){
 const kw=p.analysis?.keywordCounts||{},out=[];
 if(kw['深唇']||kw['浅唇'])out.push('原生唇色不同，同一支口红上嘴会有明显深浅差异。');
 if(kw['薄涂']||kw['厚涂'])out.push('薄涂和厚涂会改变浓淡、覆盖力和红/棕感。');
 if(kw['氧化'])out.push('部分消费者提到成膜或氧化后会变深/变色，刚上嘴和过一会儿不一定一样。');
 if(kw['自然光']||kw['滤镜']||kw['无滤镜'])out.push('自然光、室内灯和滤镜会改变照片观感，光线差异应先于“P图”判断。');
 return out.length?out:['同一个色号在不同唇色、光线和涂法下出现差异，本身并不等于内容失真。'];
}
function stableConsumerDecision(p,profile,match){
 const a=p.analysis||{},score=Math.round(a.score||0),risk=consumerRiskItems(p)[0]||'单张种草图不足以代表所有人的上唇效果。';
 const fit=match>=84?'你的当前条件和现有参考比较接近':match>=72?'有一定参考价值，但建议多看几种光线和涂法':'与你当前条件真正接近的参考还不算多';
 let lead=score>=80?'这支可以继续看，现有网络内容整体有参考价值。':score>=65?'这支可以参考，但别只看一条种草或一张试色图。':'这支建议谨慎参考，先把不同来源放在一起比较。';
 let action='优先看和你原生唇色、肤色表现与日常妆面更接近的真实反馈。';
 if(profile.makeup==='素颜')action='你平时更常素颜，优先看素颜、自然光和较薄涂的真实反馈。';
 if(profile.makeup==='淡妆')action='你平时更常淡妆，优先看日常妆、自然光和常规涂法的真实反馈。';
 if(profile.makeup==='浓妆')action='你平时更常浓妆，可以多看完整妆面与较高覆盖度的真实反馈。';
 return {lead,detail:fit+'。'+risk,action};
}
function cleanAgentCopy(s,max=150){
 let x=String(s||'').replace(/TrueTone\s*Score\s*\d+/gi,'').replace(/Match\s*Score\s*\d+/gi,'').replace(/[（(]\s*[，,;；:\s]*[）)]/g,'').replace(/\s+/g,' ').trim();
 return x.length>max?x.slice(0,max).replace(/[，,;；。]\s*$/,'')+'。':x;
}

function renderConsumerResult(p,profile,reviews,media,match,expected,cloudNarrative=null){
 const a=p.analysis,trust=Math.round(a.score),evidenceLevel=cloudEvidenceLabel(a.evidenceSufficiency),trustLabel=trust>=80?'整体较值得参考':trust>=65?'可以参考，但要注意内容差异':'建议谨慎参考，不依赖单一内容';
 const fitLabel=match>=84?'与你当前条件的参考匹配度较高':match>=72?'有一定参考价值，但个体差异仍明显':'与你当前条件相近的证据还不够充分';
 const normalItems=consumerNormalItems(p),riskItems=consumerRiskItems(p),platformSummary=consumerPlatformSummary(a),stableDecision=stableConsumerDecision(p,profile,match);
 const mediaHtml=cloudMediaHtml(cloudNarrative,media);
 const reviewsHtml=reviews.length?reviews.map((r,i)=>`<article class="matched-review"><div class="match-rank">0${i+1}</div><div><div class="review-source">${r.platform} · ${r.type||'评论'}${r.repeatBuyer?' · 复购/已购高信息量线索':''}</div><p>“${highlight(r.text)}”</p><small>匹配原因：${profile.lip!=='不确定'&&r.text.includes(profile.lip)?'与你主动填写的唇色情况一致；':''}${r.negativeEvidence?'包含具体负向/差异体验，信息量高；':''}与你填写的使用条件相关。</small></div></article>`).join(''):'<div class="empty">当前没有足够的可匹配原文评论。</div>';
 $('#consumer-analysis').innerHTML=`
 <section class="personal-result">
   <div class="result-title"><div><div class="eyebrow">你的 TrueTone 购买参考</div><h2>${esc(p.brand)} #${p.shade} · ${esc(p.name)}</h2><p>不是替你宣布“适合 / 不适合”，而是根据这张自拍的拍摄情况和可信消费者证据告诉你：这个方向对你有多大参考价值。</p></div><button class="ghost-btn" id="back-to-form">重新选择</button></div>
   ${cloudNarrative?.runtime==="aliyun-model-studio"?`<div class="cloud-connected-badge"><span>本次分析</span><b>✓ 已完成多来源交叉分析</b></div>`:``}
   <div class="personal-hero-grid">
    <div class="tryon-card"><div class="tryon-image"><img id="consumer-result-photo" src="${selfieResult.tryon}"><div class="toggle result-toggle"><button class="active" data-view="tryon">颜色预览</button><button data-view="original">原自拍</button></div></div><div class="tryon-caption"><div class="preview-color-row"><span class="preview-swatch" style="background:${color(p)}"></span><div><b>#${p.shade} · ${esc(p.name)}</b><p>${expected.tone}。当前仅模拟这个颜色大概是什么方向，并保留你原本的唇纹与明暗。</p></div></div><small>颜色预览是视觉模拟，不是品牌官方色卡或精准 AR 试色；实物仍会受原生唇色、光线与涂抹厚度影响。</small></div></div>
    <div class="decision-card">
      <div class="decision-block"><span>网上关于这个色号，可信吗？</span><div class="big-score">${trust}<small>/100</small></div><b>${trustLabel}</b><p>${a.counts.visual} 份视觉素材 + ${fmt(a.counts.text)} 条文字证据；可参考信息：${evidenceLevel==='高'?'比较充足':evidenceLevel==='中'?'基本够用':'还不够多'}。</p></div>
      <div class="decision-block accent"><span>和你当前情况，匹配吗？</span><div class="big-score">${match}<small>% MATCH</small></div><b>${fitLabel}</b><p>结合这张自拍的拍摄情况光照、你主动选择的“${profile.lip} / ${profile.makeup} / ${profile.goal}”以及可信内容匹配。</p></div>
    </div>
   </div>

   <section class="agent-narrative"><div class="eyebrow">给你的购买参考</div><h3>${esc(stableDecision.lead)}</h3><p>${esc(stableDecision.detail)}</p><small>${esc(stableDecision.action)}</small></section>
   <section class="consumer-section"><div class="section-head"><div><div class="eyebrow">先看这些</div><h2>最值得你参考的 3 张试色</h2></div><p>先通过内容可信度筛选，再按与你这张自拍的拍摄情况光照和使用情况的接近程度重新排序。</p></div><div class="matched-media-grid">${mediaHtml}</div></section>

   <section class="consumer-section"><div class="section-head"><div><div class="eyebrow">她们怎么说</div><h2>和你更相关的 3 条消费者反馈</h2></div><p>我们会优先展示写清楚使用条件、复购体验或具体缺点的反馈；单纯夸“好看”不会自动排在前面。</p></div><div class="matched-review-list">${reviewsHtml}</div></section>

   <section class="consumer-section trust-explain"><div class="section-head"><div><div class="eyebrow">为什么我们相信 / 不完全相信这些内容</div><h2>这些内容为什么值得看</h2></div></div>
    <div class="trust-grid">
      <div class="panel trust-story-card platform-card"><h3>不同平台看起来一样吗？</h3><p>${esc(platformSummary)}</p></div>
      <div class="panel trust-story-card risk-card"><h3>购买前最值得注意</h3><ul class="consumer-bullets">${riskItems.slice(0,4).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="panel trust-story-card"><h3>这些差异不一定是修图</h3><ul class="consumer-bullets">${(normalItems.length?normalItems:['当前证据不足以细分更多正常变化。']).slice(0,4).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="panel"><h3>同色号也可能有版本差异</h3><p>${p.skuLines?.length>1?`当前样本里同一色号出现 ${p.skuLines.length} 个产品线 / 包装或版本标签。TrueTone 会分开看，避免把版本差异误当成“修图”。`:'当前样本里没有明显的同色号版本混淆。'}</p></div>
    </div>
    <details class="tech-details"><summary>想看更详细的分析依据？</summary><div class="details-grid"><div class="panel"><h3>这张自拍的拍摄情况</h3><p>光照：${selfieResult.light.label}<br>画面明暗：${selfieResult.light.brightness}%<br>当前照片可见面部颜色：${selfieResult.faceRef.hex} · ${selfieResult.faceRef.tone}</p></div><div class="panel"><h3>网络样本的综合查看色调</h3><p>这是网络样本的统计中心，用来比较平台偏差，不等同于实物色卡。<br>分析值：H ${a.center.hue}° · S ${a.center.saturation}% · B ${a.center.brightness}%</p></div></div></details>
   </section>

   <section class="purchase-loop"><div><div class="eyebrow">最后一步</div><h2>你喜欢这个方向吗？</h2><p>喜欢就继续看相似色号 / 不同质地；不喜欢就告诉我们想往哪个方向调整。</p></div><div class="purchase-actions"><button class="primary-btn" id="result-like">喜欢，看看相似色</button><button class="secondary-btn" id="result-warmer">想更橘一点</button><button class="secondary-btn" id="result-brighter">想更清透一点</button><a class="ghost-btn" href="#/compare">我在纠结两个色号</a></div></section>
 </section>`;
 $$('.result-toggle button').forEach(b=>b.onclick=()=>{$$('.result-toggle button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#consumer-result-photo').src=b.dataset.view==='tryon'?selfieResult.tryon:selfieResult.original});
 $('#back-to-form').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
 $('#result-like').onclick=()=>recommend(p,false);$('#result-warmer').onclick=()=>recommend(p,true);$('#result-brighter').onclick=()=>recommend(p,false);
}

function quick(q){q=(q||'').toLowerCase().replace('#','').trim();const p=manifest.products.find(x=>x.shade===q||x.brand.toLowerCase().includes(q)||x.name.toLowerCase().includes(q));p?go('/shade/'+p.key):go('/search')}

async function search(){
 await getManifest();page(`<div class="route-head"><a class="backlink" href="#/">← 首页</a><div class="eyebrow" style="margin-top:22px">搜索已有色号</div><h1>先找一个你正在纠结的颜色</h1><p>先看最值得参考的真实试色和与你情况更接近的反馈，再决定要不要买。</p></div><div class="searchbox" style="max-width:720px"><span class="search-icon">⌕</span><input id="catalog-q" placeholder="YSL / Lancôme / 610 / 274…"></div><div class="shade-grid" id="catalog" style="margin-top:18px">${manifest.products.map(shadeCard).join('')}</div>`);
 $('#catalog-q').oninput=e=>{$('#catalog').innerHTML=manifest.products.filter(p=>(p.brand+p.name+p.product+p.shade).toLowerCase().includes(e.target.value.toLowerCase())).map(shadeCard).join('')||'<div class="empty">当前 Demo 数据库里暂时没有这个色号。</div>'}
}

async function shade(k){
 const m=meta(k);
 if(!m)return home();
 page(`<div class="route-head"><a class="backlink" href="#/search">← 返回色号库</a><div class="eyebrow" style="margin-top:22px">${esc(m.brand)} · ${esc(m.product)}</div><h1>#${m.shade} ${esc(m.name)}</h1><p>先别急着看分数。TrueTone 会把不同平台的试色、评价和使用体验放在一起，告诉你哪些更值得参考、哪些要谨慎看。</p></div>
 <section class="analysis-start">
  <div class="panel analysis-intro">
   <div class="eyebrow">我们会看这些内容</div>
   <h2>先看真实内容，再告诉你结论。</h2>
   <div class="source-counts"><span><b>${m.analysis.counts.visual}</b> 份视觉素材</span><span><b>${fmt(m.analysis.counts.text)}</b> 条文字证据</span><span><b>${m.analysis.counts.sources}</b> 类来源</span><span><b>${m.analysis.counts.skus}</b> 个同色号版本</span></div>
   ${m.skuLines?.length>1?`<div class="sku-warning">同一色号包含多个 版本 / 产品线：${m.skuLines.map(esc).join('、')}。系统会保留这些边界，避免把产品差异误判成内容失真。</div>`:''}
   <div class="plain-note" style="margin-top:14px">好评不等于更可信。我们会更看重具体使用条件、负向体验和不同来源之间是否互相印证。</div>
  </div>
  <div class="panel">
   <div class="eyebrow">正在怎么判断</div>
   <div class="agent-steps" id="product-agent-steps">
    <div class="agent-step" data-a="1">颜色与拍摄环境</div>
    <div class="agent-step" data-a="2">不同图片是否互相矛盾</div>
    <div class="agent-step" data-a="3">挑出最值得先看的内容</div>
    <div class="agent-step" data-a="4">怎样让试色更容易比较</div>
   </div>
   <button class="primary-btn" id="start-product-analysis" style="width:100%;margin-top:16px">开始 TrueTone 分析</button>
   <div class="progress" style="margin-top:12px"><i id="product-progress"></i></div>
  </div>
 </section>`);
 $('#start-product-analysis').onclick=async()=>{
   const btn=$('#start-product-analysis'),steps=$$('#product-agent-steps .agent-step'),bar=$('#product-progress');
   btn.disabled=true;btn.textContent='正在读取证据集…';
   try{
     await getProduct(k);
     const labels=['正在分析颜色与拍摄环境…','正在交叉核验风险与一致性…','正在整理消费者最有用的证据…','正在生成改进建议…'];
     for(let i=0;i<steps.length;i++){
       steps.forEach((s,j)=>{if(j<i)s.className='agent-step done';else if(j===i)s.className='agent-step active';else s.className='agent-step'});
       btn.textContent=labels[i];bar.style.width=((i+1)/steps.length*100)+'%';await wait(i===0?360:260);
     }
     steps.forEach(s=>s.className='agent-step done');
     await shadeReport(k);
   }catch(e){
     btn.disabled=false;btn.textContent='重新尝试';
     toastMsg('数据读取失败：'+e.message);
   }
 }
}

function shade274FamilyAnalysisHtml(evidenceEntry,distEntry){
 const vm=evidenceEntry?.variant_model,claims=evidenceEntry?.claims||{},vars=distEntry?.variants||{};
 if(!vm)return '';
 const variantCards=vm.taobao_variants.map(v=>{
   const d=vars[v.id];
   if(!d)return '';
   const med=`色彩中位：浓淡 ${d.saturation.median}% · 明暗 ${d.brightness.median}%`;
   const light=Object.entries(d.lighting_counts||{}).sort((a,b)=>b[1]-a[1])[0];
   return `<article class="variant-card">
     <div class="variant-name">${esc(v.label)}</div>
     <p>${esc(med)}</p>
     <small>${d.n} 张可解析图片${light?' · 常见拍摄判断：'+esc(light[0]):''}</small>
   </article>`;
 }).join('');
 const x=vm.xiaohongshu;
 const claimKeys=['yellow_skin','deep_lip','bare_face'];
 const claimBlocks=claimKeys.filter(k=>claims[k]).map(k=>{
   const z=claims[k],total=(z.support_count||0)+(z.oppose_count||0);
   const support=(z.support_examples||[])[0],oppose=(z.oppose_examples||[])[0];
   return `<article class="family-claim">
     <div class="claim-head"><b>${esc(z.label)}</b><span>${total} 条可明确判断：${z.support_count||0} 支持 · ${z.oppose_count||0} 相悖</span></div>
     <div class="quote-grid">
      ${support?`<blockquote class="evidence-quote support"><b>支持 · ${esc(support.platform)}</b><span>${esc(support.text)}</span></blockquote>`:''}
      ${oppose?`<blockquote class="evidence-quote oppose"><b>相悖 · ${esc(oppose.platform)}</b><span>${esc(oppose.text)}</span></blockquote>`:''}
     </div>
   </article>`;
 }).join('');
 return `
 <section class="variant-insight-card family-overview">
   <div class="eyebrow">274 不应被当成一个完全统一的产品</div>
   <h2>同一个“274”，至少包含 3 个明确版本；小红书还混有版本不明和旧款内容。</h2>
   <p>淘宝数据可以明确拆成 3 个产品版本，因此 TrueTone 会在版本内做颜色与评价比较。小红书没有统一版本字段，所以不会被强行映射到其中某一个版本。</p>
   <div class="variant-card-grid">${variantCards}</div>
   <div class="family-policy">
    <b>小红书怎么处理？</b>
    <p>${x.main_posts} 篇 274 主帖中，${x.explicit_lipglaze_or_mirror_posts} 篇明确提到唇釉/镜面，${x.explicit_xiaomanyao_posts} 篇提到“小蛮腰”，另有 ${x.no_clear_variant_posts} 篇无法确定版本。版本不明内容只作为“274 家族级证据”，不会参与某一个淘宝版本的精确色彩结论。</p>
   </div>
 </section>

 <section class="claim-evidence-panel">
   <div class="section-head"><div><div class="eyebrow">为什么网上对 274 的评价容易互相打架？</div><h2>把支持意见和相悖意见拆开看</h2></div><p>这里不是把所有 274 混成一个平均结论，而是先承认版本、唇色和妆面都会改变评价。</p></div>
   ${claimBlocks}
   <div class="plain-note"><b>一个真实的版本混淆案例：</b>${esc(vm.cross_variant_example.text)}</div>
 </section>`;
}
async function shadeReport(k){
 const p=await getProduct(k),a=p.analysis,c=buildProductConsumerSummary(p),top=c.top,sku=p.skuLines||[];
 const [cloudTop,evCatalog,distCatalog]=await Promise.all([
   fetchCloudReferenceMedia(k),
   getEvidenceCatalog(),
   getReferenceDistributions()
 ]);
 const evidenceEntry=evCatalog?.products?.[k]||null;
 const distEntry=distCatalog?.products?.[k]||null;
 const is274=k==='lancome-274';

 const familyNotice=is274
  ? `<div class="sku-warning"><b>274 家族提醒：</b>淘宝样本能明确拆分 Cream / Cream Gift / Intimatte 三个版本，但小红书存在版本不明与旧款 274。下面的分析会把“版本内证据”和“274 家族级证据”分开，不再把所有 274 混成一个统一平均值。</div>`
  : (sku.length>1?`<div class="sku-warning">版本提醒：当前样本同一色号包含 <b>${sku.length}</b> 个版本 / 产品线：${sku.map(esc).join('、')}。这些版本会分开比较，避免把产品本身差异误判成修图。</div>`:'');

 const colorSection=is274&&distEntry?.variants
  ? `<section class="panel report-section">
      <div class="section-head"><div><div class="eyebrow">综合色调不能只看一个平均值</div><h2 style="font-size:28px">三个版本分别是什么方向？</h2></div><p>以下是各版本真实图片的分布中位数，用来比较版本之间的细微差异。</p></div>
      <div class="variant-card-grid">
       ${[
         ['cream','黑管哑光 #274 奶茶裸'],
         ['cream_gift','「声色」限定 #274 原声裸茶'],
         ['intimatte','粉金管唇膏 #274']
       ].map(([id,label])=>{
         const d=distEntry.variants[id];if(!d)return '';
         return `<article class="variant-card"><div class="variant-name">${esc(label)}</div><p>浓淡中位 ${d.saturation.median}% · 明暗中位 ${d.brightness.median}%</p><small>${d.n} 张可解析图片 · 色彩中心约 ${d.hue.circular_center.toFixed(1)}°</small></article>`;
       }).join('')}
      </div>
      <div class="plain-note">这三个版本的综合色调接近，但浓淡、明暗和质地来源并不完全相同，因此 TrueTone 不再用一个综合色块代表全部“274”。</div>
     </section>`
  : `<section class="details-grid"><div class="panel"><h3>这个颜色大概是什么方向</h3><div class="direction-swatch-wrap"><span class="direction-swatch" style="background:${color(p)}"></span><div><b>#${p.shade} · ${esc(p.name)}</b><p>这个色块只帮助你快速理解综合色调，不代表品牌官方色卡或实物绝对颜色。</p></div></div></div><div class="panel"><h3>小红书和淘宝看起来差多少？</h3>${metric('颜色方向差异',a.platformDiff.hue,90,'°')}${metric('浓淡差异',Math.abs(a.platformDiff.saturation),35,'%')}${metric('明暗差异',Math.abs(a.platformDiff.brightness),35,'%')}<div class="plain-note">详细数值已收进分析依据，主页面只保留消费者能直接理解的差异。</div></div></section>`;

 page(`<div class="route-head"><a class="backlink" href="#/search">← 返回色号库</a><div class="eyebrow" style="margin-top:22px">${esc(p.brand)} · ${esc(p.product)}</div><h1>#${p.shade} ${esc(p.name)}</h1><p>${is274?'这页按“274 色号家族”来读：先区分版本，再看家族层面的消费者争议。':'先给你能直接使用的结论，再告诉你为什么。下面的结果来自当前已收录的真实试色与评价。'}</p>${familyNotice}</div>

 <section class="report-hero">
  <div class="panel">
   <div class="eyebrow">${is274?'274 家族结论':'一句话结论'}</div>
   <div class="conclusion">${is274?'网络上的“兰蔻 274”并不是完全同一个产品语境。版本混淆本身会放大色差与适配评价的矛盾，因此要先确认版本，再看“适不适合我”。':esc(c.conclusion)}</div>
   <div class="source-counts"><span><b>${a.counts.visual}</b> 份视觉素材</span><span><b>${fmt(a.counts.text)}</b> 条文字证据</span><span><b>${a.counts.sources}</b> 类来源</span></div>
   <div class="filter-row" style="margin-top:18px"><span style="font-size:11px;color:var(--muted);align-self:center">更像你的情况：</span><button class="filter-btn active" data-prof="all">全部</button><button class="filter-btn" data-prof="深唇">深唇</button><button class="filter-btn" data-prof="浅唇">浅唇</button><button class="filter-btn" data-prof="素颜">素颜</button></div>
  </div>
  <div class="panel score-panel"><div class="score-ring" style="--score:${a.score};--ring:${a.score>=80?'#82b996':a.score>=60?'#e2b16b':'#d46d60'}"><b>${a.score}</b></div><div class="score-label"><strong>${is274?'家族级内容参考价值':'内容参考价值'}</strong>${is274?'这个分数表示“274”相关网络内容整体有多少可用信息，不代表三个版本可以混为一谈。':'它表示这些网络内容有多适合作为你的购买参考，不是简单的“真/假”判决。'}<span class="evidence-badge">可参考信息是否足够：${a.evidenceSufficiency}</span><div class="disclaimer">${evidenceScoreText(a)}。分数高低和资料多少是两回事。</div></div></div>
 </section>

 ${is274?shade274FamilyAnalysisHtml(evidenceEntry,distEntry):''}

 <section class="panel report-section" id="top-ref"><div class="section-head"><div><div class="eyebrow">真实参考</div><h2 style="font-size:28px">你最值得先看的 3 张</h2></div><p>${cloudTop.length?'优先展示当前样本库里最值得先看的真实试色。':'图片暂时没有稳定加载，但排序和文字证据仍然可用。'}</p></div><div class="top-media" id="top-media">${cloudTop.length?cloudTop.map(cloudReferenceCard).join(''):top.map(mediaCard).join('')}</div></section>

 <section class="details-grid">
  <div class="panel"><h3>${is274?'274 家族里大家最常提到什么':'大家最常提到什么'}</h3><div class="keyword-cloud">${Object.entries(a.keywordCounts).sort((x,y)=>y[1]-x[1]).slice(0,18).map(([x,n])=>`<span class="kw">${x} <b>${n}</b></span>`).join('')}</div><div class="plain-note" style="margin-top:15px">${a.consumerDifferenceMentions} 条文本提到偏色、色差或“和图片不一样”等线索。${is274?' 对 274 来说，其中一部分矛盾可能来自版本混用，因此不能直接解释成修图或产品不稳定。':' '}复购或回头客 ${a.reviewQuality.repeatBuyer} 条；负向体验 ${a.reviewQuality.negativeEvidence} 条；信息量很低的泛评 ${a.reviewQuality.genericTemplate} 条会降低权重。</div></div>
  <div class="panel"><h3>与你情况相关的真实反馈</h3><div class="review-list" id="reviews">${c.reviews.slice(0,7).map(reviewCard).join('')}</div></div>
 </section>

 ${colorSection}

 <section class="details-grid">
  <div class="panel"><h3>${is274?'为什么 274 不能只看一个总分？':'为什么会得到这个参考分？'}</h3>
   ${is274
    ? `<div class="plain-note">因为这个色号的风险不是单一的“图片异常”，还包括版本归属不清、旧款与新款混杂、回答者引用另一个 274 产品等证据归属问题。TrueTone 会把这些不确定性单独说明，而不是全部折算成“内容造假”。</div>`
    : ((a.findings||[]).length?(a.findings||[]).map(f=>`<div class="finding"><span class="severity ${f.severity}">${f.severity==='high'?'高风险':f.severity==='medium'?'中风险':'低风险'}</span><div><strong>${esc(f.type)}</strong><p>在 ${f.count||1} 个样本里出现，因此会降低一些参考价值。</p></div></div>`).join(''):'<div class="plain-note">目前没有看到特别强的异常信号，但这仍不代表每一张图都能完全还原实物。</div>')}
  </div>
  <div class="panel"><h3>哪些差异属于正常变化？</h3><div class="review-list">${c.normal.map(x=>`<div class="review"><p>${esc(x)}</p></div>`).join('')||'<div class="plain-note">当前文本证据不足以细分更多正常变化。</div>'}</div></div>
 </section>

 <section class="panel report-section"><div class="section-head"><div><div class="eyebrow">怎样让试色更容易比较</div><h2 style="font-size:28px">如果你想知道“怎样的种草更值得信”</h2></div><p>这部分总结了什么样的试色内容更容易被消费者正确比较。</p></div><div class="review-list">${creatorAdviceForProduct(p).map(s=>`<article class="review"><p><b>${esc(s.title)}</b><br><span style="color:var(--muted)">我们发现：</span>${esc(s.issue)}<br><span style="color:var(--muted)">可以怎么做：</span>${esc(s.how)}<br><span style="color:var(--muted)">这样做的原因：</span>${esc(s.why)}<br><span style="color:var(--gold)">会带来的好处：</span>${esc(s.impact)}</p></article>`).join('')}</div></section>

 <section class="cta-band"><div><h3>想知道 #${p.shade} 在你脸上可能怎么呈现？</h3><p>${is274?'如果是 274，最好先确认具体版本；无法确认时，TrueTone 会按家族级参考而不是假装精确到某一版。':'上传自拍后，TrueTone 会优先从真实样本里找更接近你当前光照和使用情况的参考图与评论。'}</p></div><a class="primary-btn" href="#/tryon?p=${p.key}">上传自拍</a></section>
 <section class="cta-band"><div><h3>喜欢这个方向吗？</h3><p>不喜欢也没关系，可以换成更橘、更浅或不同质地，再看相似色号。</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="secondary-btn" id="like">喜欢，看看相似色</button><button class="ghost-btn" id="warmer">想更橘一点</button><a class="ghost-btn" href="#/compare">我在纠结两个色号</a></div></section>`);

 $$('.filter-btn[data-prof]').forEach(b=>b.onclick=()=>{
   $$('.filter-btn[data-prof]').forEach(x=>x.classList.remove('active'));
   b.classList.add('active');
   const prof=b.dataset.prof,cc=buildProductConsumerSummary(p,prof);
   $('#reviews').innerHTML=cc.reviews.slice(0,7).map(reviewCard).join('')||'<div class="plain-note">当前数据中没有足够匹配评论。</div>';
 });
 $$('.media-card[data-media]').forEach(x=>x.onclick=()=>openMedia(p,x.dataset.media));
 $$('.cloud-media-card[data-cloud-url]').forEach(x=>x.onclick=()=>{
   modalContent.innerHTML=`<div class="eyebrow">真实试色参考</div><h2 id="modal-title">原始高清样本</h2><img src="${esc(x.dataset.cloudUrl)}" style="width:100%;max-height:640px;object-fit:contain;background:#090807;border-radius:14px"><p style="color:var(--muted);line-height:1.7">该图片来自阿里云 OSS 私有样本库，通过短时签名地址加载，仅用于当前 Demo 展示。</p>`;
   openModal();
 });
 $('#like').onclick=()=>recommend(p,false);
 $('#warmer').onclick=()=>recommend(p,true);
}

function recommend(p,warm){const candidates=manifest.products.filter(x=>x.key!==p.key).map(x=>({p:x,d:circularHueDistance(p.analysis.center.hue,x.analysis.center.hue)+(warm?(x.analysis.center.hue<p.analysis.center.hue?18:0):0)})).sort((a,b)=>a.d-b.d).slice(0,3);modalContent.innerHTML=`<div class="eyebrow">相似色号</div><h2 id="modal-title">${warm?'更偏暖 / 橘一点的方向':'相似色号'}</h2><p>这里只比较当前 Demo 已收录的色号，帮你快速看看有没有更接近你想要的方向。</p><div class="shade-grid">${candidates.map(x=>shadeCard(x.p)).join('')}</div>`;openModal()}
function openMedia(p,id){const m=p.media.find(x=>x.id===id);if(!m)return;modalContent.innerHTML=`<div class="eyebrow">${m.platform} · 这张图的参考价值</div><h2 id="modal-title">参考价值 ${Math.round(m.referenceScore||0)}/100</h2>${m.thumb?`<img src="${m.thumb}" style="width:100%;max-height:520px;object-fit:contain;background:#090807;border-radius:14px">`:''}<div class="details-grid" style="margin-top:15px"><div class="panel"><h3>图片观感</h3><p>颜色方向 ${m.metrics?.hue??'—'}°<br>浓淡 ${m.metrics?.saturation??'—'}%<br>明暗 ${m.metrics?.brightness??'—'}%<br>光照：${m.metrics?.lighting||'—'}</p></div><div class="panel"><h3>为什么值得看 / 为什么要谨慎</h3><p>${esc((m.reasons||[]).join('；')||'当前样本未记录额外说明')}</p></div></div>`;openModal()}

async function verify(){
 await getManifest();page(`<div class="route-head"><a class="backlink" href="#/">← 首页</a><div class="eyebrow" style="margin-top:22px">上传试色核验</div><h1>这张试色，值得你参考吗？</h1><p>图片只在当前浏览器中读取像素。可一次上传多张；多图会自动做跨图一致性比较与推荐排序。</p></div><section class="upload-shell"><label class="dropzone" id="drop"><input id="verify-input" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><div><div class="upload-icon">＋</div><h3>拖进来，或点这里选择图片</h3><p>JPG / PNG / WEBP · 支持多张 · 可删除、追加</p></div></label><div class="file-previews" id="previews"></div><div class="form-row"><select class="select" id="source"><option>小红书</option><option>淘宝/电商</option><option>用户实拍</option><option>其他</option></select><select class="select" id="match-product"><option value="">不与已有色号比较</option>${opts('')}</select><button class="primary-btn" id="run-verify" disabled>开始 TrueTone 分析</button></div><div class="progress"><i id="vprogress"></i></div><div class="agent-run hidden" id="agent-run"><div class="agent-steps"><div class="agent-step" data-a="1">颜色与光线</div><div class="agent-step" data-a="2">不同图片是否一致</div><div class="agent-step" data-a="3">购买参考</div><div class="agent-step" data-a="4">内容透明度建议</div></div></div></section><div id="verify-results"></div>`);
 const input=$('#verify-input'),drop=$('#drop');drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};drop.ondragleave=()=>drop.classList.remove('drag');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');addVerify([...e.dataTransfer.files])};input.onchange=()=>addVerify([...input.files]);$('#run-verify').onclick=runVerify
}
function addVerify(fs){verifyFiles.push(...fs.filter(f=>f.type.startsWith('image/')));renderVerifyPreviews()}
function renderVerifyPreviews(){const el=$('#previews');el.innerHTML=verifyFiles.map((f,i)=>`<div class="preview-card"><button class="remove-file" data-i="${i}">×</button><img src="${URL.createObjectURL(f)}"><div class="meta">${esc(f.name)}</div></div>`).join('');$$('.remove-file').forEach(b=>b.onclick=e=>{e.preventDefault();verifyFiles.splice(+b.dataset.i,1);renderVerifyPreviews()});$('#run-verify').disabled=!verifyFiles.length}
async function runVerify(){const btn=$('#run-verify');btn.disabled=true;verifyAnalyses=[];$('#agent-run').classList.remove('hidden');const steps=$$('.agent-step');steps.forEach(x=>x.className='agent-step');steps[0].classList.add('active');for(let i=0;i<verifyFiles.length;i++){verifyAnalyses.push(await analyzeImageFile(verifyFiles[i]));$('#vprogress').style.width=((i+1)/verifyFiles.length*55)+'%'}steps[0].className='agent-step done';steps[1].className='agent-step active';let p=null;if($('#match-product').value)p=await getProduct($('#match-product').value);await wait(220);const report=runFourAgents(verifyAnalyses,p);steps[1].className='agent-step done';steps[2].className='agent-step active';await wait(180);steps[2].className='agent-step done';steps[3].className='agent-step active';await wait(150);steps[3].className='agent-step done';$('#vprogress').style.width='100%';renderVerifyResults(report);btn.disabled=false;btn.textContent='重新分析'}
function renderVerifyResults(r){const ranked=verifyAnalyses.map((x,i)=>({x,i,score:Math.max(25,95-(x.metrics.saturation>75?8:0)-(x.metrics.sceneBrightness>80?8:0)-(x.metrics.sceneBrightness<30?4:0)-((x.metrics.lighting==='暖光'||x.metrics.lighting==='冷光')?4:0))})).filter(q=>q.x.metrics.roiDetected!==false).sort((a,b)=>b.score-a.score);$('#verify-results').innerHTML=`<section class="report-hero"><div class="panel"><div class="eyebrow">分析完成</div><div class="conclusion">${esc(r.summary)}</div><div class="plain-note">分析置信度：${r.confidence}% · 输入 ${verifyAnalyses.length} 张图片</div></div><div class="panel score-panel"><div class="score-ring" style="--score:${r.score??0}"><b>${r.score??'—'}</b></div><div class="score-label"><strong>参考可信度</strong>来自真实图片观感与项目原评分规则。</div></div></section><section class="panel report-section"><h3>最值得参考的上传图片</h3><div class="top-media">${ranked.slice(0,3).map((q,n)=>`<article class="media-card"><img src="${q.x.views.original}"><div class="media-card-body"><div class="rank">#${n+1} · ${q.score}/100</div><div class="source-line">${q.x.metrics.lighting}</div><div class="reason">${q.x.metrics.lighting} · 点击下方“查看图片分析依据”可看详细数值</div></div></article>`).join('')}</div></section><section class="panel report-section"><h3>查看图片分析依据</h3><div class="filter-row" id="diag-tabs">${verifyAnalyses.map((x,i)=>`<button class="filter-btn ${i?'':'active'}" data-img="${i}">图 ${i+1}</button>`).join('')}</div><div id="diag"></div></section><section class="details-grid"><div class="panel"><h3>为什么是这个分数？</h3>${r.findings.map(f=>`<div class="finding"><span class="severity ${f.severity}">${f.severity}</span><div><strong>${esc(f.type)}</strong><p>${esc(f.evidence)} · ${esc(f.impact)}</p></div></div>`).join('')||'<div class="plain-note">未触发明显视觉风险；仍不代表“绝对真实”。</div>'}</div><div class="panel"><h3>给内容创作者的改进建议</h3>${r.suggestions.map(s=>`<div class="review"><p><b>${esc(s.title)}</b><br>${esc(s.why)}<br><span style="color:var(--gold)">预期改善：</span>${esc(s.impact)}</p></div>`).join('')}</div></section>`;$$('#diag-tabs .filter-btn').forEach(b=>b.onclick=()=>showDiag(+b.dataset.img));showDiag(0)}
function showDiag(i){const x=verifyAnalyses[i];$$('#diag-tabs .filter-btn').forEach((b,n)=>b.classList.toggle('active',n===i));$('#diag').innerHTML=`<div class="diagnostic-tabs"><button class="tab-btn active" data-v="original">原图</button><button class="tab-btn" data-v="roi">识别的唇部区域</button><button class="tab-btn" data-v="saturation">浓淡</button><button class="tab-btn" data-v="brightness">明暗</button><button class="tab-btn" data-v="composite">综合查看</button></div><div class="diag-view"><img id="diag-img" src="${x.views.original}"></div><div class="plain-note" style="margin-top:10px">拍摄环境：${x.metrics.lighting}。${x.metrics.roiDetected===false?esc(x.metrics.roiReason):'已识别唇部，排除口腔内部。'}详细颜色数值仅作为内部比较依据。</div>`;$$('[data-v]').forEach(b=>b.onclick=()=>{$$('[data-v]').forEach(z=>z.classList.remove('active'));b.classList.add('active');$('#diag-img').src=x.views[b.dataset.v]})}

async function tryon(){
 await getManifest();const param=new URLSearchParams((location.hash.split('?')[1]||''));const preset=param.get('p')||'ysl-610';page(`<div class="route-head"><a class="backlink" href="#/">← 首页</a><div class="eyebrow" style="margin-top:22px">自拍个性化试色</div><h1>别问“它适不适合所有人”。<br>先看它在这张自拍里可能怎么呈现。</h1><p>只分析当前照片中的颜色、光照与唇部位置；不推断种族、年龄、身份、健康或颜值。</p></div><section class="tryon-layout"><label class="photo-stage" id="selfie-stage"><input id="selfie-input" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="empty-stage" id="selfie-empty"><div class="upload-icon">＋</div><h3>上传自然光、无滤镜、嘴唇清晰的正脸自拍</h3><p>自拍仅用于本次浏览器内分析，不上传。</p></div><img id="selfie-img" class="hidden"><div class="toggle hidden" id="try-toggle" style="position:absolute;left:14px;bottom:14px"><button class="active" data-show="tryon">颜色预览</button><button data-show="original">原自拍</button></div></label><aside class="panel try-controls"><div><div class="eyebrow">Step 1</div><h3>选择色号</h3><div class="choice-grid" id="try-products">${manifest.products.map(p=>`<button class="choice ${p.key===preset?'active':''}" data-p="${p.key}"><b>#${p.shade}</b><br><small>${esc(p.brand)} · ${esc(p.name)}</small></button>`).join('')}</div></div><div><div class="eyebrow">Step 2 · 可选</div><h3>告诉我们你的使用情况</h3><div class="form-row"><select class="select" id="lip-prof"><option value="all">唇色：不确定</option><option>浅唇</option><option>深唇</option></select><select class="select" id="tone-prof"><option value="auto">冷暖：按照片</option><option value="warm">偏暖</option><option value="neutral">中性</option><option value="cool">偏冷</option></select></div><button class="primary-btn" id="run-try" disabled>分析这张自拍的拍摄情况</button><input id="debug" type="checkbox" hidden></div><div class="quality-list" id="quality"></div></aside></section><div id="try-results"></div>`);
 const input=$('#selfie-input'),stage=$('#selfie-stage');stage.onclick=e=>{if(e.target.closest('.toggle'))return;input.click()};input.onchange=()=>{selfieFile=input.files[0];if(!selfieFile)return;const u=URL.createObjectURL(selfieFile);$('#selfie-img').src=u;$('#selfie-img').classList.remove('hidden');$('#selfie-empty').classList.add('hidden');$('#run-try').disabled=false};$$('#try-products .choice').forEach(b=>b.onclick=e=>{e.preventDefault();$$('#try-products .choice').forEach(x=>x.classList.remove('active'));b.classList.add('active')});$('#run-try').onclick=runTry
}
async function runTry(){if(!selfieFile)return;const btn=$('#run-try');btn.disabled=true;btn.textContent='正在识别唇部…';const p=await getProduct($('#try-products .active').dataset.p);try{selfieResult=await createVirtualTryOn(selfieFile,p,$('#debug').checked);$('#selfie-img').src=selfieResult.tryon;$('#try-toggle').classList.remove('hidden');$$('#try-toggle button').forEach(b=>b.onclick=e=>{e.preventDefault();$$('#try-toggle button').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('#selfie-img').src=selfieResult[b.dataset.show]});$('#quality').innerHTML=selfieResult.quality.map(x=>`<div class="quality"><span>${esc(x.label)}</span><b>${esc(x.value)}</b></div>`).join('');renderTryResult(p)}catch(e){$('#quality').innerHTML=`<div class="sku-warning">${esc(e.message)}</div>`}finally{btn.disabled=false;btn.textContent='重新分析'}}
function renderTryResult(p){const r=selfieResult,a=p.analysis,lip=$('#lip-prof').value,tone=$('#tone-prof').value;let reviews=p.reviews.filter(x=>a.representativeReviewIds.includes(x.id));if(lip!=='all'){const t=reviews.filter(x=>x.text.includes(lip));if(t.length)reviews=t}if(tone==='warm'){const t=reviews.filter(x=>/黄皮|暖调|偏暖/.test(x.text));if(t.length)reviews=t}if(tone==='cool'){const t=reviews.filter(x=>/冷白|冷调|偏冷/.test(x.text));if(t.length)reviews=t}reviews=reviews.slice(0,3);const top=p.media.filter(m=>m.thumb&&m.metrics).map(m=>({...m,personal:(m.referenceScore||0)-(m.metrics.lighting===r.light.label?0:7)-Math.abs((m.metrics.sceneBrightness||60)-r.light.brightness)*.18})).sort((x,y)=>y.personal-x.personal).slice(0,3);const c=a.center,expected={h:c.hue,s:Math.max(5,c.saturation+(r.faceRef.saturation-30)*.08),b:Math.max(5,Math.min(95,c.brightness+(r.light.brightness-60)*.12))};$('#try-results').innerHTML=`<section class="details-grid"><div class="panel"><div class="eyebrow">这张自拍的拍摄情况质量</div><h3>当前照片颜色参考</h3><div style="display:flex;gap:14px;align-items:center"><span class="swatch-dot" style="width:58px;height:58px;background:${r.faceRef.hex}"></span><div class="plain-note">${r.faceRef.tone}<br>${r.faceRef.hex} · 明度 ${r.faceRef.brightness}% · 浓淡 ${r.faceRef.saturation}%<br><small>仅代表当前照片。</small></div></div></div><div class="panel"><div class="eyebrow">预计呈现</div><h3>#${p.shade} 在这张自拍的拍摄情况中可能怎么呈现？</h3><div class="plain-note">当前为 <b style="color:#fff">${r.light.label}</b>。结合多来源参考色域，预计呈现 H ${expected.h.toFixed(1)}° · S ${expected.s.toFixed(1)}% · B ${expected.b.toFixed(1)}%。</div><div class="swatches" style="margin-top:12px"><span class="swatch-dot" title="TrueTone 参考中心" style="background:${hsvToHex(c.hue,c.saturation,c.brightness)}"></span><span class="swatch-dot" title="这张自拍的拍摄情况预计" style="background:${hsvToHex(expected.h,expected.s,expected.b)}"></span></div><div class="disclaimer">颜色预览为视觉模拟，仅供参考，不代表实物最终效果。</div></div></section><section class="panel report-section"><div class="section-head"><div><div class="eyebrow">Personal reference</div><h2 style="font-size:28px">最值得你参考的 3 张真实试色</h2></div><p>同时考虑原 reference score、与你当前光照/明暗的接近程度。</p></div><div class="top-media">${top.map((m,i)=>`<article class="media-card"><img src="${m.thumb}"><div class="media-card-body"><div class="rank">#${i+1} · ${Math.round(m.personal)}/100</div><div class="source-line">${m.platform} · ${m.metrics.lighting}</div><div class="reason">${esc((m.reasons||[])[0]||'接近参考色域')}</div></div></article>`).join('')}</div></section><section class="panel report-section"><div class="section-head"><div><div class="eyebrow">Matched comments</div><h2 style="font-size:28px">最匹配的 3 条消费者反馈</h2></div></div><div class="review-list">${reviews.map(reviewCard).join('')||'<div class="plain-note">当前没有足够匹配文本。</div>'}</div></section><section class="cta-band"><div><h3>下一步：回到完整色号报告</h3><p>把自拍预览、真实 Top 3、消费者反馈和 SKU 信息放在一起做购买判断。</p></div><a class="secondary-btn" href="#/shade/${p.key}">查看 #${p.shade} 报告</a></section>`}

async function compare(){
 await getManifest();page(`<div class="route-head"><a class="backlink" href="#/">← 首页</a><div class="eyebrow" style="margin-top:22px">色号对比</div><h1>纠结两个颜色？放在同一把尺子上。</h1><p>比较多来源参考色域、证据充分度与消费者反馈，而不只比较官方商品图。</p></div><div class="compare-pickers"><div class="compare-col"><select id="ca" class="select" style="width:100%">${opts('ysl-610')}</select></div><div class="compare-col"><select id="cb" class="select" style="width:100%">${opts('lancome-274')}</select></div></div><div id="cmp"></div>`);$('#ca').onchange=renderCmp;$('#cb').onchange=renderCmp;renderCmp()
}
async function renderCmp(){const [a,b]=await Promise.all([getProduct($('#ca').value),getProduct($('#cb').value)]);const cp=p=>`<div class="shade-brand">${esc(p.brand)}</div><div class="shade-code">#${p.shade}</div><div class="shade-name">${esc(p.name)} · ${esc(p.texture)}</div><div class="shade-swatch" style="height:130px;margin:18px 0;background:radial-gradient(circle at 40% 35%,${color(p)},#61342e 55%,#251515 100%)"></div><div class="compare-stat"><div class="stat"><b>${p.analysis.score}</b><span>参考可信度</span></div><div class="stat"><b>${p.analysis.evidenceSufficiency}</b><span>证据充分度</span></div><div class="stat"><b>${p.analysis.center.saturation}%</b><span>浓淡</span></div><div class="stat"><b>${p.analysis.center.brightness}%</b><span>明度</span></div></div><a class="secondary-btn" style="margin-top:14px" href="#/shade/${p.key}">看完整报告</a>`;$('#cmp').innerHTML=`<div class="comparison"><div class="panel">${cp(a)}</div><div class="panel">${cp(b)}</div></div><section class="panel report-section"><h3>一眼看懂差异</h3><div class="plain-note">参考色域中心的环形色相距离约 <b style="color:#fff">${circularHueDistance(a.analysis.center.hue,b.analysis.center.hue).toFixed(1)}°</b>；浓淡差 ${Math.abs(a.analysis.center.saturation-b.analysis.center.saturation).toFixed(1)}%，明度差 ${Math.abs(a.analysis.center.brightness-b.analysis.center.brightness).toFixed(1)}%。</div></section>`}

function openAbout(){modalContent.innerHTML=`<div class="eyebrow">How it works</div><h2 id="modal-title">TrueTone 不是一个“真假按钮”</h2><p>当前公开版保留项目原有四个 Agent 的职责：先做真实像素与环境分析，再按固定规则审查风险，再把证据翻译成消费者报告，最后给内容改进建议。</p><div class="method-flow"><div><b>Agent 1</b>HSV / 光照 / ROI 候选区 / 真实像素诊断</div><div><b>Agent 2</b>异常 / 跨图一致性 / 0–100 评分</div><div><b>Agent 3</b>一句话结论 / Top 3 / 评论证据</div><div><b>Agent 4</b>拍摄与创作者改进建议</div></div><p>现有产品报告使用已结构化导入的小红书 + 淘宝 sample data；169 张 JPG 已离线做真实像素统计，29 个视频保留来源与媒体元数据。自拍使用 MediaPipe Face Mesh 的唇部 landmarks → outer polygon − inner mouth mask，避免把牙齿和口腔涂色。</p><p><b style="color:#fff">关于“真实 Agent”：</b>这里的四 Agent 是会实际运行的确定性分析模块，不是随机 UI。公开 GitHub Pages 不安全地存放任何大模型 API Key；后续接入 Base44 安全后端时，可以让 LLM 只做语言整合，评分与证据仍由可复现逻辑提供。</p>`;openModal()}
function openModal(){modal.hidden=false;modal.setAttribute('aria-hidden','false');modal.style.display='grid';modal.style.pointerEvents='auto';document.body.style.overflow='hidden'}function closeModal(){modal.style.display='none';modal.style.pointerEvents='none';modal.hidden=true;modal.setAttribute('aria-hidden','true');document.body.style.overflow=''}function wait(ms){return new Promise(r=>setTimeout(r,ms))}
async function router(){try{await getManifest();const p=(location.hash.slice(1)||'/').split('?')[0];if(p==='/'||p==='/home')return home();if(p==='/seeded')return seeded();if(p==='/selfie')return selfieHome();if(p==='/search')return search();if(p.startsWith('/shade/'))return shade(p.split('/')[2]);if(p==='/verify')return verify();if(p==='/tryon')return tryon();if(p==='/compare')return compare();return home()}catch(e){console.error(e);page(`<div class="route-head"><h1>数据加载失败</h1><p>${esc(e.message)}</p><a class="secondary-btn" href="#/">返回首页</a></div>`)}}
$('#open-method').onclick=openAbout;$('#modal-close').onclick=closeModal;modal.onclick=e=>e.target===modal&&closeModal();document.addEventListener('keydown',e=>e.key==='Escape'&&closeModal());window.addEventListener('hashchange',router);router();
