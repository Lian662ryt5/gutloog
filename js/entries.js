const BRISTOL = [
  {n:1, label:"Hard lumps", path:"M14 24c-2-3-1-7 3-8s5 3 3 6c3-2 6 0 5 3s-4 4-7 3c-3 2-6-1-4-4z M28 22c2-3 1-6-2-7s-5 2-3 5c-2-2-5 0-4 3s3 3 5 2c2 1 5-1 4-3z"},
  {n:2, label:"Lumpy log", path:"M8 20c0-4 4-6 9-6s10 2 14 5 4 6 1 8-9 3-15 3-9-6-9-10z"},
  {n:3, label:"Cracked log", path:"M6 20c0-5 6-7 14-7s14 3 14 7-6 6-14 6-14-1-14-6z"},
  {n:4, label:"Smooth log", path:"M5 20c0-4 7-6 15-6s15 2 15 6-7 5-15 5-15-1-15-5z"},
  {n:5, label:"Soft blobs", path:"M8 16c3-1 5 1 5 4s-2 5-5 5-5-3-4-6 2-3 4-3z M18 15c3-1 6 1 6 5s-3 5-6 5-6-3-5-6 2-4 5-4z M29 17c2-1 5 1 4 4s-2 4-4 4-4-2-4-4 1-3 4-4z"},
  {n:6, label:"Mushy, ragged", path:"M6 18c4-3 8-1 9 2 2-2 6-2 7 1 3-2 7 0 7 3 0 4-6 4-10 3-3 2-8 2-11-1-3-2-4-6-2-8z"},
  {n:7, label:"Liquid", path:"M4 17c6-2 10 1 14-1s10-2 16 0M4 22c6-2 10 1 14-1s10-2 16 0"}
];

