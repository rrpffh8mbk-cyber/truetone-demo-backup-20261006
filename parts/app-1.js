
const CATALOG = [
  {key:'ysl610',label:'YSL 610',brand:'YSL 圣罗兰',shade:'610',display:'冰乌龙 / 冷萃奶茶',finish:'镜面唇釉'},
  {key:'ysl1936',label:'YSL 1936',brand:'YSL 圣罗兰',shade:'1936',display:'复古棕红',finish:'唇膏'},
  {key:'lancome274',label:'兰蔻 274',brand:'Lancôme 兰蔻',shade:'274',display:'杏仁奶茶 / 奶茶裸',finish:'多产品线'},
  {key:'lancome275',label:'兰蔻 275',brand:'Lancôme 兰蔻',shade:'275',display:'暖棕奶茶',finish:'裸唇釉'}
];
const DATA = new Map();
const state={view:'home',product:null,profile:{lip:null,style:null,finish:null},verifyFiles:[],selfieFile:null,selfieShade:'ysl610',selfieLip:null,selfieAnalysis:null,selfieTryon:null};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escapeHtml=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const DATA_FILES={
  ysl610:['./data/ysl610.json.gz.b64'],
  ysl1936:['./data/ysl1936.json.gz.b64'],
  lancome274:['./data/lancome274.1.b64','./data/lancome274.2.b64','./data/lancome274.3.b64','./data/lancome274.4.b64'],
  lancome275:['./data/lancome275.1.b64','./data/lancome275.2.b64','./data/lancome275.3.b64','./data/lancome275.4.b64']
};
async function inflateBase64Gzip(b64){
  const clean=b64.replace(/\s+/g,'');
  const bin=Uint8Array.from(atob(clean),c=>c.charCodeAt(0));
  if(typeof DecompressionStream==='undefined') throw new Error('当前浏览器不支持 gzip 数据解压，请使用最新版 Chrome / Edge / Safari。');
  const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
async function loadProduct(key){
  if(DATA.has(key)) return DATA.get(key);
  const paths=DATA_FILES[key];
  if(!paths) throw new Error('未知产品 '+key);
  const pieces=await Promise.all(paths.map(async p=>{const r=await fetch(p,{cache:'no-store'});if(!r.ok)throw new Error('无法读取 '+p);return r.text()}));
  const json=await inflateBase64Gzip(pieces.join(''));
  const d=JSON.parse(json);DATA.set(key,d);return d;
}
function productByKey(key){return CATALOG.find(x=>x.key===key)}
function showView(name){state.view=name;$$('.view').forEach(v=>v.classList.toggle('is-active',v.id===`view-${name}`));window.scrollTo({top:0,behavior:'instant'});history.replaceState(null,'',`#${name}`)}
function hueHex(h,s=42,v=70){const f=(n,k=(n+h/60)%6)=>v/100-v/100*s/100*Math.max(Math.min(k,4-k,1),0);return '#'+[5,3,1].map(n=>Math.round(255*f(n)).toString(16).padStart(2,'0')).join('')}
function median(nums){const a=[...nums].sort((x,y)=>x-y);return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:0}
function round(n,d=1){return Number(n||0).toFixed(d)}
function keywordRegex(){return /(偏暗|偏亮|偏粉|偏紫|偏红|偏橘|偏棕|色差|滤镜|不一样|实物|图片|氧化|深唇|浅唇|自然光|暖光|冷光|薄涂|厚涂|显黑|显白|原相机|无滤镜|唇线|刷子)/g}
function highlight(text){return escapeHtml(text||'').replace(keywordRegex(),'<mark>$1</mark>')}

function flattenTexts(d){
  const rows=[];
  d.xhs.posts.forEach((p,pi)=>{if(p.body)rows.push({source:'小红书正文',text:p.body,url:p.source_url,weight:2,post:pi});p.comments.forEach(c=>rows.push({source:'小红书评论',text:c,url:p.source_url,weight:1,post:pi}))});
  d.taobao.reviews.forEach(r=>{if(r.text)rows.push({source:'淘宝评价',text:r.text,variant:r.variant,weight:purchaseWeight(r.purchase_count),meta:r});if(r.followup)rows.push({source:'淘宝追评',text:r.followup,variant:r.variant,weight:purchaseWeight(r.purchase_count)+.5,meta:r})});
  d.taobao.asks.forEach(a=>{if(a.answer)rows.push({source:'淘宝问大家',text:a.answer,variant:a.variant,weight:a.buyer_tag?.includes('已购')?1.4:1,meta:a})});
  return rows.filter(x=>x.text);
}
function purchaseWeight(s){if(!s)return 1;const m=s.match(/买过(\d+)次/);return m?Math.min(2.4,1+Number(m[1])*.25):1}
function colorEvidence(row){return keywordRegex().test(row.text)}

function runDatasetAgents(d,profile=state.profile){
  const texts=flattenTexts(d), visual=d.visual_sample, imgs=visual.images||[];
  // Agent 1: color analyst on actual precomputed image sample metrics.
  const bySource={};for(const im of imgs){(bySource[im.source]??=[]).push(im)}
  const sourceStats=visual.source_stats||{};
  const a=sourceStats['小红书'],b=sourceStats['淘宝'];
  const hueDiff=a&&b?circularHueDistance(a.hue,b.hue):0, satDiff=a&&b?Math.abs(a.saturation-b.saturation):0, brightDiff=a&&b?Math.abs(a.brightness-b.brightness):0;
  const agent1={sourceStats,hueDiff,satDiff,brightDiff,images:imgs};

  // Agent 2: strict evidence rules; positive sentiment is never used as truth.
  const findings=[];let penalty=0;
  const highFlags=imgs.flatMap(x=>(x.metrics.flags||[]).filter(f=>f.level==='high'));
  const medFlags=imgs.flatMap(x=>(x.metrics.flags||[]).filter(f=>f.level==='medium'));
  const lowFlags=imgs.flatMap(x=>(x.metrics.flags||[]).filter(f=>f.level==='low'));
  penalty+=highFlags.length*4+medFlags.length*2+lowFlags.length;
  if(hueDiff>100){penalty+=8;findings.push({level:'high',type:'跨平台色相差异',data:`环形 Hue 差约 ${round(hueDiff)}°`,impact:'不同平台看到的色彩方向可能明显不同。'})}
  else if(hueDiff>60){penalty+=4;findings.push({level:'medium',type:'跨平台色相差异',data:`环形 Hue 差约 ${round(hueDiff)}°`,impact:'建议结合光照和具体 SKU 再判断。'})}
  if(satDiff>30){penalty+=4;findings.push({level:'medium',type:'跨平台饱和度差异',data:`约 ${round(satDiff)}%`,impact:'一侧平台的内容可能显得更鲜艳。'})}
