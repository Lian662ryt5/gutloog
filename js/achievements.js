/* ---- Achievements / Badges ---- */
const SEEN_BADGES_KEY = 'gutlog_seen_badges';
const VISITED_TRENDS_KEY = 'gutlog_visited_trends';

const ACHIEVEMENTS = [
  { key:'first_entry', name:'First Entry', icon:'🌱', desc:'Log your very first entry.',
    check: s=> s.entriesCount>=1 },
  { key:'streak_7', name:'7-Day Streak', icon:'🔥', desc:'Log a symptom entry 7 days in a row.',
    check: s=> s.maxStreak>=7, progress: s=> `${Math.min(s.maxStreak,7)}/7 days` },
  { key:'streak_30', name:'30-Day Streak', icon:'🏆', desc:'Log a symptom entry 30 days in a row.',
    check: s=> s.maxStreak>=30, progress: s=> `${Math.min(s.maxStreak,30)}/30 days` },
  { key:'entries_100', name:'100 Entries Logged', icon:'💯', desc:'Log 100 entries in total.',
    check: s=> s.entriesCount>=100, progress: s=> `${Math.min(s.entriesCount,100)}/100` },
  { key:'community_helper', name:'Community Helper', icon:'🤝', desc:'Save a restroom spot for others to find.',
    check: s=> s.restroomsOwned>=1 },
  { key:'trend_explorer', name:'Trend Explorer', icon:'📈', desc:'Check out the Trends tab.',
    check: s=> s.visitedTrends },
  { key:'premium_member', name:'Premium Member', icon:'⭐', desc:'Subscribe to a premium plan.',
    check: s=> s.tier==='monthly' || s.tier==='annual' },
  { key:'lifetime_member', name:'Lifetime Member', icon:'👑', desc:'Get lifetime premium access.',
    check: s=> s.tier==='lifetime' }
];

function longestStreak(entriesList){
  const days = new Set();
  entriesList.forEach(e=>{
    if(e.kind !== 'stool') return;
    const d = new Date(e.ts); d.setHours(0,0,0,0);
    days.add(d.getTime());
  });
  const sorted = [...days].sort((a,b)=>a-b);
  let best = 0, run = 0, prev = null;
  sorted.forEach(t=>{
    run = (prev !== null && t - prev === 86400000) ? run + 1 : 1;
    if(run > best) best = run;
    prev = t;
  });
  return best;
}

function computeAchievementStats(){
  return {
    entriesCount: entries.length,
    maxStreak: longestStreak(entries),
    restroomsOwned: currentUserId ? restrooms.filter(r=>r.userId === currentUserId).length : 0,
    visitedTrends: localStorage.getItem(VISITED_TRENDS_KEY) === 'true',
    tier: currentTier
  };
}

function renderAchievements(){
  const grid = document.getElementById('achievementsGrid');
  if(!grid) return;
  const stats = computeAchievementStats();
  const seen = JSON.parse(localStorage.getItem(SEEN_BADGES_KEY) || '[]');
  const newlyUnlocked = [];
  const states = ACHIEVEMENTS.map(a=>{
    const unlocked = !!a.check(stats);
    if(unlocked && !seen.includes(a.key)) newlyUnlocked.push(a.key);
    return { ...a, unlocked, progressText: (!unlocked && a.progress) ? a.progress(stats) : null };
  });
  if(newlyUnlocked.length){
    localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify([...seen, ...newlyUnlocked]));
  }
  grid.innerHTML = states.map(a=>{
    const justUnlocked = newlyUnlocked.includes(a.key);
    return `<div class="badge-card ${a.unlocked?'unlocked':'locked'} ${justUnlocked?'badge-pop':''}">
      <div class="badge-icon">${a.icon}</div>
      <div class="badge-name">${escapeHtml(a.name)}</div>
      <div class="badge-desc">${escapeHtml(a.desc)}</div>
      ${a.progressText ? `<div class="badge-progress">${escapeHtml(a.progressText)}</div>` : ''}
    </div>`;
  }).join('');
}

