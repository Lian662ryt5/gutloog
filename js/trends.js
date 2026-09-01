/* ---- Trends ---- */
let trendRange = 14;
document.querySelectorAll('.trend-tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.trend-tabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    trendRange = +btn.dataset.range;
    renderTrends();
  });
});

function renderTrends(){
  const chart = document.getElementById('trendChart');
  if(!chart) return;
  const days = [];
  for(let i=trendRange-1;i>=0;i--){
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
    days.push(d);
  }
  const counts = days.map(d=>{
    const dayEntries = entries.filter(e=>{
      if(e.kind !== 'stool') return false;
      const ed = new Date(e.ts); ed.setHours(0,0,0,0);
      return ed.getTime() === d.getTime();
    });
    const flagged = dayEntries.filter(e=> e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2)).length;
    return {total: dayEntries.length, flagged};
  });
  const max = Math.max(1, ...counts.map(c=>c.total));
  const CHART_H = 100; // px — matches .trend-bars container scale
  const showEvery = trendRange <= 14 ? 1 : (trendRange <= 30 ? 5 : 15);
  const bars = counts.map((c,i)=>{
    const h = Math.round((c.total/max)*CHART_H);
    const fh = Math.round((c.flagged/max)*CHART_H);
    return `<div class="trend-bar-col">
      <div class="trend-bar" style="height:${h}px;position:relative;">
        ${c.flagged ? `<div class="trend-bar flag" style="height:${fh}px;position:absolute;bottom:0;width:100%;"></div>` : ''}
      </div>
    </div>`;
  }).join('');
  const labels = days.map((d,i)=> (i % showEvery === 0) ? `<span>${d.toLocaleDateString(undefined,{month:'numeric',day:'numeric'})}</span>` : '<span></span>').join('');
  chart.innerHTML = `<div class="trend-bars">${bars}</div><div class="trend-labels">${labels}</div>`;

  const byLoc = document.getElementById('trendByLocation');
  renderFoodCorrelation();
  const linked = entries.filter(e=>e.restId);
  if(!linked.length){
    byLoc.innerHTML = '<div class="empty">Link entries to a saved spot to see patterns here.</div>';
    return;
  }
  const groups = {};
  linked.forEach(e=>{
    if(!groups[e.restName]) groups[e.restName] = {total:0, flagged:0, types:[]};
    groups[e.restName].total++;
    groups[e.restName].types.push(e.type);
    if(e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2)) groups[e.restName].flagged++;
  });
  byLoc.innerHTML = Object.entries(groups).sort((a,b)=>b[1].total-a[1].total).map(([name,g])=>{
    const avgType = (g.types.reduce((s,t)=>s+t,0)/g.types.length).toFixed(1);
    return `<div class="rest-card">
      <div class="rname">${escapeHtml(name)}</div>
      <div class="rnote">${g.total} visit${g.total>1?'s':''} logged · avg type ${avgType}${g.flagged ? ` · ${g.flagged} flagged` : ''}</div>
    </div>`;
  }).join('');
}

function renderFoodCorrelation(){
  const el = document.getElementById('foodCorrelation');
  if(!el) return;
  const flares = entries.filter(e=> e.kind === 'stool' && (e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2)));
  const foods = entries.filter(e=> e.kind === 'food');
  if(!flares.length || !foods.length){
    el.innerHTML = '<div class="empty">Log some food and flagged symptoms to see patterns here.</div>';
    return;
  }
  const WINDOW_MS = 48*3600*1000;
  const counts = {};
  flares.forEach(flare=>{
    const flareTime = new Date(flare.ts).getTime();
    const seenThisFlare = new Set();
    foods.forEach(f=>{
      const ft = new Date(f.ts).getTime();
      if(ft <= flareTime && ft >= flareTime - WINDOW_MS){
        const key = f.foodName.trim().toLowerCase();
        if(seenThisFlare.has(key)) return;
        seenThisFlare.add(key);
        if(!counts[key]) counts[key] = {name:f.foodName, flareCount:0};
        counts[key].flareCount++;
      }
    });
  });
  const results = Object.values(counts).filter(c=>c.flareCount>0).sort((a,b)=>b.flareCount-a.flareCount).slice(0,8);
  if(!results.length){
    el.innerHTML = '<div class="empty">No foods logged within 48h of a flagged entry yet.</div>';
    return;
  }
  el.innerHTML = results.map(r=>`
    <div class="correlation-item">
      <span class="cname">${escapeHtml(r.name)}</span>
      <span class="ccount">before ${r.flareCount} flare${r.flareCount>1?'s':''}</span>
    </div>
  `).join('');
}

function renderQuickRepeat(){
  const slot = document.getElementById('quickRepeatSlot');
  if(!slot) return;
  const last = entries.find(e=> e.kind === 'stool');
  if(!last){ slot.innerHTML = ''; return; }
  const tagTxt = last.tags.length ? last.tags.map(t=>TAG_LABELS[t]||t).join(', ') : 'no symptoms';
  slot.innerHTML = `
    <div class="quick-repeat">
      <div><b>Same as last time?</b><span>Type ${last.type} · ${tagTxt}</span></div>
      <button id="quickRepeatBtn">↻ Log it now</button>
    </div>`;
  document.getElementById('quickRepeatBtn').addEventListener('click', async ()=>{
    const btn = document.getElementById('quickRepeatBtn');
    btn.disabled = true; btn.textContent = 'Logging…';
    const row = {
      ts: new Date().toISOString(),
      kind: 'stool',
      type: last.type,
      tags: [...last.tags],
      pain: last.pain,
      rest_id: last.restId || null,
      rest_name: last.restName || null,
      note: ''
    };
    try{
      const { data, error } = await sb.from('entries').insert(row).select().single();
      if(error) throw error;
      entries.unshift(rowToEntry(data));
    }catch(e){ console.error('quick repeat failed', e); alert('Could not save — check your connection.'); }
    render();
  });
}

