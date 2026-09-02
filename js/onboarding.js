/* ---- First-time onboarding: a short, dismissible, shown-once intro ----
   Runs after the legal consent gate, never before or alongside it (two
   overlays stacked at once would be confusing). Triggered from two places,
   both safe regardless of script load order since neither fires at
   immediate top-level execution time: the consent gate's "Continue" click
   handler in core.js (first-time users, this session), and init() in
   main.js (returning users who consented in an earlier session, so the
   consent gate is already hidden by the time this file's functions exist). */
const ONBOARDING_KEY = 'gutlog_onboarded_v1';

const ONBOARDING_STEPS = [
  { icon:'👋', title:'Welcome to Gut Log', body:"Your private, judgment-free space to track symptoms and spot patterns over time — built for people living with IBD. Here's a quick look at what you can do." },
  { icon:'📋', title:'Track your symptoms', body:"Log Bristol type, pain, and triggers in seconds — build a clear picture for you and your doctor." },
  { icon:'🚻', title:'Find & share restrooms', body:'Locate nearby restrooms fast, and save trusted, clean spots for the community.' },
  { icon:'🔔', title:"Never miss a log", body:"Set reminders for meals, medication, symptoms, and water — smart enough to skip days you've already logged." },
  { icon:'⭐', title:'Go further with Premium', body:"Unlock premium themes and support the app's development, whenever you're ready." }
];
let onboardingStep = 0;

function showOnboardingIfNeeded(){
  if(localStorage.getItem(ONBOARDING_KEY) === 'true') return;
  const gate = document.getElementById('onboardingGate');
  const consentGate = document.getElementById('consentGate');
  if(!gate) return;
  if(consentGate && !consentGate.classList.contains('hidden')) return; // wait for consent first
  onboardingStep = 0;
  renderOnboardingStep();
  gate.classList.remove('hidden');
}

function renderOnboardingStep(){
  const s = ONBOARDING_STEPS[onboardingStep];
  document.getElementById('onboardingIcon').textContent = s.icon;
  document.getElementById('onboardingTitle').textContent = s.title;
  document.getElementById('onboardingBody').textContent = s.body;
  document.getElementById('onboardingDots').innerHTML = ONBOARDING_STEPS
    .map((_,i)=>`<span class="onboarding-dot ${i===onboardingStep?'active':''}"></span>`).join('');
  document.getElementById('onboardingBackBtn').style.visibility = onboardingStep === 0 ? 'hidden' : 'visible';
  document.getElementById('onboardingNextBtn').textContent = onboardingStep === ONBOARDING_STEPS.length-1
    ? 'Get started'
    : (onboardingStep === 0 ? "Let's go" : 'Next');

  // Retrigger the step-in animation (no-op visually for users who have
  // prefers-reduced-motion, since the animation itself is disabled for
  // them in CSS - this just re-adds the class each step).
  const content = document.getElementById('onboardingContent');
  content.classList.remove('step-in');
  void content.offsetWidth; // force reflow so the animation restarts
  content.classList.add('step-in');
}

function finishOnboarding(){
  localStorage.setItem(ONBOARDING_KEY, 'true');
  document.getElementById('onboardingGate').classList.add('hidden');
}

document.getElementById('onboardingSkipBtn').addEventListener('click', finishOnboarding);
document.getElementById('onboardingNextBtn').addEventListener('click', ()=>{
  if(onboardingStep === ONBOARDING_STEPS.length-1){ finishOnboarding(); return; }
  onboardingStep++;
  renderOnboardingStep();
});
document.getElementById('onboardingBackBtn').addEventListener('click', ()=>{
  if(onboardingStep===0) return;
  onboardingStep--;
  renderOnboardingStep();
});
