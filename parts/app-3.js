  $('#shadeReport').classList.add('hidden');$('#shadeStartCard').classList.remove('hidden');showView('shade');
}

function renderShadeReport(d,res){
  const {agent1,agent2,agent3,agent4}=res;$('#shadeStartCard').classList.add('hidden');$('#shadeReport').classList.remove('hidden');
  $('#scoreValue').textContent=Math.round(agent2.score);$('#scoreDial').style.setProperty('--score',agent2.score);
  $('#scoreLevel').textContent=agent2.score>=80?'高参考价值':agent2.score>=60?'中等参考价值':'需谨慎参考';$('#evidenceLevel').textContent=`证据充分度：${agent2.suff}`;
  $('#oneLineConclusion').textContent=agent3.summary;
  $('#whyBox').innerHTML=agent2.findings.length?agent2.findings.map(f=>`<div><b>${escapeHtml(f.type)}</b> · ${escapeHtml(f.data)}<br><span>${escapeHtml(f.impact)}</span></div>`).join('<hr>'):`<div><b>当前没有触发明显的高风险规则。</b><br><span>这不等于“绝对真实”，只表示在现有样本中没有足够证据支持强烈异常判断。</span></div>`;
  renderReferences(agent3.refs,d);
  renderKeywords(d.keyword_counts);renderComments(agent3.comments);
  renderSourceCompare(agent1,d,agent4);renderMatched(d);
}
function renderReferences(refs,d){
  $('#topReferences').innerHTML=refs.slice(0,3).map((r,i)=>{
    const img=r.type==='image'&&r.url?`<img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(r.url)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="swatch-fallback" style="display:none;--c1:${hueHex(18+i*7,38,72)};--c2:${hueHex(12+i*7,44,45)}">真实样本 #${i+1}</div>`:`<div class="swatch-fallback" style="--c1:${hueHex(20+i*8,36,70)};--c2:${hueHex(10+i*6,44,44)}">${r.source}</div>`;
    const reason=i===0?'信息量与可信线索更完整':i===1?'补充了光照 / 唇色等使用条件':'提供另一来源的交叉参考';
    return `<article class="reference-card"><div class="reference-media">${img}<span class="reference-tag">TOP ${i+1} · ${escapeHtml(r.source)}</span></div><div class="content"><h4>${reason}</h4><p>${highlight((r.text||'').slice(0,120))}</p>${r.url?`<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">查看来源 ↗</a>`:''}</div></article>`
  }).join('');
}
function renderKeywords(kc){
  const sorted=Object.entries(kc||{}).sort((a,b)=>b[1]-a[1]).slice(0,18);$('#keywordCloud').innerHTML=sorted.map(([k,v])=>`<span class="evidence-chip">${escapeHtml(k)} <b>${v}</b></span>`).join('')||'<span class="evidence-chip">当前未提取到明确色差关键词</span>'
}
function renderComments(rows){$('#commentEvidence').innerHTML=rows.slice(0,8).map(r=>`<div class="comment-card">${highlight(r.text.slice(0,210))}<small>${escapeHtml(r.source)}${r.variant?' · '+escapeHtml(r.variant):''}</small></div>`).join('')}
function renderSourceCompare(a1,d,a4){
  const s=a1.sourceStats;$('#sourceCompare').innerHTML=['小红书','淘宝'].map(src=>{const v=s[src]||{hue:0,saturation:0,brightness:0};return `<div class="source-box"><h4>${src}</h4>${[['Hue',v.hue,360],['Saturation',v.saturation,100],['Brightness',v.brightness,100]].map(([n,val,max])=>`<div class="hsv-row"><span>${n}</span><div class="track"><div class="fill" style="width:${Math.min(100,val/max*100)}%"></div></div><b>${round(val)}</b></div>`).join('')}</div>`}).join('');
  $('#technicalEvidence').innerHTML=`<p><b>环形 Hue 差：</b>${round(a1.hueDiff)}° · <b>饱和度差：</b>${round(a1.satDiff)}% · <b>亮度差：</b>${round(a1.brightDiff)}%</p><p><b>证据集：</b>${d.counts.xhs_images} 张小红书图片、${d.counts.xhs_videos} 个视频、${d.counts.taobao_images} 张电商带图评价；文字包括 ${d.counts.xhs_comments} 条小红书评论、${d.counts.taobao_reviews} 条淘宝评价和 ${d.counts.taobao_asks} 条问大家。</p><p><b>创作者改进：</b>${a4.suggestions.map(x=>`${escapeHtml(x.title)}（${escapeHtml(x.why)}）`).join('；')}</p><p>说明：预置数据集的视觉统计来自已整理的样本图；用户上传图片会实时读取像素，并在 Face Landmarker 可用时优先分析唇部 ROI。</p>`;
}
function renderMatched(d){
  const rows=rankPersonalEvidence(d,state.profile).slice(0,4);$('#matchedEvidence').innerHTML=rows.map(r=>`<div class="match-item"><div class="match-source">${escapeHtml(r.source)}</div><p>${highlight(r.text.slice(0,240))}</p><div class="match-score">匹配 ${Math.round(Math.min(99,55+r.matchScore*10))}%</div></div>`).join('')||'<p>选择上面的条件后，这里会重新排序真实评论证据。</p>'
}

function renderRecommendations(current,direction='similar'){
  const curr=productByKey(current),currData=DATA.get(current);const h0=median(Object.values(currData.visual_sample.source_stats).map(x=>x.hue));
  const others=CATALOG.filter(x=>x.key!==current).map(p=>{const d=DATA.get(p.key);const h=median(Object.values(d.visual_sample.source_stats).map(x=>x.hue));let sc=100-circularHueDistance(h0,h);if(direction==='orange')sc+=h<45?18:0;if(direction==='clean')sc+=(d.visual_sample.cross_platform?.saturation_diff||0)<8?12:0;if(direction==='bold')sc+=p.key==='ysl1936'?20:0;return {p,score:sc,d}}).sort((a,b)=>b.score-a.score);
  $('#recommendations').classList.remove('hidden');$('#recommendations').innerHTML=`<div class="recommendation-grid">${others.map(({p,score})=>`<button class="recommendation-card" data-product="${p.key}"><span class="eyebrow">相似度 ${Math.max(60,Math.round(score))}%</span><b>${p.brand} #${p.shade}</b><p>${p.display} · ${p.finish}</p></button>`).join('')}</div>`;
  $$('#recommendations [data-product]').forEach(b=>b.onclick=()=>openProduct(b.dataset.product));
}

async function runVerify(){
