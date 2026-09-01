/* ---- Profile page ---- */
const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function currentStreak(entriesList){
  const days = new Set();
  entriesList.forEach(e=>{
    if(e.kind === 'food') return;
    const d = new Date(e.ts); d.setHours(0,0,0,0);
    days.add(d.getTime());
  });
  const today = new Date(); today.setHours(0,0,0,0);
  let cursor = today.getTime();
  if(!days.has(cursor)){
    cursor -= 86400000;
    if(!days.has(cursor)) return 0;
  }
  let count = 0;
  while(days.has(cursor)){ count++; cursor -= 86400000; }
  return count;
}

function resizeImageToSquareBlob(file, size){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = ev=>{
      img.onload = ()=>{
        const cropSize = Math.min(img.width, img.height);
        const sx = (img.width - cropSize) / 2;
        const sy = (img.height - cropSize) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, size, size);
        canvas.toBlob(blob=>{ blob ? resolve(blob) : reject(new Error('toBlob failed')); }, 'image/jpeg', 0.85);
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

function renderProfile(){
  const page = document.getElementById('page-profile');
  if(!page) return;

  const avatarEl = document.getElementById('profileAvatar');
  if(avatarEl){
    if(currentAvatarUrl){
      avatarEl.innerHTML = `<img src="${currentAvatarUrl}?t=${Date.now()}" alt="">`;
    } else {
      const letter = (currentUsername || 'G').trim().charAt(0).toUpperCase() || 'G';
      avatarEl.innerHTML = `<span>${escapeHtml(letter)}</span>`;
    }
  }

  const nameEl = document.getElementById('profileUsernameDisplay');
  if(nameEl) nameEl.textContent = currentUsername || 'Set a username';

  const joinEl = document.getElementById('profileJoinDate');
  if(joinEl){
    joinEl.textContent = profileCreatedAt
      ? `Joined ${new Date(profileCreatedAt).toLocaleDateString(undefined,{month:'long', year:'numeric'})}`
      : '';
  }

  const tierBadge = document.getElementById('profileTierBadge');
  if(tierBadge){
    const planName = PLANS.find(p=>p.key===currentTier)?.name;
    tierBadge.textContent = planName || 'Free';
    tierBadge.classList.toggle('free', currentTier === 'free');
  }

  const stats = computeAchievementStats();
  const unlockedCount = ACHIEVEMENTS.filter(a=>a.check(stats)).length;
  const total = ACHIEVEMENTS.length;
  const ringFill = document.getElementById('ringFillCircle');
  const ringText = document.getElementById('ringText');
  const ringHeadline = document.getElementById('progressRingHeadline');
  if(ringFill){
    const frac = total ? unlockedCount/total : 0;
    ringFill.style.strokeDasharray = `${RING_CIRCUMFERENCE}`;
    ringFill.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - frac)}`;
  }
  if(ringText) ringText.textContent = `${unlockedCount}/${total}`;
  if(ringHeadline) ringHeadline.textContent = `${unlockedCount} of ${total} badges earned`;

  const statsGrid = document.getElementById('profileStatsGrid');
  if(statsGrid){
    const foodCount = entries.filter(e=>e.kind==='food').length;
    const items = [
      { n: currentStreak(entries), l: 'Day Streak' },
      { n: stats.entriesCount, l: 'Total Entries' },
      { n: foodCount, l: 'Foods Logged' },
      { n: stats.restroomsOwned, l: 'Restroom Spots' }
    ];
    statsGrid.innerHTML = items.map(i=>`<div class="profile-stat"><div class="ps-n">${i.n}</div><div class="ps-l">${escapeHtml(i.l)}</div></div>`).join('');
  }

  const themeRow = document.getElementById('profileThemeRow');
  if(themeRow){
    const theme = THEMES.find(t=>t.key === activeTheme) || THEMES[0];
    themeRow.innerHTML = `
      <div class="profile-theme-swatch">${theme.swatch.map(c=>`<span style="background:${c}"></span>`).join('')}</div>
      <div class="profile-theme-name">${escapeHtml(theme.name)}</div>
      <button class="loc-btn" type="button" id="changeThemeBtn">Change</button>`;
    const changeBtn = document.getElementById('changeThemeBtn');
    if(changeBtn) changeBtn.addEventListener('click', ()=> switchTab('themes'));
  }
}

function bindProfileEvents(){
  const avatarEditBtn = document.getElementById('avatarEditBtn');
  const avatarInput = document.getElementById('avatarInput');
  const usernameEditBtn = document.getElementById('usernameEditBtn');
  const viewBadgesBtn = document.getElementById('viewBadgesBtn');
  if(!avatarEditBtn || !avatarInput || !usernameEditBtn || !viewBadgesBtn) return;

  avatarEditBtn.addEventListener('click', ()=> avatarInput.click());

  avatarInput.addEventListener('change', async ()=>{
    const file = avatarInput.files[0];
    if(!file) return;
    avatarEditBtn.disabled = true;
    avatarEditBtn.textContent = '…';
    try{
      const blob = await resizeImageToSquareBlob(file, 256);
      await ensureAuth();
      const { data: { user } } = await sb.auth.getUser();
      if(!user) throw new Error('not signed in');
      const path = `${user.id}.jpg`;
      const { error: upErr } = await sb.storage.from('avatars').upload(path, blob, { contentType:'image/jpeg', upsert:true });
      if(upErr) throw upErr;
      const { data: urlData } = sb.storage.from('avatars').getPublicUrl(path);
      currentAvatarUrl = urlData.publicUrl;
      const { error: dbErr } = await sb.from('profiles').update({ avatar_url: currentAvatarUrl }).eq('id', user.id);
      if(dbErr) throw dbErr;
      renderProfile();
    }catch(err){
      console.error('avatar upload failed', err);
      alert('Could not update your photo — check your connection.');
    }
    avatarEditBtn.disabled = false;
    avatarEditBtn.textContent = '📷';
    avatarInput.value = '';
  });

  usernameEditBtn.addEventListener('click', ()=>{
    const slot = document.getElementById('usernameEditSlot');
    slot.innerHTML = `<div class="card"><div class="username-edit-row">
      <input type="text" id="usernameInput" maxlength="40" placeholder="Enter a username" aria-label="Username" value="${escapeHtml(currentUsername||'')}">
      <button class="username-save-btn" type="button" id="usernameSaveBtn">Save</button>
      <button class="username-cancel-btn" type="button" id="usernameCancelBtn" aria-label="Cancel editing username">✕</button>
    </div></div>`;
    document.getElementById('usernameInput').focus();
    document.getElementById('usernameCancelBtn').addEventListener('click', ()=>{ slot.innerHTML=''; });
    document.getElementById('usernameSaveBtn').addEventListener('click', async ()=>{
      const val = document.getElementById('usernameInput').value.trim().slice(0,40);
      const saveBtn = document.getElementById('usernameSaveBtn');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try{
        await ensureAuth();
        const { data: { user } } = await sb.auth.getUser();
        if(!user) throw new Error('not signed in');
        const { error } = await sb.from('profiles').update({ username: val || null }).eq('id', user.id);
        if(error) throw error;
        currentUsername = val || null;
        slot.innerHTML = '';
        renderProfile();
      }catch(err){
        console.error('save username failed', err);
        alert('Could not save — check your connection.');
        saveBtn.disabled = false; saveBtn.textContent = 'Save';
      }
    });
  });

  viewBadgesBtn.addEventListener('click', ()=> switchTab('achievements'));
}

