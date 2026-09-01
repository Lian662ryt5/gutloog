/* ---- Restroom finder ---- */
let restrooms = [];
let selectedClean = null;
let selectedRestFlags = new Set();
const REST_FLAG_LABELS = {private:'Private/lockable', paper:'Always stocked', code:'Code needed', customers:'Customers only', accessible:'Accessible'};

const cleanScale = document.getElementById('cleanScale');
cleanScale.setAttribute('role', 'group');
cleanScale.setAttribute('aria-labelledby', 'cleanScaleLabel');
for(let i=1;i<=5;i++){
  const d = document.createElement('button');
  d.type = 'button';
  d.className = 'cdot';
  d.textContent = '★';
  d.dataset.v = i;
  d.setAttribute('aria-label', `${i} star${i>1?'s':''}`);
  d.setAttribute('aria-pressed', 'false');
  d.addEventListener('click', ()=>{
    selectedClean = i;
    [...cleanScale.children].forEach(c=>{
      const v = +c.dataset.v;
      c.classList.toggle('on', v <= i);
      c.setAttribute('aria-pressed', String(v === i));
    });
  });
  cleanScale.appendChild(d);
}

const restFlagsWrap = document.getElementById('restFlags');
Object.entries(REST_FLAG_LABELS).forEach(([key,label])=>{
  const b = document.createElement('button');
  b.className = 'toggle';
  b.textContent = label;
  b.type = 'button';
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', ()=>{
    if(selectedRestFlags.has(key)){ selectedRestFlags.delete(key); b.classList.remove('on'); }
    else { selectedRestFlags.add(key); b.classList.add('on'); }
    b.setAttribute('aria-pressed', String(selectedRestFlags.has(key)));
  });
  restFlagsWrap.appendChild(b);
});

function haversineKm(lat1, lng1, lat2, lng2){
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

document.getElementById('findNearbyBtn').addEventListener('click', ()=>{
  const btn = document.getElementById('findNearbyBtn');
  const label = document.getElementById('findNearbyLabel');
  const status = document.getElementById('nearbyStatus');
  const nearbyList = document.getElementById('nearbySavedSpots');
  if(!navigator.geolocation){
    status.className = 'err';
    status.textContent = "Your browser doesn't support location — opening a general search instead.";
    window.open('https://www.google.com/maps/search/public+restroom+near+me', '_blank');
    return;
  }
  btn.disabled = true;
  status.className = '';
  status.textContent = '';
  label.innerHTML = '<span class="spinner"></span>Finding your location…';
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const {latitude, longitude} = pos.coords;
      btn.disabled = false;
      label.textContent = 'Open nearby public restrooms in Maps';
      window.open(`https://www.google.com/maps/search/public+restroom/@${latitude},${longitude},16z`, '_blank');
      const withCoords = restrooms.filter(r=>r.coords);
      if(!withCoords.length){
        nearbyList.innerHTML = '';
        return;
      }
      const sorted = withCoords
        .map(r=>({...r, dist: haversineKm(latitude, longitude, r.coords.lat, r.coords.lng)}))
        .sort((a,b)=>a.dist-b.dist)
        .slice(0,5);
      nearbyList.innerHTML = '<div class="foot-note" style="margin:12px 0 0;padding:0;text-align:left;">Closest saved spots:</div>' +
        sorted.map(r=>{
          const distLabel = r.dist < 1 ? `${Math.round(r.dist*1000)} m` : `${r.dist.toFixed(1)} km`;
          return `<div class="nearby-card"><span class="nname">${escapeHtml(r.name)}</span><span class="ndist">${distLabel}</span></div>`;
        }).join('');
    },
    err=>{
      btn.disabled = false;
      label.textContent = 'Open nearby public restrooms in Maps';
      status.className = 'err';
      status.textContent = err.code === 1
        ? "Location access was denied, so this opens a general nearby search instead. You can allow location in your browser's site settings to get exact results next time."
        : "Couldn't get your exact location — opening a general nearby search instead.";
      window.open('https://www.google.com/maps/search/public+restroom+near+me', '_blank');
    },
    { timeout: 8000 }
  );
});

