/* ---- Reminders: push notification settings + snooze/dismiss/quicklog actions ----
   Public VAPID key - safe to embed client-side, same trust model as a Stripe
   publishable key. The matching private key lives only as a Supabase Edge
   Function secret and is used server-side to sign pushes. */
const VAPID_PUBLIC_KEY = 'BIyUGijZoChwoBuAVBMs2kvWmt9b3WK2q0F1-WrNgiMBhclSuJl8_x0Ic5JIVQz7rYVSjBg8oixF2TdNWc0B9_0';

const REMINDER_TYPES = [
  { key:'toilet',     icon:'🚻', label:'Toilet visits', kind:'times',    defaultMessage:"Time to check in — log a visit if you've been." },
  { key:'meals',      icon:'🍽️', label:'Meals',         kind:'times',    defaultMessage:"Don't forget to log what you've eaten." },
  { key:'symptoms',   icon:'📋', label:'Symptoms',      kind:'times',    defaultMessage:'How are you feeling? Log any symptoms.' },
  { key:'medication', icon:'💊', label:'Medication',    kind:'times',    defaultMessage:'Time for your medication.' },
  { key:'water',      icon:'💧', label:'Water intake',  kind:'interval', defaultMessage:'Stay hydrated — log some water.' }
];

let reminderSettings = null;

function defaultReminderSettings(){
  return {
    timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC',
    toilet_enabled:false, toilet_times:[], toilet_message:null,
    meals_enabled:false, meals_times:[], meals_message:null,
    symptoms_enabled:false, symptoms_times:[], symptoms_message:null,
    medication_enabled:false, medication_times:[], medication_message:null,
    water_enabled:false, water_interval_minutes:120, water_start_time:'09:00', water_end_time:'21:00', water_message:null
  };
}

async function loadReminderSettings(){
  try{
    await ensureAuth();
    const { data: { user } } = await sb.auth.getUser();
    if(!user) return;
    const { data, error } = await sb.from('reminder_settings').select('*').eq('user_id', user.id).maybeSingle();
    if(error) throw error;
    reminderSettings = data || defaultReminderSettings();
  }catch(e){
    console.error('load reminder settings failed', e);
    reminderSettings = defaultReminderSettings();
  }
  renderReminders();
  if(typeof renderDashboard === 'function') renderDashboard();
}

