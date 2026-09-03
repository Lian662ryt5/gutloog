// Traps Tab/Shift+Tab within a full-screen modal gate (the consent and
// onboarding gates below) so a keyboard user can't tab past the last
// focusable element into the app content still sitting behind the overlay,
// which axe-core's static analysis can't detect on its own (it can't
// simulate a Tab key press) - shared since both gates need the exact same
// behavior.
function trapFocusWithin(container){
  container.addEventListener('keydown', (e)=>{
    if(e.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if(!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length-1];
    if(e.shiftKey && document.activeElement === first){
      e.preventDefault(); last.focus();
    } else if(!e.shiftKey && document.activeElement === last){
      e.preventDefault(); first.focus();
    }
  });
}

/* ---- Legal consent gate ---- */
const CONSENT_KEY = 'gutlog_consent_v1';
const consentGate = document.getElementById('consentGate');
const consentCheckbox = document.getElementById('consentCheckbox');
const consentContinueBtn = document.getElementById('consentContinueBtn');
if(localStorage.getItem(CONSENT_KEY) === 'true'){
  consentGate.classList.add('hidden');
} else {
  trapFocusWithin(consentGate);
  consentCheckbox.focus();
}
consentCheckbox.addEventListener('change', ()=>{
  consentContinueBtn.disabled = !consentCheckbox.checked;
});
consentContinueBtn.addEventListener('click', ()=>{
  if(!consentCheckbox.checked) return;
  localStorage.setItem(CONSENT_KEY, 'true');
  consentGate.classList.add('hidden');
  if(typeof showOnboardingIfNeeded === 'function') showOnboardingIfNeeded();
});
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=> console.error('service worker registration failed', e));
  });
}

const SUPABASE_URL = 'https://iftxfnhwdyqzllzmjoca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Mf-INKOUbWP12FQnW8bQrA_b_zJoZXh';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// init() below fires several loaders (loadEntries, loadRestrooms,
// loadProfileTier, loadReminderSettings) without awaiting each other, so on
// a brand-new visitor with no session yet, they'd otherwise all see
// getSession() resolve empty at once and each call signInAnonymously()
// independently - creating multiple distinct anonymous accounts and
// splitting that first load's data across them. Memoizing the in-flight
// promise makes concurrent callers share a single auth resolution.
let ensureAuthPromise = null;
async function ensureAuth(){
  if(ensureAuthPromise) return ensureAuthPromise;
  ensureAuthPromise = (async ()=>{
    const { data: { session } } = await sb.auth.getSession();
    if(session) return session;
    const { data, error } = await sb.auth.signInAnonymously();
    if(error){ console.error('Anonymous sign-in failed', error); return null; }
    return data.session;
  })();
  try{
    return await ensureAuthPromise;
  } finally {
    ensureAuthPromise = null;
  }
}

