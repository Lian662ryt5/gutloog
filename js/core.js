/* ---- Legal consent gate ---- */
const CONSENT_KEY = 'gutlog_consent_v1';
const consentGate = document.getElementById('consentGate');
const consentCheckbox = document.getElementById('consentCheckbox');
const consentContinueBtn = document.getElementById('consentContinueBtn');
if(localStorage.getItem(CONSENT_KEY) === 'true'){
  consentGate.classList.add('hidden');
}
consentCheckbox.addEventListener('change', ()=>{
  consentContinueBtn.disabled = !consentCheckbox.checked;
});
consentContinueBtn.addEventListener('click', ()=>{
  if(!consentCheckbox.checked) return;
  localStorage.setItem(CONSENT_KEY, 'true');
  consentGate.classList.add('hidden');
});
const SUPABASE_URL = 'https://iftxfnhwdyqzllzmjoca.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Mf-INKOUbWP12FQnW8bQrA_b_zJoZXh';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

async function ensureAuth(){
  const { data: { session } } = await sb.auth.getSession();
  if(session) return session;
  const { data, error } = await sb.auth.signInAnonymously();
  if(error){ console.error('Anonymous sign-in failed', error); return null; }
  return data.session;
}