// iOS Safari only exposes the Push API to a PWA that's been added to the
// Home Screen (iOS 16.4+) - a plain browser tab never gets PushManager at
// all, which the generic "not supported" message below would otherwise
// blame on the browser rather than explain how to actually fix it.
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalonePWA(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function renderReminders(){
  const statusSlot = document.getElementById('reminderStatusSlot');
  const typesSlot = document.getElementById('reminderTypesSlot');
  const saveBtn = document.getElementById('saveRemindersBtn');
  if(!statusSlot || !typesSlot || !saveBtn || !reminderSettings) return;

  const supported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
  if(!supported){
    statusSlot.innerHTML = (isIOS() && !isStandalonePWA())
      ? `<div class="foot-note" style="margin:0 0 12px;padding:0;text-align:left;">On iPhone/iPad, reminders need Gut Log added to your Home Screen first: tap Share, then "Add to Home Screen," then open it from there.</div>`
      : `<div class="foot-note" style="margin:0 0 12px;padding:0;text-align:left;">Push reminders aren't supported in this browser.</div>`;
    typesSlot.innerHTML = '';
    saveBtn.style.display = 'none';
    return;
  }
  saveBtn.style.display = '';

  const perm = Notification.permission;
  if(perm === 'denied'){
    statusSlot.innerHTML = `<div class="checkout-banner cancel">Notifications are blocked for this site — enable them in your browser's site settings to use reminders.</div>`;
  } else if(perm !== 'granted'){
    statusSlot.innerHTML = `<button class="save-btn" id="enableRemindersBtn" type="button" style="margin-top:0;">Enable notifications</button>`;
  } else {
    statusSlot.innerHTML = `<div class="foot-note" style="margin:0 0 12px;padding:0;text-align:left;">✓ Notifications enabled on this device.</div>`;
  }

  typesSlot.innerHTML = REMINDER_TYPES.map(t=>{
    const enabled = !!reminderSettings[`${t.key}_enabled`];
    const message = reminderSettings[`${t.key}_message`] || '';
    let detailHtml;
    if(t.kind === 'times'){
      const times = (reminderSettings[`${t.key}_times`] && reminderSettings[`${t.key}_times`].length) ? reminderSettings[`${t.key}_times`] : ['09:00'];
      const timeRows = times.map((tm,i)=>`
        <div class="reminder-time-row">
          <input type="time" value="${tm}" data-remtime="${t.key}" aria-label="${escapeHtml(t.label)} reminder time">
          ${times.length>1 ? `<button type="button" class="del-btn" data-remtimedel="${t.key}" data-idx="${i}" aria-label="Remove this ${escapeHtml(t.label)} time">×</button>` : ''}
        </div>`).join('');
      detailHtml = `
        <div class="reminder-times" data-remtimes="${t.key}">${timeRows}</div>
        <button type="button" class="loc-btn" data-remaddtime="${t.key}" style="margin-bottom:10px;">+ Add another time</button>
        <input type="text" class="remMessage" data-remmessage="${t.key}" placeholder="${escapeHtml(t.defaultMessage)}" value="${escapeHtml(message)}" aria-label="${escapeHtml(t.label)} custom message">`;
    } else {
      const interval = reminderSettings.water_interval_minutes || 120;
      const start = reminderSettings.water_start_time || '09:00';
      const end = reminderSettings.water_end_time || '21:00';
      detailHtml = `
        <div class="reminder-interval-row">
          <label>Every
            <select id="waterIntervalSelect" aria-label="Water reminder interval">
              ${[60,90,120,180,240].map(m=>`<option value="${m}" ${m===interval?'selected':''}>${m<120 ? (m/60)+' hr' : (m/60)+' hrs'}</option>`).join('')}
            </select>
          </label>
          <label>from <input type="time" id="waterStartInput" value="${start}" aria-label="Water reminders start time"></label>
          <label>to <input type="time" id="waterEndInput" value="${end}" aria-label="Water reminders end time"></label>
        </div>
        <input type="text" class="remMessage" data-remmessage="water" placeholder="${escapeHtml(t.defaultMessage)}" value="${escapeHtml(message)}" aria-label="Water intake custom message">`;
    }
    return `<div class="reminder-type-row">
      <label class="reminder-type-toggle">
        <input type="checkbox" data-remtoggle="${t.key}" ${enabled ? 'checked' : ''}>
        <span>${t.icon} ${escapeHtml(t.label)}</span>
      </label>
      <div class="reminder-type-detail" data-remdetail="${t.key}" ${enabled ? '' : 'hidden'}>${detailHtml}</div>
    </div>`;
  }).join('');

  bindReminderEvents();
}

function bindReminderEvents(){
  const enableBtn = document.getElementById('enableRemindersBtn');
  if(enableBtn) enableBtn.addEventListener('click', enablePushNotifications);

  document.querySelectorAll('[data-remtoggle]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const key = cb.dataset.remtoggle;
      reminderSettings[`${key}_enabled`] = cb.checked;
      renderReminders();
    });
  });

  document.querySelectorAll('[data-remtime]').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const key = inp.dataset.remtime;
      reminderSettings[`${key}_times`] = [...document.querySelectorAll(`[data-remtime="${key}"]`)].map(r=>r.value).filter(Boolean);
    });
  });

  document.querySelectorAll('[data-remaddtime]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.remaddtime;
      const arr = reminderSettings[`${key}_times`] && reminderSettings[`${key}_times`].length ? reminderSettings[`${key}_times`] : ['09:00'];
      arr.push('09:00');
      reminderSettings[`${key}_times`] = arr;
      renderReminders();
    });
  });

  document.querySelectorAll('[data-remtimedel]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.remtimedel;
      const idx = +btn.dataset.idx;
      const arr = reminderSettings[`${key}_times`] || [];
      arr.splice(idx,1);
      reminderSettings[`${key}_times`] = arr;
      renderReminders();
    });
  });

  document.querySelectorAll('.remMessage').forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const key = inp.dataset.remmessage;
      reminderSettings[`${key}_message`] = inp.value.trim() || null;
    });
  });

  const waterInterval = document.getElementById('waterIntervalSelect');
  if(waterInterval) waterInterval.addEventListener('change', ()=>{ reminderSettings.water_interval_minutes = +waterInterval.value; });
  const waterStart = document.getElementById('waterStartInput');
  if(waterStart) waterStart.addEventListener('change', ()=>{ reminderSettings.water_start_time = waterStart.value; });
  const waterEnd = document.getElementById('waterEndInput');
  if(waterEnd) waterEnd.addEventListener('change', ()=>{ reminderSettings.water_end_time = waterEnd.value; });

  const saveBtn = document.getElementById('saveRemindersBtn');
  if(saveBtn) saveBtn.addEventListener('click', saveReminderSettings);
}

