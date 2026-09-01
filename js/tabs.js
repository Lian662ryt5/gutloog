/* ---- Tabs ---- */
function switchTab(name){
  document.querySelectorAll('.tabbtn').forEach(b=>{
    const isSel = b.dataset.tab===name;
    b.classList.toggle('active', isSel);
    b.setAttribute('aria-selected', String(isSel));
  });
  document.querySelectorAll('.tabpage').forEach(p=>p.classList.toggle('active', p.id==='page-'+name));
  if(name === 'trends' && localStorage.getItem(VISITED_TRENDS_KEY) !== 'true'){
    localStorage.setItem(VISITED_TRENDS_KEY, 'true');
    renderAchievements();
  }
  if(name === 'achievements'){
    renderAchievements();
  }
  if(name === 'profile'){
    renderProfile();
  }
  if(name === 'admin' && typeof loadAdminQueue === 'function'){
    loadAdminQueue();
  }
}
document.querySelectorAll('.tabbtn').forEach(btn=>{
  btn.addEventListener('click', ()=>switchTab(btn.dataset.tab));
});
document.querySelectorAll('.choice-card').forEach(card=>{
  card.addEventListener('click', ()=>switchTab(card.dataset.goto));
  card.addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===' '){ e.preventDefault(); switchTab(card.dataset.goto); }
  });
});

