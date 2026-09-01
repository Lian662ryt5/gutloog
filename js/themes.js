/* ---- Premium Themes ---- */
const THEMES = [
  { key:'default', name:'Default', swatch:['#EDF1EE','#3F6F66','#2B4E47'] },
  { key:'midnight', name:'Midnight', swatch:['#0F1420','#5B8DEF','#182034'] },
  { key:'forest', name:'Forest', swatch:['#0E1A13','#4CAF6D','#16261C'] },
  { key:'ocean', name:'Ocean', swatch:['#08171C','#2FB8C6','#0F2730'] },
  { key:'sunrise', name:'Sunrise', swatch:['#FFF3EA','#F0805A','#D65A3A'] },
  { key:'purple-glow', name:'Purple Glow', swatch:['#150B24','#B26CF0','#211433'] }
];
let activeTheme = 'default';

function applyTheme(key){
  const html = document.documentElement;
  THEMES.forEach(t=>{ if(t.key !== 'default') html.classList.remove('theme-'+t.key); });
  if(key && key !== 'default'){ html.classList.add('theme-'+key); }
  activeTheme = key || 'default';
  renderThemes();
}

async function chooseTheme(key){
  if(currentTier === 'free'){
    applyTheme(key); // preview only — not persisted
    return;
  }
  applyTheme(key);
  try{
    await ensureAuth();
    const { data: { user } } = await sb.auth.getUser();
    if(!user) return;
    const { error } = await sb.from('profiles').update({ theme: key }).eq('id', user.id);
    if(error) throw error;
  }catch(e){
    console.error('save theme failed', e);
    alert('Theme applied, but could not save it — check your connection.');
  }
}

function renderThemes(){
  const grid = document.getElementById('themeGrid');
  const banner = document.getElementById('themeUpgradeBanner');
  if(!grid || !banner) return;
  const isFree = currentTier === 'free';
  banner.innerHTML = isFree
    ? `<div class="theme-upgrade-banner"><span>You're previewing themes — upgrade to Premium to save one.</span><button id="themeUpgradeBtn" type="button">Go Premium</button></div>`
    : '';
  if(isFree){
    const upBtn = document.getElementById('themeUpgradeBtn');
    if(upBtn) upBtn.addEventListener('click', ()=> switchTab('home'));
  }
  grid.innerHTML = THEMES.map(t=>{
    const isActive = activeTheme === t.key;
    let status = '';
    if(t.key !== 'default'){
      status = isActive ? (isFree ? 'Previewing' : 'Active') : (isFree ? 'Tap to preview' : 'Tap to apply');
    } else if(isActive){
      status = 'Active';
    }
    return `<button type="button" class="theme-card ${isActive?'active':''}" data-theme="${t.key}">
      <div class="theme-swatch">${t.swatch.map(c=>`<span style="background:${c}"></span>`).join('')}</div>
      <div class="tc-body">
        <div class="tc-name">${t.name}${t.key!=='default' ? '<span class="tc-badge">Premium</span>' : ''}</div>
        ${status ? `<div class="tc-status">${status}</div>` : ''}
      </div>
    </button>`;
  }).join('');
  grid.querySelectorAll('.theme-card').forEach(btn=>{
    btn.addEventListener('click', ()=>chooseTheme(btn.dataset.theme));
  });
}