async function saveReminderSettings(){
  // The scheduler (send-reminders) only fires water reminders while
  // start <= now <= end on the same calendar day - an overnight range
  // (e.g. 22:00-02:00) can be entered here with no error, but would then
  // never match on either day and silently never fire, with "Reminders
  // saved" implying it worked. Block that combination up front instead.
  if(reminderSettings.water_enabled){
    const [sh, sm] = String(reminderSettings.water_start_time || '09:00').split(':').map(Number);
    const [eh, em] = String(reminderSettings.water_end_time || '21:00').split(':').map(Number);
    if(eh*60+em <= sh*60+sm){
      alert('Water reminders: the end time must be after the start time (overnight ranges aren\'t supported yet).');
      return;
    }
  }
  const saveBtn = document.getElementById('saveRemindersBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
  try{
    await ensureAuth();
    const { data: { user } } = await sb.auth.getUser();
    if(!user) throw new Error('not signed in');
    reminderSettings.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { error } = await sb.from('reminder_settings').upsert({ user_id: user.id, ...reminderSettings }, { onConflict:'user_id' });
    if(error) throw error;
    if(typeof renderDashboard === 'function') renderDashboard();
    showToast('Reminders saved.');
  }catch(e){
    console.error('save reminders failed', e);
    alert('Could not save reminders — check your connection.');
  }
  saveBtn.disabled = false; saveBtn.textContent = 'Save reminders';
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

async function enablePushNotifications(){
  const btn = document.getElementById('enableRemindersBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Requesting…'; }
  try{
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){ renderReminders(); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await ensureAuth();
    const { data: { user } } = await sb.auth.getUser();
    if(!user) throw new Error('not signed in');
    const keys = sub.toJSON().keys;
    const { error } = await sb.from('push_subscriptions').upsert(
      { user_id: user.id, endpoint: sub.endpoint, p256dh: keys.p256dh, auth_key: keys.auth },
      { onConflict:'endpoint' }
    );
    if(error) throw error;
  }catch(e){
    console.error('enable notifications failed', e);
    alert('Could not enable notifications — check your connection and try again.');
  }
  renderReminders();
}

/* Handles taps on a reminder notification's actions. Those actions can't
   write to Supabase directly from the service worker (auth/session refresh
   lives in the page), so they open/focus the app with a URL param instead,
   and this reads and applies it once the page's real session is ready. */
async function handleReminderUrlParams(){
  const params = new URLSearchParams(window.location.search);
  const quicklog = params.get('quicklog');
  const remaction = params.get('remaction');
  const remtype = params.get('type');
  if(!quicklog && !remaction) return;

  try{
    await ensureAuth();
    const { data: { user } } = await sb.auth.getUser();
    if(!user) return;

    if(quicklog === 'medication' || quicklog === 'water'){
      // These need no extra input from the user - a bare timestamp is a
      // complete, meaningful log entry on its own. Mirrors the same
      // offline-queue fallback the Log tab's own save button uses, so a
      // notification tap made while offline isn't silently lost.
      const meta = KIND_META[quicklog];
      const row = { ts: new Date().toISOString(), kind: quicklog, note: '' };
      try{
        if(!navigator.onLine) throw new Error('offline');
        const { data, error } = await sb.from('entries').insert(row).select().single();
        if(error) throw error;
        entries.unshift(rowToEntry(data));
        showToast(`${meta ? meta.label : quicklog} logged.`);
      }catch(e){
        if(isNetworkError(e)){
          const localId = await queueOfflineEntry(row);
          const localEntry = rowToEntry(row);
          localEntry.localId = localId;
          localEntry.pendingSync = true;
          entries.unshift(localEntry);
          showToast('Saved offline. Will sync when connection is restored.');
        } else {
          console.error('reminder quicklog failed', e);
          showToast('Could not log — check your connection and try from the app.');
        }
      }
      render();
    } else if(quicklog === 'toilet' || quicklog === 'symptoms' || quicklog === 'meals'){
      // These need real input (a Bristol type, or a food name) that can't be
      // filled in blindly - open the Log tab instead of inserting an empty row.
      switchTab('log');
      showToast('Opened Log — fill in your entry.');
    }

    if(remaction && remtype){
      const today = new Date();
      const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      if(remaction === 'snooze'){
        const snoozedUntil = new Date(Date.now() + 30*60000).toISOString();
        await sb.from('reminder_log').upsert(
          { user_id:user.id, reminder_type:remtype, local_date:localDate, snoozed_until:snoozedUntil },
          { onConflict:'user_id,reminder_type,local_date' }
        );
        showToast('Reminder snoozed for 30 minutes.');
      } else if(remaction === 'dismiss'){
        await sb.from('reminder_log').upsert(
          { user_id:user.id, reminder_type:remtype, local_date:localDate, dismissed:true },
          { onConflict:'user_id,reminder_type,local_date' }
        );
        showToast('Reminder dismissed for today.');
      }
    }
  }catch(e){
    console.error('reminder url action failed', e);
  }

  params.delete('quicklog'); params.delete('remaction'); params.delete('type');
  const newUrl = window.location.pathname + (params.toString() ? '?'+params.toString() : '');
  window.history.replaceState({}, '', newUrl);
}
