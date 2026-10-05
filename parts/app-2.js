  if(brightDiff>35){penalty+=4;findings.push({level:'medium',type:'跨平台亮度差异',data:`约 ${round(brightDiff)}%`,impact:'明暗差异会影响消费者对显白/显黑的感受。'})}
  const evidenceRows=texts.filter(r=>colorEvidence(r));
  const evidenceRate=texts.length?evidenceRows.length/texts.length:0;
  if(evidenceRate>.5){penalty+=8;findings.push({level:'high',type:'消费者色差反馈集中',data:`${Math.round(evidenceRate*100)}% 的可检索文本含颜色差异线索`,impact:'网络试色与实际呈现存在较多条件差异，应优先看相似唇色与光照样本。'})}
  else if(evidenceRate>.3){penalty+=4;findings.push({level:'medium',type:'消费者色差反馈较多',data:`${Math.round(evidenceRate*100)}% 的可检索文本含颜色差异线索`,impact:'需要结合个体条件筛选证据。'})}
  const variants=d.taobao.variants||[];
  if(variants.length>1)findings.push({level:'medium',type:'同色号存在多个 SKU / 产品线',data:variants.join('、'),impact:'产品线差异不能被误判成“图片失真”。',noPenalty:true});
  let score=Math.max(25,Math.min(95,82-penalty));
  const totalImages=d.counts.xhs_images+d.counts.taobao_images,totalTexts=texts.length,platforms=(d.counts.xhs_posts?1:0)+(d.counts.taobao_reviews?1:0);
  const suff=(totalImages>=20&&totalTexts>=80&&platforms>=2)?'高':(totalImages>=8&&totalTexts>=30?'中':'低');
  const agent2={score,findings,evidenceRows,evidenceRate,suff};

  // Top reference evidence: favor repeat buyers / natural-light posts, source diversity, and color informativeness.
  const topRows=texts.map(r=>({r,score:r.weight+(keywordRegex().test(r.text)?1.1:0)+(r.text.includes('自然光')?1.5:0)+(r.text.includes('深唇')||r.text.includes('浅唇')?1:0)+(r.text.includes('氧化')?1:0)})).sort((x,y)=>y.score-x.score);
  const tbImgs=(d.taobao.images||[]).filter(x=>x.url).map(x=>({type:'image',source:'淘宝实拍',url:x.url,text:x.review_text||x.followup||'带图评价',variant:x.variant,score:purchaseWeight(x.purchase_count)+(keywordRegex().test(x.review_text||'')?1:0)})).sort((x,y)=>y.score-x.score);
  const xhsNatural=d.xhs.posts.map(p=>({type:'post',source:'小红书笔记',url:p.source_url,text:p.body||p.comments[0]||'',score:(p.body?.includes('自然光')?2:0)+(p.body?.includes('深唇')||p.body?.includes('浅唇')?1:0)+p.comments.length*.05})).filter(x=>x.text).sort((x,y)=>y.score-x.score);
  let refs=[];if(tbImgs[0])refs.push(tbImgs[0]);if(xhsNatural[0])refs.push(xhsNatural[0]);if(tbImgs[1])refs.push(tbImgs[1]);if(refs.length<3)refs.push(...topRows.slice(0,3-refs.length).map(x=>({type:'text',source:x.r.source,text:x.r.text,url:x.r.url,score:x.score})));
  const summary=buildConclusion(d,agent1,agent2);
  const agent3={summary,refs,keywords:d.keyword_counts,comments:evidenceRows.slice(0,10)};
  const suggestions=buildCreatorAdvice(agent1,agent2);
  const agent4={suggestions};
  const matched=rankPersonalEvidence(d,profile).slice(0,4);
  return {agent1,agent2,agent3,agent4,matched};
}

function buildConclusion(d,a1,a2){
  const shade=d.meta.shade, sku=(d.taobao.variants||[]).length>1;
  if(sku)return `#${shade} 的样本量很充足，但当前同色号包含多个产品线。先分清 SKU，再看色差，比简单问“哪张最真实”更重要。`;
  if(a1.hueDiff>60)return `#${shade} 的跨平台色彩方向差异比较明显。现有证据更支持“光照、唇色与内容条件共同造成差异”，不能仅凭差异断言 P 图。`;
  if(a2.evidenceRate>.3)return `#${shade} 的视觉样本整体可参考，但消费者对氧化、唇色或明暗差异的反馈较多，建议优先看与你条件相似的返图。`;
  return `#${shade} 的跨平台主色整体较接近，当前没有足够证据支持强烈的“失真”判断；购买前仍建议比较自然光与相似唇色样本。`;
}
function buildCreatorAdvice(a1,a2){
  const arr=[];
  if(a1.brightDiff>12)arr.push({title:'补充标准中性光或自然光样本',why:'不同来源亮度存在可见差异。',impact:'减少消费者把光照差异误认为产品色差。'});
  if(a1.satDiff>8)arr.push({title:'避免后期过度增饱和，并标注拍摄设备',why:'不同来源饱和度存在差异。',impact:'降低“图片比实物鲜艳”的误导风险。'});
  arr.push({title:'增加素唇 + 薄涂 / 厚涂对比',why:'唇色和涂抹厚度是口红色差的重要正常来源。',impact:'帮助不同唇色消费者判断自己更可能看到什么效果。'});
  return arr;
}
function rankPersonalEvidence(d,profile){
  const rows=flattenTexts(d);const terms=[profile.lip,profile.style,profile.finish].filter(Boolean);
  return rows.map(r=>{let s=r.weight;for(const t of terms)if(r.text.includes(t))s+=3;if(r.text.includes('自然光'))s+=.7;if(r.text.includes('氧化'))s+=.4;return {...r,matchScore:s}}).sort((a,b)=>b.matchScore-a.matchScore);
}

async function openProduct(key){
  const p=productByKey(key),d=await loadProduct(key);state.product=key;state.profile={lip:null,style:null,finish:null};
  $('#shadeBrand').textContent=p.brand;$('#shadeCode').textContent=`#${p.shade}`;$('#shadeFinish').textContent=p.finish;$('#shadeDisplay').textContent=p.display;
  const stats=d.visual_sample.source_stats;const hues=Object.values(stats).map(x=>x.hue);const avgHue=hues.length?median(hues):20;
  $('#referenceSpectrum').innerHTML=[-10,-5,0,5,10].map(x=>`<i style="background:${hueHex((avgHue+x+360)%360,38,68)}"></i>`).join('');
  $('#shadeDatasetSummary').textContent=`${d.counts.xhs_posts} 篇小红书笔记 / ${d.counts.xhs_comments} 条评论 · ${d.counts.taobao_reviews} 条淘宝评价 · ${d.counts.taobao_images} 张电商带图评价`;
