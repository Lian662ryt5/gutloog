/* ---- Home dashboard: today's summary, reminders snapshot, insights ---- */

function todaysEntries(){
  const today = new Date(); today.setHours(0,0,0,0);
  return entries.filter(e=>{
    const d = new Date(e.ts); d.setHours(0,0,0,0);
    return d.getTime() === today.getTime();
  });
}

function renderTodayCard(){
  const greetingEl = document.getElementById('dashGreeting');
  const summaryEl = document.getElementById('todaySummary');
  if(!greetingEl || !summaryEl) return;

  const hour = new Date().getHours();
  greetingEl.textContent = hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');

  const todays = todaysEntries();
  const stoolToday = todays.filter(e=>e.kind==='stool');
  const flaggedToday = stoolToday.filter(e=> e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2));

  let line;
  if(!todays.length){
    line = "Nothing logged yet today.";
  } else {
    const parts = [];
    if(stoolToday.length) parts.push(`${stoolToday.length} symptom ${stoolToday.length===1?'entry':'entries'}`);
    const foodToday = todays.filter(e=>e.kind==='food').length;
    if(foodToday) parts.push(`${foodToday} food ${foodToday===1?'log':'logs'}`);
    const otherToday = todays.length - stoolToday.length - foodToday;
    if(otherToday) parts.push(`${otherToday} other ${otherToday===1?'log':'logs'}`);
    line = parts.join(' · ');
    if(flaggedToday.length) line += ` <span class="flag">· ⚠️ ${flaggedToday.length} flagged</span>`;
  }

  summaryEl.innerHTML = `
    <div class="dash-today-line">${line}</div>
    <div class="home-stats">
      <div class="stat"><div class="n">${currentStreak(streakTimestamps)}</div><div class="l">Day streak</div></div>
      <div class="stat"><div class="n">${totalEntriesCount}</div><div class="l">Total logs</div></div>
      <div class="stat"><div class="n">${totalRestroomsCount}</div><div class="l">Saved spots</div></div>
    </div>
  `;
}

function renderRemindersSnapshot(){
  const el = document.getElementById('remindersSnapshot');
  if(!el) return;

  if(!reminderSettings){
    el.innerHTML = `<div class="dash-reminders-empty">Loading…</div>`;
    return;
  }

  const enabledTypes = REMINDER_TYPES.filter(t => reminderSettings[`${t.key}_enabled`]);
  if(!enabledTypes.length){
    el.innerHTML = `
      <div class="dash-reminders-empty">No reminders set up yet — get nudged to log meals, symptoms, medication, or water.</div>
      <button class="loc-btn" type="button" id="dashSetupRemindersBtn">Set up reminders</button>`;
  } else {
    el.innerHTML = `
      <div class="dash-reminders-tags">${enabledTypes.map(t=>`<span class="tag">${t.icon} ${escapeHtml(t.label)}</span>`).join('')}</div>
      <button class="loc-btn" type="button" id="dashSetupRemindersBtn">Manage reminders</button>`;
  }
  document.getElementById('dashSetupRemindersBtn').addEventListener('click', ()=> switchTab('profile'));
}

// Reuses the same 180-day window the Trends tab's own food-correlation card
// fetches (trends.js) rather than the paginated `entries` array, which may
// hold far less history than is needed for a meaningful correlation.
function topFoodFlareCorrelation(){
  const flares = trendsStoolEntries.filter(e=> e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2));
  const foods = trendsFoodEntries;
  if(!flares.length || !foods.length) return null;

  const WINDOW_MS = 48*3600*1000;
  const counts = {};
  flares.forEach(flare=>{
    const flareTime = new Date(flare.ts).getTime();
    const seenThisFlare = new Set();
    foods.forEach(f=>{
      const ft = new Date(f.ts).getTime();
      if(ft <= flareTime && ft >= flareTime - WINDOW_MS){
        const key = f.foodName.trim().toLowerCase();
        if(seenThisFlare.has(key)) return;
        seenThisFlare.add(key);
        if(!counts[key]) counts[key] = { name:f.foodName, count:0 };
        counts[key].count++;
      }
    });
  });
  const sorted = Object.values(counts).sort((a,b)=>b.count-a.count);
  return (sorted[0] && sorted[0].count >= 2) ? sorted[0] : null;
}

function renderInsights(){
  const el = document.getElementById('insightsList');
  if(!el) return;

  if(streakTimestamps.length < 3){
    el.innerHTML = `<div class="empty">Log a few more entries to start seeing insights here.</div>`;
    return;
  }

  const lines = [];

  const streak = currentStreak(streakTimestamps);
  if(streak >= 2) lines.push(`🔥 You're on a ${streak}-day logging streak.`);

  if(weeklyStoolEntries.length){
    const thisWeekFlagged = weeklyStoolEntries.filter(e=> e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2));
    lines.push(thisWeekFlagged.length
      ? `📊 ${thisWeekFlagged.length} of ${weeklyStoolEntries.length} entries this week were flagged (blood, urgency, or pain 2+).`
      : `📊 No flagged entries this week, out of ${weeklyStoolEntries.length} logged.`);
  }

  const topFood = topFoodFlareCorrelation();
  if(topFood) lines.push(`🍽️ "${escapeHtml(topFood.name)}" has appeared before ${topFood.count} flagged entries — worth watching. See Trends for more.`);

  el.innerHTML = lines.length
    ? lines.map(l=>`<div class="insight-line">${l}</div>`).join('')
    : `<div class="empty">Log a few more entries to start seeing insights here.</div>`;
}

function renderDashboard(){
  renderTodayCard();
  renderRemindersSnapshot();
  renderInsights();
}
