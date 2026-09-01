/* ---- Food logging: barcode scan + manual ---- */
let scanStream = null;
let pendingFood = null;
const scanModal = document.getElementById('scanModal');
const scanVideo = document.getElementById('scanVideo');
const scanStatus = document.getElementById('scanStatus');
const foodPreview = document.getElementById('foodPreview');

document.getElementById('scanBarcodeBtn').addEventListener('click', startScan);
document.getElementById('scanClose').addEventListener('click', stopScan);

async function startScan(){
  if(!('BarcodeDetector' in window)){
    alert("This browser can't scan barcodes directly (works best in Chrome on Android). Add the food manually below instead.");
    return;
  }
  scanModal.classList.add('open');
  scanStatus.textContent = 'Point your camera at the barcode…';
  try{
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    scanVideo.srcObject = scanStream;
    const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e'] });
    const loop = async () => {
      if(!scanStream) return;
      try{
        const codes = await detector.detect(scanVideo);
        if(codes.length){
          const code = codes[0].rawValue;
          stopScan();
          lookupFood(code);
          return;
        }
      }catch(e){ console.error('barcode detect error', e); }
      requestAnimationFrame(loop);
    };
    loop();
  }catch(e){
    console.error('camera access failed', e);
    stopScan();
    alert("Couldn't access the camera — check your browser's camera permissions for this site.");
  }
}

function stopScan(){
  scanModal.classList.remove('open');
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream = null; }
}

async function lookupFood(barcode){
  foodPreview.classList.add('show');
  foodPreview.innerHTML = '<div class="fp-body">Looking up product…</div>';
  try{
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    const data = await res.json();
    if(data.status === 1){
      pendingFood = {
        barcode,
        name: data.product.product_name || 'Unnamed product',
        brand: (data.product.brands || '').split(',')[0].trim(),
        image: data.product.image_front_small_url || data.product.image_small_url || ''
      };
    } else {
      pendingFood = { barcode, name: '', brand: '', image: '' };
    }
  }catch(e){
    console.error('food lookup failed', e);
    pendingFood = { barcode, name: '', brand: '', image: '' };
  }
  renderFoodPreview();
}