/* ---- Location for saved spot, with consent step ---- */
let attachedCoords = null;
document.getElementById('useLocBtn').addEventListener('click', ()=>{
  const panel = document.getElementById('consentPanel');
  panel.innerHTML = `
    <div class="consent-panel">
      Use your device's current location to fill in this spot's address? Your browser will ask you to approve access, and the coordinates will be saved with this restroom entry — visible to everyone using this app.
      <div class="cbtns">
        <button class="allow" id="consentAllow" type="button">Allow</button>
        <button class="cancel" id="consentCancel" type="button">Cancel</button>
      </div>
    </div>`;
  document.getElementById('consentAllow').addEventListener('click', ()=>{
    panel.innerHTML = '<div class="consent-panel">Getting location…</div>';
    if(!navigator.geolocation){
      panel.innerHTML = '<div class="consent-panel">Location isn\'t available in this browser. You can type the address instead.</div>';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos=>{
        attachedCoords = {lat: pos.coords.latitude, lng: pos.coords.longitude};
        panel.innerHTML = '';
        renderLocAttached();
      },
      ()=>{
        panel.innerHTML = '<div class="consent-panel">Couldn\'t get your location. You can type the address instead.</div>';
      }
    );
  });
  document.getElementById('consentCancel').addEventListener('click', ()=>{ panel.innerHTML=''; });
});

function renderLocAttached(){
  const wrap = document.getElementById('locAttached');
  if(!attachedCoords){ wrap.innerHTML=''; return; }
  const url = `https://www.google.com/maps?q=${attachedCoords.lat},${attachedCoords.lng}`;
  wrap.innerHTML = `<div class="loc-attached"><span>📍 Location attached — <a href="${url}" target="_blank">view on map</a></span><button class="del-btn" id="clearLoc" aria-label="Remove attached location">×</button></div>`;
  document.getElementById('clearLoc').addEventListener('click', ()=>{ attachedCoords=null; renderLocAttached(); });
}

/* ---- Photo upload ---- */
let attachedPhoto = null;      // public URL, set after upload on save
let attachedPhotoBlob = null;  // compressed JPEG blob, staged until save
let attachedPhotoPreviewUrl = null;
document.getElementById('photoBtn').addEventListener('click', ()=> document.getElementById('photoInput').click());
document.getElementById('photoInput').addEventListener('change', e=>{
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
        attachedPhotoBlob = blob;
        if(attachedPhotoPreviewUrl) URL.revokeObjectURL(attachedPhotoPreviewUrl);
        attachedPhotoPreviewUrl = URL.createObjectURL(blob);
        const preview = document.getElementById('photoPreview');
        preview.src = attachedPhotoPreviewUrl;
        preview.style.display = 'block';
      }, 'image/jpeg', 0.7);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

async function uploadRestroomPhoto(blob){
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error: uploadError } = await sb.storage.from('restroom-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if(uploadError) throw uploadError;
  const { data } = sb.storage.from('restroom-photos').getPublicUrl(path);
  return data.publicUrl;
}

function rowToRestroom(r){
  return {
    id: r.id, name: r.name, loc: r.loc, userId: r.user_id,
    coords: (r.lat!=null && r.lng!=null) ? {lat:r.lat, lng:r.lng} : null,
    photo: r.photo, clean: r.clean, flags: r.flags || [],
    note: r.note, reportCount: r.report_count || 0
  };
}

async function loadRestrooms(){
  await ensureAuth();
  try{
    const { data, error } = await sb.from('restrooms').select('*').order('clean', {ascending:false});
    if(error) throw error;
    restrooms = (data||[]).map(rowToRestroom);
  }catch(e){ console.error('load restrooms failed', e); restrooms = []; }
  renderRestrooms();
}

