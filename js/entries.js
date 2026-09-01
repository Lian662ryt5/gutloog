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
  try{
    const { data, error } = await sb.from('entries').select('*').order('ts', {ascending:false});
    if(error) throw error;
    entries = (data||[]).map(rowToEntry);
  }catch(e){ console.error('load entries failed', e); entries = []; }
  render();
  syncOfflineQueue();
}

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
        <input type="email" id="secureEmailInput" placeholder="you@example.com">
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
  try{
    if(!navigator.onLine) throw new Error('offline');
    const { data, error } = await sb.from('entries').insert(row).select().single();
    if(error) throw error;
    entries.unshift(rowToEntry(data));
  }catch(e){
    if(isNetworkError(e)){
      const localId = await queueOfflineEntry(row);
      const localEntry = rowToEntry(row);
      localEntry.localId = localId;
      localEntry.pendingSync = true;
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
});

function csvField(v){
  const s = (v===null||v===undefined) ? '' : String(v);
  return `"${s.replace(/"/g,'""')}"`;
}

document.getElementById('exportBtn').addEventListener('click', ()=>{
  if(!entries.length){ alert('No entries yet to export.'); return; }
  const header = ['Date','Time','Kind','Bristol Type','Tags','Pain','Food','Brand','Notes'].map(csvField).join(',') + '\n';
  const rows = entries.map(e=>{
    const d = new Date(e.ts);
    const painTxt = e.pain===null||e.pain===undefined ? '' : painLabels[e.pain];
    if(e.kind === 'food'){
      return [d.toLocaleDateString(), d.toLocaleTimeString(), 'Food', '', '', '', e.foodName||'', e.foodBrand||'', e.note||''].map(csvField).join(',');
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