function renderFoodPreview(){
  if(!pendingFood){ foodPreview.classList.remove('show'); return; }
  const notFound = !pendingFood.name;
  foodPreview.innerHTML = `
    ${pendingFood.image ? `<img src="${pendingFood.image}" alt="" decoding="async">` : `<div class="food-icon">🍽️</div>`}
    <div class="fp-body">
      ${notFound
        ? `<input type="text" id="fpNameFix" placeholder="Product not found — type its name" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:16px;">`
        : `<div class="fp-name">${escapeHtml(pendingFood.name)}</div><div class="fp-brand">${escapeHtml(pendingFood.brand||'')} · ${pendingFood.barcode}</div>`
      }
    </div>
    <div class="fp-actions">
      <button class="fp-confirm" id="fpConfirm">Log it</button>
      <button class="fp-cancel" id="fpCancel" aria-label="Cancel food scan">✕</button>
    </div>`;
  const confirmBtn = document.getElementById('fpConfirm');
  confirmBtn.addEventListener('click', async ()=>{
    if(notFound){
      const fixed = document.getElementById('fpNameFix').value.trim();
      if(!fixed){ return; }
      pendingFood.name = fixed;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Logging…';
    const ok = await saveFoodEntry(pendingFood);
    if(ok){
      pendingFood = null;
      renderFoodPreview();
    } else {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Log it';
    }
  });
  document.getElementById('fpCancel').addEventListener('click', ()=>{
    pendingFood = null;
    renderFoodPreview();
  });
}

document.getElementById('foodManualBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('foodNameInput');
  const btn = document.getElementById('foodManualBtn');
  const name = input.value.trim();
  if(!name) return;
  btn.disabled = true;
  btn.textContent = 'Logging…';
  const ok = await saveFoodEntry({ name, brand:'', image:'', barcode:null });
  if(ok) input.value = '';
  btn.disabled = false;
  btn.textContent = 'Log';
});

let attachedFoodPhotoBlob = null;
let attachedFoodPhotoPreviewUrl = null;

function clearAttachedFoodPhoto(){
  if(attachedFoodPhotoPreviewUrl){ URL.revokeObjectURL(attachedFoodPhotoPreviewUrl); attachedFoodPhotoPreviewUrl = null; }
  attachedFoodPhotoBlob = null;
  const preview = document.getElementById('foodPhotoPreview');
  preview.style.display = 'none';
  preview.src = '';
  document.getElementById('foodPhotoInput').value = '';
}

document.getElementById('foodPhotoBtn').addEventListener('click', ()=> document.getElementById('foodPhotoInput').click());
document.getElementById('foodPhotoInput').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = ev=>{
    img.onload = ()=>{
      const maxW = 640;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob=>{
        if(!blob) return;
        attachedFoodPhotoBlob = blob;
        if(attachedFoodPhotoPreviewUrl) URL.revokeObjectURL(attachedFoodPhotoPreviewUrl);
        attachedFoodPhotoPreviewUrl = URL.createObjectURL(blob);
        const preview = document.getElementById('foodPhotoPreview');
        preview.src = attachedFoodPhotoPreviewUrl;
        preview.style.display = 'block';
      }, 'image/jpeg', 0.7);
    };
    img.onerror = () => console.error('food photo load failed');
    img.src = ev.target.result;
  };
  reader.onerror = () => console.error('food photo read failed');
  reader.readAsDataURL(file);
});

async function uploadFoodPhoto(blob){
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error: uploadError } = await sb.storage.from('food-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if(uploadError) throw uploadError;
  const { data } = sb.storage.from('food-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function saveFoodEntry(f){
  let image = f.image || '';
  if(attachedFoodPhotoBlob){
    try{
      image = await uploadFoodPhoto(attachedFoodPhotoBlob);
    }catch(e){
      console.error('food photo upload failed', e);
      alert('Could not upload your photo — saving the entry without it.');
    }
  }
  const row = {
    ts: new Date().toISOString(),
    kind: 'food',
    food_name: f.name,
    food_brand: f.brand || '',
    food_barcode: f.barcode || null,
    food_image: image,
    note: ''
  };
  try{
    if(!navigator.onLine) throw new Error('offline');
    const { data, error } = await sb.from('entries').insert(row).select().single();
    if(error) throw error;
    entries.unshift(rowToEntry(data));
    clearAttachedFoodPhoto();
  }catch(e){
    if(isNetworkError(e)){
      const localId = await queueOfflineEntry(row);
      const localEntry = rowToEntry(row);
      localEntry.localId = localId;
      localEntry.pendingSync = true;
      entries.unshift(localEntry);
      showToast('Saved offline. Will sync when connection is restored.');
      clearAttachedFoodPhoto();
    } else {
      console.error('save food entry failed', e);
      alert('Could not save — check your connection.');
      return false;
    }
  }
  render();
  return true;
}

function dayLabel(d){
  const today = new Date(); today.setHours(0,0,0,0);
  const yest = new Date(today); yest.setDate(yest.getDate()-1);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  if(dd.getTime()===today.getTime()) return 'Today';
  if(dd.getTime()===yest.getTime()) return 'Yesterday';
  return dd.toLocaleDateString(undefined,{weekday:'short', month:'short', day:'numeric'});
}

const TAG_LABELS = {blood:'Blood', mucus:'Mucus', urgent:'Urgency', incomplete:'Incomplete'};

function render(){
  renderStats();
  renderHomeStats();
  renderQuickRepeat();
  renderAchievements();
  renderProfile();
  if(typeof renderTrends === 'function') renderTrends();
  const list = document.getElementById('logList');
  if(!entries.length){
    list.innerHTML = '<div class="empty">No entries yet — log your first one above.</div>';
    return;
  }
  let html = '';
  let lastDay = null;
  entries.forEach(e=>{
    const dl = dayLabel(e.ts);
    if(dl !== lastDay){ html += `<div class="day-header">${dl}</div>`; lastDay = dl; }
    const time = new Date(e.ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    const pendingTag = e.pendingSync ? `<span class="tag pending">⏳ Pending sync</span>` : '';
    const delBtn = e.pendingSync ? '' : `<button class="del-btn" data-id="${e.id}" aria-label="Delete entry">×</button>`;
    if(e.kind === 'food'){
      html += `<div class="log-entry">
        ${e.foodImage ? `<div class="food-icon"><img src="${e.foodImage}" alt="" loading="lazy" decoding="async"></div>` : `<div class="food-icon">🍽️</div>`}
        <div class="log-body">
          <div class="log-meta"><span>${escapeHtml(e.foodName)} · ${time}</span>${delBtn}</div>
          <div class="log-tags">${e.foodBrand ? `<span class="tag">${escapeHtml(e.foodBrand)}</span>` : ''}<span class="tag">Food</span>${pendingTag}</div>
        </div>
      </div>`;
      return;
    }
    if(e.kind === 'medication' || e.kind === 'water'){
      const meta = KIND_META[e.kind];
      html += `<div class="log-entry">
        <div class="food-icon">${meta.icon}</div>
        <div class="log-body">
          <div class="log-meta"><span>${meta.label} · ${time}</span>${delBtn}</div>
          <div class="log-tags"><span class="tag">${meta.label}</span>${pendingTag}</div>
          ${e.note ? `<div class="log-note">${escapeHtml(e.note)}</div>` : ''}
        </div>
      </div>`;
      return;
    }
    const tags = e.tags.map(t=>`<span class="tag flag">${TAG_LABELS[t]||t}</span>`).join('');
    const painTag = (e.pain!==null && e.pain!==undefined && e.pain>0) ? `<span class="tag">Pain: ${painLabels[e.pain]}</span>` : '';
    const restTag = e.restName ? `<span class="tag rest-linked-tag">📍 ${escapeHtml(e.restName)}</span>` : '';
    html += `<div class="log-entry">
      <div class="log-icon">${bristolSVG(e.type,false)}</div>
      <div class="log-body">
        <div class="log-meta"><span>Type ${e.type} · ${time}</span>${delBtn}</div>
        <div class="log-tags">${tags}${painTag}${restTag}${pendingTag}</div>
        ${e.note ? `<div class="log-note">${escapeHtml(e.note)}</div>` : ''}
      </div>
    </div>`;
  });
  list.innerHTML = html;
  list.querySelectorAll('.del-btn').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id = +b.dataset.id;
      b.disabled = true;
      try{
        const { error } = await sb.from('entries').delete().eq('id', id);
        if(error) throw error;
      }catch(e){
        console.error('delete failed', e);
        alert('Could not delete — check your connection and try again.');
        b.disabled = false;
        return;
      }
      entries = entries.filter(e=>e.id !== id);
      render();
    });
  });
}

function renderStats(){
  const strip = document.getElementById('statsStrip');
  const now = Date.now();
  const weekAll = entries.filter(e=> now - new Date(e.ts).getTime() < 7*86400000);
  const week = weekAll.filter(e=> e.kind === 'stool');
  const flareCount = week.filter(e=> e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2)).length;
  const avgType = week.length ? (week.reduce((s,e)=>s+e.type,0)/week.length).toFixed(1) : '—';
  strip.innerHTML = `
    <div class="stat"><div class="n">${weekAll.length}</div><div class="l">Past 7 days</div></div>
    <div class="stat"><div class="n">${avgType}</div><div class="l">Avg type</div></div>
    <div class="stat"><div class="n">${flareCount}</div><div class="l">Flagged</div></div>
  `;
}

const ESCAPE_HTML_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ESCAPE_HTML_MAP[c]);
}

const KIND_META = {
  food:       { icon:'🍽️', label:'Food' },
  medication: { icon:'💊', label:'Medication' },
  water:      { icon:'💧', label:'Water' }
};

function entrySummary(e){
  if(e.kind === 'stool') return `Type ${e.type}`;
  if(e.kind === 'food') return e.foodName;
  return KIND_META[e.kind] ? KIND_META[e.kind].label : e.kind;
}

function renderHomeStats(){
  const wrap = document.getElementById('homeStats');
  if(!wrap) return;
  const last = entries[0];
  const lastTxt = last ? `${entrySummary(last)} · ${dayLabel(last.ts).toLowerCase()}` : 'No entries yet';
  wrap.innerHTML = `
    <div class="stat"><div class="n">${entries.length}</div><div class="l">Total logs</div></div>
    <div class="stat"><div class="n">${restrooms.length}</div><div class="l">Saved spots</div></div>
    <div class="stat"><div class="n" style="font-size:12px;">${lastTxt}</div><div class="l">Last entry</div></div>
  `;
}

