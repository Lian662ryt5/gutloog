/* ---- Admin review queue (restroom moderation) ---- */
// Only reachable if profiles.is_admin is true for the signed-in user (see
// pricing.js loadProfileTier) - RLS backs this up server-side regardless,
// so hiding the tab is a UX nicety, not the actual access control.
let adminQueue = [];

function formatReportDate(iso){
  try{ return new Date(iso).toLocaleDateString(undefined, {month:'short', day:'numeric'}); }
  catch(e){ return ''; }
}

async function loadAdminQueue(){
  const list = document.getElementById('adminQueueList');
  if(!list) return;
  list.innerHTML = '<div class="empty">Loading…</div>';
  try{
    await ensureAuth();
    const { data: restroomsData, error: restroomsErr } = await sb.from('restrooms')
      .select('*').eq('hidden', true).order('id', {ascending:false});
    if(restroomsErr) throw restroomsErr;
    const ids = (restroomsData||[]).map(r=>r.id);
    let reportsByRestroom = {};
    if(ids.length){
      const { data: reportsData, error: reportsErr } = await sb.from('restroom_reports')
        .select('id, restroom_id, reason, note, created_at').in('restroom_id', ids).order('created_at', {ascending:false});
      if(reportsErr) throw reportsErr;
      (reportsData||[]).forEach(rep=>{
        (reportsByRestroom[rep.restroom_id] = reportsByRestroom[rep.restroom_id] || []).push(rep);
      });
    }
    adminQueue = (restroomsData||[]).map(r=>({ ...rowToRestroom(r), reports: reportsByRestroom[r.id] || [] }));
  }catch(e){
    console.error('load admin queue failed', e);
    list.innerHTML = '<div class="empty">Could not load the review queue — check your connection.</div>';
    return;
  }
  renderAdminQueue();
}

function renderAdminQueue(){
  const list = document.getElementById('adminQueueList');
  if(!list) return;
  if(!adminQueue.length){
    list.innerHTML = '<div class="empty">Nothing pending review.</div>';
    return;
  }
  list.innerHTML = adminQueue.map(r=>{
    const reportsHtml = r.reports.map(rep=>
      `<div class="areport">${escapeHtml(REPORT_REASON_LABELS[rep.reason] || rep.reason)}${rep.note ? ` — ${escapeHtml(rep.note)}` : ''} <span>(${formatReportDate(rep.created_at)})</span></div>`
    ).join('');
    return `<div class="admin-card" data-admin-id="${r.id}">
      <div class="rname">${escapeHtml(r.name)}</div>
      <div class="rloc">${escapeHtml(r.loc||'')}</div>
      <div class="admin-reports">${r.reports.length} report${r.reports.length===1?'':'s'}:${reportsHtml}</div>
      <div class="admin-actions">
        <button class="approve-btn" type="button" data-approve="${r.id}">Approve — restore to public list</button>
        <button class="remove-btn" type="button" data-remove="${r.id}">Remove permanently</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-approve]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id = +b.dataset.approve;
      b.disabled = true;
      b.textContent = 'Restoring…';
      try{
        const { error } = await sb.from('restrooms')
          .update({ hidden: false, reviewed_at: new Date().toISOString(), reviewed_by: currentUserId })
          .eq('id', id);
        if(error) throw error;
        adminQueue = adminQueue.filter(r=>r.id !== id);
        renderAdminQueue();
        if(typeof loadRestrooms === 'function') loadRestrooms();
      }catch(e){
        console.error('approve restroom failed', e);
        alert('Could not restore this spot — check your connection and try again.');
        b.disabled = false;
        b.textContent = 'Approve — restore to public list';
      }
    });
  });
  list.querySelectorAll('[data-remove]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const id = +b.dataset.remove;
      if(!confirm('Permanently remove this spot? This deletes it (and its reports) for everyone and can\'t be undone.')) return;
      b.disabled = true;
      b.textContent = 'Removing…';
      try{
        const { error } = await sb.from('restrooms').delete().eq('id', id);
        if(error) throw error;
        adminQueue = adminQueue.filter(r=>r.id !== id);
        renderAdminQueue();
      }catch(e){
        console.error('remove restroom failed', e);
        alert('Could not remove this spot — check your connection and try again.');
        b.disabled = false;
        b.textContent = 'Remove permanently';
      }
    });
  });
}