document.getElementById('saveRestBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('restName').value.trim();
  if(!name){ alert('Give it a name so you can find it again.'); return; }
  const restBtn = document.getElementById('saveRestBtn');
  restBtn.disabled = true;
  restBtn.textContent = attachedPhotoBlob ? 'Uploading photo…' : 'Saving…';
  try{
    if(attachedPhotoBlob){
      attachedPhoto = await uploadRestroomPhoto(attachedPhotoBlob);
    }
    restBtn.textContent = 'Saving…';
    const row = {
      name,
      loc: document.getElementById('restLoc').value.trim(),
      lat: attachedCoords ? attachedCoords.lat : null,
      lng: attachedCoords ? attachedCoords.lng : null,
      photo: attachedPhoto,
      clean: selectedClean,
      flags: [...selectedRestFlags],
      note: document.getElementById('restNote').value.trim()
    };
    const { data, error } = await sb.from('restrooms').insert(row).select().single();
    if(error) throw error;
    restrooms.unshift(rowToRestroom(data));
  }catch(e){
    console.error('SAVE RESTROOM ERROR:', e);
    alert(
      `Could not save restroom.\n\n${e?.message || e?.details || JSON.stringify(e)}`
    );
    restBtn.disabled = false;
    restBtn.textContent = 'Save restroom';
    return;
  }
  document.getElementById('restName').value = '';
  document.getElementById('restLoc').value = '';
  document.getElementById('restNote').value = '';
  selectedClean = null; selectedRestFlags = new Set();
  attachedCoords = null; attachedPhoto = null;
  if(attachedPhotoPreviewUrl){ URL.revokeObjectURL(attachedPhotoPreviewUrl); attachedPhotoPreviewUrl = null; }
  attachedPhotoBlob = null;
  renderLocAttached();
  document.getElementById('photoPreview').style.display = 'none';
  document.getElementById('photoInput').value = '';
  [...cleanScale.children].forEach(c=>{ c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
  restFlagsWrap.querySelectorAll('.toggle').forEach(b=>b.classList.remove('on'));
  restBtn.disabled = false;
  restBtn.textContent = 'Save restroom';
  renderRestrooms();
});

function populateRestLinkSelect(){
  const sel = document.getElementById('restLinkSelect');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Not linked to a saved spot</option>' +
    restrooms.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  sel.value = current;
}

function renderRestrooms(){
  renderHomeStats();
  populateRestLinkSelect();
  renderAchievements();
  renderProfile();
  const list = document.getElementById('restList');
  if(!restrooms.length){
    list.innerHTML = '<div class="empty">No spots saved yet.</div>';
    return;
  }
  const areaFilter = (document.getElementById('filterArea')?.value || '').toLowerCase();
  const starFilter = +(document.getElementById('filterStars')?.value || 0);
  let filtered = restrooms.filter(r=>{
    const matchesArea = !areaFilter || (r.name+' '+(r.loc||'')).toLowerCase().includes(areaFilter);
    const matchesStars = (r.clean||0) >= starFilter;
    return matchesArea && matchesStars;
  });
  const sorted = filtered.sort((a,b)=> (b.clean||0) - (a.clean||0));
  if(!sorted.length){
    list.innerHTML = '<div class="empty">No spots match that filter.</div>';
    return;
  }
  list.innerHTML = sorted.map(r=>{
    const stars = '★'.repeat(r.clean||0) + '☆'.repeat(5-(r.clean||0));
    const tags = r.flags.map(f=>`<span class="tag">${REST_FLAG_LABELS[f]||f}</span>`).join('');
    const photo = r.photo ? `<img class="rphoto" src="${r.photo}" alt="Photo of ${escapeHtml(r.name)}" loading="lazy" decoding="async">` : '';
    const mapLink = r.coords ? ` · <a href="https://www.google.com/maps?q=${r.coords.lat},${r.coords.lng}" target="_blank">map</a>` : '';
    return `<div class="rest-card">
      ${photo}
      <div class="rhead">
        <div><div class="rname">${escapeHtml(r.name)}</div><div class="rloc">${escapeHtml(r.loc||'')}${mapLink}</div></div>
        <div>
          <div class="rstars" style="color:var(--ochre);">${stars}</div>
          <button class="del-btn" data-rid="${r.id}" aria-label="Delete spot">×</button>
        </div>
      </div>
      ${r.note ? `<div class="rnote">${escapeHtml(r.note)}</div>` : ''}
      <div class="rtags">${tags}</div>
      <div class="rfoot"><button class="report-btn" data-report="${r.id}">Report incorrect info</button></div>
    </div>`;
  }).join('');
  list.querySelectorAll('.del-btn').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('Delete this saved spot? This removes it for everyone and can\'t be undone.')) return;
      const id = +b.dataset.rid;
      b.disabled = true;
      try{
        const { error } = await sb.from('restrooms').delete().eq('id', id);
        if(error) throw error;
      }catch(e){
        console.error('delete failed', e);
        alert('Could not delete — check your connection and try again.');
        b.disabled = false;
        return;
      }
      restrooms = restrooms.filter(r=>r.id !== id);
      renderRestrooms();
    });
  });
  list.querySelectorAll('[data-report]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id = +b.dataset.report;
      const r = restrooms.find(x=>x.id === id);
      if(!r) return;
      const newCount = (r.reportCount||0) + 1;
      try{
        const { error } = await sb.from('restrooms').update({report_count:newCount}).eq('id', id);
        if(error) throw error;
        r.reportCount = newCount;
        b.textContent = 'Reported — thanks';
        b.disabled = true;
      }catch(e){ console.error('report failed', e); }
    });
  });
}

document.getElementById('filterArea').addEventListener('input', renderRestrooms);
document.getElementById('filterStars').addEventListener('change', renderRestrooms);