function bristolSVG(n, strokeOnly){
  const b = BRISTOL[n-1];
  const stroke = strokeOnly ? "var(--ink-soft)" : "var(--teal-deep)";
  const fill = strokeOnly ? "none" : "var(--teal-soft)";
  if(n===7){
    return `<svg viewBox="0 0 40 32"><path d="${b.path}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 40 32"><path d="${b.path}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

let selectedType = null;
let selectedTags = new Set();
let selectedPain = null;
let entries = [];

const ENTRIES_PAGE_SIZE = 30;
let entriesHasMore = true;
let entriesLoadingMore = false;
let entriesDateFilter = null; // {from:'YYYY-MM-DD', to:'YYYY-MM-DD'} or null

// Account-wide aggregates, kept separate from the paginated `entries` array
// above so streaks/badges/weekly stats/totals stay correct regardless of how
// much history is actually loaded into memory for display.
const STREAK_LOOKBACK_DAYS = 400; // comfortably covers any realistic daily-logging streak
let streakTimestamps = [];   // stool-entry ts strings within the lookback window
let weeklyStoolEntries = []; // full stool entry rows from the last 7 days (need type/tags/pain)
let weeklyAllCount = 0;      // count of entries of any kind in the last 7 days
let totalEntriesCount = 0;   // true total across all kinds, all history
let totalFoodCount = 0;      // true total, kind='food', all history

async function loadAccountStats(){
  await ensureAuth();
  const since = new Date(); since.setDate(since.getDate() - STREAK_LOOKBACK_DAYS); since.setHours(0,0,0,0);
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString();
  try{
    const [streakRes, weekRes, weekAllRes, totalRes, foodRes] = await Promise.all([
      sb.from('entries').select('ts').eq('kind','stool').gte('ts', since.toISOString()),
      sb.from('entries').select('*').eq('kind','stool').gte('ts', weekAgo),
      sb.from('entries').select('id', { count:'exact', head:true }).gte('ts', weekAgo),
      sb.from('entries').select('id', { count:'exact', head:true }),
      sb.from('entries').select('id', { count:'exact', head:true }).eq('kind','food'),
    ]);
    if(streakRes.error) throw streakRes.error;
    if(weekRes.error) throw weekRes.error;
    if(weekAllRes.error) throw weekAllRes.error;
    if(totalRes.error) throw totalRes.error;
    if(foodRes.error) throw foodRes.error;
    streakTimestamps = (streakRes.data || []).map(r=>r.ts);
    weeklyStoolEntries = (weekRes.data || []).map(rowToEntry);
    weeklyAllCount = weekAllRes.count || 0;
    totalEntriesCount = totalRes.count || 0;
    totalFoodCount = foodRes.count || 0;
  }catch(e){
    console.error('load account stats failed', e);
  }
  render();
}

const grid = document.getElementById('bristolGrid');
BRISTOL.forEach(b=>{
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'btype';
  el.dataset.n = b.n;
  el.setAttribute('aria-pressed', 'false');
  el.innerHTML = `${bristolSVG(b.n,true)}<span class="num">Type ${b.n}</span><span class="lbl">${b.label}</span>`;
  el.addEventListener('click', ()=>selectType(b.n));
  grid.appendChild(el);
});
grid.setAttribute('role', 'group');
grid.setAttribute('aria-label', 'Bristol Stool Scale');

function selectType(n){
  selectedType = n;
  [...grid.children].forEach(c=>{
    const isSel = +c.dataset.n===n;
    c.classList.toggle('selected', isSel);
    c.setAttribute('aria-pressed', String(isSel));
  });
  updateSaveBtn();
}

document.querySelectorAll('.toggle').forEach(btn=>{
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', ()=>{
    const tag = btn.dataset.tag;
    if(!tag) return; // dynamically-created restroom-flag toggles handle their own pressed state
    if(selectedTags.has(tag)){ selectedTags.delete(tag); btn.classList.remove('on'); }
    else { selectedTags.add(tag); btn.classList.add('on'); }
    btn.setAttribute('aria-pressed', String(selectedTags.has(tag)));
  });
});

const painDots = document.getElementById('painDots');
const painLabels = ['None','Mild','Mod','Severe'];
painLabels.forEach((l,i)=>{
  const d = document.createElement('button');
  d.type = 'button';
  d.className = 'pdot';
  d.textContent = l;
  d.setAttribute('aria-pressed', 'false');
  d.addEventListener('click', ()=>{
    selectedPain = (selectedPain===i) ? null : i;
    [...painDots.children].forEach((c,ci)=>{
      const isOn = ci===selectedPain;
      c.classList.toggle('on', isOn);
      c.setAttribute('aria-pressed', String(isOn));
    });
  });
  painDots.appendChild(d);
});
painDots.setAttribute('role', 'group');
painDots.setAttribute('aria-label', 'Pain Level');

function updateSaveBtn(){
  const btn = document.getElementById('saveBtn');
  if(selectedType){
    btn.disabled = false;
    btn.textContent = `Log Type ${selectedType} entry`;
  } else {
    btn.disabled = true;
    btn.textContent = 'Select a type to log';
  }
}

async function loadEntries(){
  await ensureAuth();
  renderEmailBanner();
  entries = [];
  entriesHasMore = true;
  try{
    await Promise.all([loadMoreEntries(), loadAccountStats(), loadTrendsData()]);
  }catch(e){ console.error('load entries failed', e); entries = []; render(); }
  syncOfflineQueue();
}

// Cursor-based (not offset-based) so a new entry saved while the user is
// paginating never shifts/duplicates already-loaded pages - each page's
// cursor is the ts of the oldest entry loaded so far, which stays valid
// regardless of what gets inserted above it.
async function loadMoreEntries(){
  if(entriesLoadingMore || !entriesHasMore) return;
  entriesLoadingMore = true;
  const btn = document.getElementById('loadMoreEntriesBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Loading…'; }
  try{
    let query = sb.from('entries').select('*').order('ts', {ascending:false}).limit(ENTRIES_PAGE_SIZE);
    if(entries.length) query = query.lt('ts', entries[entries.length-1].ts);
    if(entriesDateFilter){
      query = query
        .gte('ts', new Date(entriesDateFilter.from + 'T00:00:00').toISOString())
        .lte('ts', new Date(entriesDateFilter.to + 'T23:59:59.999').toISOString());
    }
    const { data, error } = await query;
    if(error) throw error;
    const rows = (data||[]).map(rowToEntry);
    entries = entries.concat(rows);
    entriesHasMore = rows.length === ENTRIES_PAGE_SIZE;
  }catch(e){
    console.error('load more entries failed', e);
    alert('Could not load more entries — check your connection.');
  } finally {
    entriesLoadingMore = false;
  }
  render();
}

async function applyEntriesDateFilter(from, to){
  entriesDateFilter = { from, to };
  entries = [];
  entriesHasMore = true;
  await loadMoreEntries();
}

async function clearEntriesDateFilter(){
  if(!entriesDateFilter) return;
  entriesDateFilter = null;
  entries = [];
  entriesHasMore = true;
  await loadMoreEntries();
}

function resetEntriesDateFilterUI(){
  entriesDateFilter = null;
  document.getElementById('entriesFromInput').value = '';
  document.getElementById('entriesToInput').value = '';
  document.getElementById('entriesFilterClearBtn').hidden = true;
}

document.getElementById('entriesFilterBtn').addEventListener('click', async ()=>{
  const from = document.getElementById('entriesFromInput').value;
  const to = document.getElementById('entriesToInput').value;
  if(!from || !to){ alert('Choose both a from and to date.'); return; }
  if(from > to){ alert('The "from" date must be before the "to" date.'); return; }
  document.getElementById('entriesFilterClearBtn').hidden = false;
  await applyEntriesDateFilter(from, to);
});

document.getElementById('entriesFilterClearBtn').addEventListener('click', async ()=>{
  document.getElementById('entriesFromInput').value = '';
  document.getElementById('entriesToInput').value = '';
  document.getElementById('entriesFilterClearBtn').hidden = true;
  await clearEntriesDateFilter();
});

async function renderEmailBanner(){
  const slot = document.getElementById('emailBannerSlot');
  if(!slot) return;
  const { data: { user } } = await sb.auth.getUser();
  if(user && user.email){
    slot.innerHTML = `<div class="email-banner done"><div class="eb-title">✓ Data secured</div>Signed in as ${escapeHtml(user.email)} — your log will follow you across devices.</div>`;
    return;
  }
  slot.innerHTML = `
    <div class="email-banner">
      <div class="eb-title">⚠️ Your data lives only on this device</div>
      Add your email so you never lose your history — no password needed, just a confirmation link.
      <div class="eb-row">
        <input type="email" id="secureEmailInput" placeholder="you@example.com" aria-label="Email address">
        <button id="secureEmailBtn">Save</button>
      </div>
    </div>`;
  document.getElementById('secureEmailBtn').addEventListener('click', async ()=>{
    const email = document.getElementById('secureEmailInput').value.trim();
    if(!email) return;
    const btn = document.getElementById('secureEmailBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try{
      const { error } = await sb.auth.updateUser({ email });
      if(error) throw error;
      slot.innerHTML = `<div class="email-banner done"><div class="eb-title">Check your inbox</div>We sent a confirmation link to ${escapeHtml(email)}. Click it to finish securing your data.</div>`;
    }catch(e){
      console.error('email link failed', e);
      btn.disabled = false; btn.textContent = 'Save';
      alert('Could not send confirmation — check the address and try again.');
    }
  });
}

function rowToEntry(r){
  return {
    id: r.id, ts: r.ts, kind: r.kind || 'stool', type: r.type, tags: r.tags || [],
    pain: r.pain, restId: r.rest_id, restName: r.rest_name, note: r.note,
    foodName: r.food_name, foodBrand: r.food_brand, foodBarcode: r.food_barcode, foodImage: r.food_image
  };
}

document.getElementById('saveBtn').addEventListener('click', async ()=>{
  if(!selectedType) return;
  const saveBtnEl = document.getElementById('saveBtn');
  saveBtnEl.disabled = true;
  saveBtnEl.textContent = 'Saving…';
  const restLinkSelect = document.getElementById('restLinkSelect');
  const row = {
    ts: new Date().toISOString(),
    kind: 'stool',
    type: selectedType,
    tags: [...selectedTags],
    pain: selectedPain,
    rest_id: restLinkSelect.value ? +restLinkSelect.value : null,
    rest_name: restLinkSelect.value ? restLinkSelect.options[restLinkSelect.selectedIndex].text : null,
    note: document.getElementById('noteInput').value.trim()
  };
  let savedOnline = false;
  try{
    if(!navigator.onLine) throw new Error('offline');
    const { data, error } = await sb.from('entries').insert(row).select().single();
    if(error) throw error;
    if(entriesDateFilter) resetEntriesDateFilterUI(); // so the new entry is visible, not hidden by a stale range
    entries.unshift(rowToEntry(data));
    savedOnline = true;
  }catch(e){
    if(isNetworkError(e)){
      const localId = await queueOfflineEntry(row);
      const localEntry = rowToEntry(row);
      localEntry.localId = localId;
      localEntry.pendingSync = true;
      if(entriesDateFilter) resetEntriesDateFilterUI();
      entries.unshift(localEntry);
      showToast('Saved offline. Will sync when connection is restored.');
    } else {
      console.error('save entry failed', e);
      alert('Could not save — check your connection.');
      saveBtnEl.disabled = false;
      saveBtnEl.textContent = `Log Type ${selectedType} entry`;
      return;
    }
  }
  selectedType = null; selectedTags = new Set(); selectedPain = null;
  [...grid.children].forEach(c=>c.classList.remove('selected'));
  document.querySelectorAll('.toggle').forEach(b=>b.classList.remove('on'));
  [...painDots.children].forEach(c=>c.classList.remove('on'));
  document.getElementById('noteInput').value = '';
  restLinkSelect.value = '';
  updateSaveBtn();
  render();
  if(savedOnline){ loadAccountStats(); loadTrendsData(); }
});

function csvField(v){
  const s = (v===null||v===undefined) ? '' : String(v);
  return `"${s.replace(/"/g,'""')}"`;
}

