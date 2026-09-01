/* ---- Pricing / Stripe checkout ---- */
const PLANS = [
  { key: 'monthly', name: 'Monthly', price: '£3.99', period: '/month', link: 'https://buy.stripe.com/4gMbJ3d8a2ei0tS8Me97G05' },
  { key: 'annual', name: 'Annual', price: '£24.99', period: '/year', badge: '7-day free trial · Best value', link: 'https://buy.stripe.com/00w4gBece8CGb8wbYq97G04' },
  { key: 'lifetime', name: 'Lifetime', price: '£39.99', period: ' once', link: 'https://buy.stripe.com/5kQbJ35FI3imfoMgeG97G02' }
];
let currentTier = 'free';
let currentUserId = null;
let currentUsername = null;
let currentAvatarUrl = null;
let profileCreatedAt = null;
let currentIsAdmin = false;

function renderPricing(){
  const grid = document.getElementById('pricingGrid');
  const badge = document.getElementById('planBadge');
  if(!grid) return;
  if(currentTier && currentTier !== 'free'){
    badge.textContent = PLANS.find(p=>p.key===currentTier)?.name || currentTier;
    badge.classList.remove('free');
  } else {
    badge.textContent = 'Free';
    badge.classList.add('free');
  }
  grid.innerHTML = PLANS.map(p=>{
    const isCurrent = currentTier === p.key || (currentTier === 'lifetime' && p.key !== 'lifetime');
    const owned = currentTier === p.key;
    return `<div class="plan-card ${p.badge ? 'best' : ''} ${owned ? 'current' : ''}">
      <div>
        <div class="pc-name">${p.name}${p.badge ? `<span class="pc-badge">${p.badge}</span>` : ''}</div>
        <div class="pc-price"><b>${p.price}</b>${p.period}</div>
      </div>
      <button data-plan="${p.key}" ${owned ? 'disabled' : ''}>${owned ? 'Current plan' : 'Choose'}</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('button[data-plan]').forEach(btn=>{
    btn.addEventListener('click', ()=>startCheckout(btn.dataset.plan, btn));
  });
}

async function loadProfileTier(){
  try{
    await ensureAuth();
    const { data: { user } } = await sb.auth.getUser();
    if(user){
      currentUserId = user.id;
      const { data, error } = await sb.from('profiles').select('tier, theme, username, avatar_url, created_at, is_admin').eq('id', user.id).maybeSingle();
      if(!error && data){
        if(data.tier) currentTier = data.tier;
        if(currentTier !== 'free' && data.theme){ applyTheme(data.theme); }
        currentUsername = data.username || null;
        currentAvatarUrl = data.avatar_url || null;
        profileCreatedAt = data.created_at || null;
        currentIsAdmin = !!data.is_admin;
      }
    }
  }catch(e){ console.error('load profile failed', e); }
  renderPricing();
  renderThemes();
  renderAchievements();
  renderProfile();
  const adminTabBtn = document.getElementById('tab-admin');
  if(adminTabBtn){
    adminTabBtn.hidden = !currentIsAdmin;
    if(currentIsAdmin && typeof loadAdminQueue === 'function') loadAdminQueue();
  }
  // currentUserId is only known once this resolves - restrooms.js uses it
  // to hide the report button on the viewer's own spots, so re-render in
  // case that list already painted first (load order isn't guaranteed).
  if(typeof renderRestrooms === 'function') renderRestrooms();
}

async function startCheckout(plan, btn){
  if(btn){ btn.disabled = true; btn.textContent = 'Loading…'; }
  try{
    const planDef = PLANS.find(p=>p.key === plan);
    if(!planDef || !planDef.link) throw new Error('This plan is not available right now.');

    let { data: { session } } = await sb.auth.getSession();
    if(!session){
      await ensureAuth();
      ({ data: { session } } = await sb.auth.getSession());
    }
    if(!session) throw new Error('Please wait a moment for sign-in to finish, then try again.');

    const url = new URL(planDef.link);
    url.searchParams.set('client_reference_id', session.user.id);
    window.location.href = url.toString();
  }catch(e){
    console.error('checkout failed', e);
    alert(e.message || 'Could not open checkout — please check your connection and try again.');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Choose'; }
  }
}

function renderCheckoutReturnBanner(){
  const slot = document.getElementById('checkoutBannerSlot');
  if(!slot) return;
  const params = new URLSearchParams(window.location.search);
  const status = params.get('checkout');
  if(status === 'success'){
    slot.innerHTML = `<div class="checkout-banner success">✓ Payment received — checking your account…</div>`;
    pollTierAfterCheckout(slot);
  } else if(status === 'cancel'){
    slot.innerHTML = `<div class="checkout-banner cancel">Checkout was cancelled — no payment was taken.</div>`;
  }
  if(status){
    params.delete('checkout');
    const newUrl = window.location.pathname + (params.toString() ? '?'+params.toString() : '');
    window.history.replaceState({}, '', newUrl);
  }
}

// After a successful checkout, the webhook may take a few seconds to credit
// the account, so a single tier fetch on page load can race ahead of it.
// Poll briefly and update the banner once the tier actually changes (or
// give up gracefully so the user isn't left staring at "checking...").
async function pollTierAfterCheckout(slot){
  const tierBefore = currentTier;
  for(let attempt = 0; attempt < 6; attempt++){
    await new Promise(r=>setTimeout(r, 2500));
    try{ await loadProfileTier(); }catch(e){ console.error('tier refresh after checkout failed', e); }
    if(currentTier !== tierBefore) break;
  }
  if(currentTier !== tierBefore){
    const planName = PLANS.find(p=>p.key===currentTier)?.name || currentTier;
    slot.innerHTML = `<div class="checkout-banner success">✓ Payment received — your ${planName} plan is now active.</div>`;
  } else {
    slot.innerHTML = `<div class="checkout-banner success">✓ Payment received — this can take a minute to show up here. Refresh if your plan hasn't updated shortly.</div>`;
  }
}

// Recover from the browser back-forward cache: if the user navigated to
// Stripe Checkout and hit Back instead of completing/cancelling there, the
// page is restored from a frozen snapshot rather than re-run, so a plan
// button left mid-"Loading…" (set just before the redirect in
// startCheckout) would otherwise stay disabled forever. Re-fetching the
// tier also picks up a payment that completed while the user was away.
window.addEventListener('pageshow', (e)=>{
  if(e.persisted) loadProfileTier();
});