// Exports fetch everything fresh from the server (all history, or the
// active date range) rather than just whatever page is currently loaded in
// memory - an export missing entries you haven't scrolled to would be a
// silent, easy-to-miss data loss for a health record.
async function fetchAllEntriesForExport(){
  const EXPORT_BATCH = 1000;
  let all = [];
  let cursor = null;
  while(true){
    let query = sb.from('entries').select('*').order('ts', {ascending:false}).limit(EXPORT_BATCH);
    if(cursor) query = query.lt('ts', cursor);
    if(entriesDateFilter){
      query = query
        .gte('ts', new Date(entriesDateFilter.from + 'T00:00:00').toISOString())
        .lte('ts', new Date(entriesDateFilter.to + 'T23:59:59.999').toISOString());
    }
    const { data, error } = await query;
    if(error) throw error;
    const rows = (data||[]).map(rowToEntry);
    all = all.concat(rows);
    if(rows.length < EXPORT_BATCH) break;
    cursor = rows[rows.length-1].ts;
  }
  return all;
}

document.getElementById('exportBtn').addEventListener('click', async ()=>{
  const exportBtnEl = document.getElementById('exportBtn');
  exportBtnEl.disabled = true;
  exportBtnEl.textContent = 'Exporting…';
  let allEntries;
  try{
    await ensureAuth();
    allEntries = await fetchAllEntriesForExport();
  }catch(e){
    console.error('export fetch failed', e);
    alert('Could not export — check your connection and try again.');
    exportBtnEl.disabled = false;
    exportBtnEl.textContent = 'Export';
    return;
  }
  exportBtnEl.disabled = false;
  exportBtnEl.textContent = 'Export';
  if(!allEntries.length){ alert('No entries to export.'); return; }
  const header = ['Date','Time','Kind','Bristol Type','Tags','Pain','Food','Brand','Notes'].map(csvField).join(',') + '\n';
  const rows = allEntries.map(e=>{
    const d = new Date(e.ts);
    const painTxt = e.pain===null||e.pain===undefined ? '' : painLabels[e.pain];
    if(e.kind === 'food'){
      return [d.toLocaleDateString(), d.toLocaleTimeString(), 'Food', '', '', '', e.foodName||'', e.foodBrand||'', e.note||''].map(csvField).join(',');
    }
    if(e.kind === 'medication' || e.kind === 'water'){
      return [d.toLocaleDateString(), d.toLocaleTimeString(), KIND_META[e.kind].label, '', '', '', '', '', e.note||''].map(csvField).join(',');
    }
    return [d.toLocaleDateString(), d.toLocaleTimeString(), 'Symptom', e.type, e.tags.join('; '), painTxt, '', '', e.note||''].map(csvField).join(',');
  }).join('\n');
  const blob = new Blob([header+rows], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'gut-log-export.csv';
  a.click();
  URL.revokeObjectURL(url);
});

