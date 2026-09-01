/* ---- Offline queue (IndexedDB) ----
   NOTE: this app's table is `entries` (not `logs`) — both symptom and food
   rows are written there via `kind: 'stool' | 'food'`, so the queue targets
   that real table rather than a `logs` table that doesn't exist in this schema. */
const OFFLINE_DB_NAME = 'gutlog_offline';
const OFFLINE_STORE = 'pending_entries';
let offlineDBPromise = null;

function openOfflineDB(){
  if(offlineDBPromise) return offlineDBPromise;
  offlineDBPromise = new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){ reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains(OFFLINE_STORE)){
        db.createObjectStore(OFFLINE_STORE, { keyPath: 'localId', autoIncrement: true });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  return offlineDBPromise;
}

async function queueOfflineEntry(row){
  try{
    const db = await openOfflineDB();
    const localId = await new Promise((resolve, reject)=>{
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      const store = tx.objectStore(OFFLINE_STORE);
      const req = store.add({ row, queuedAt: new Date().toISOString() });
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
    // Covers the flaky-connection case where 'online' never cleanly fires -
    // starts the fallback poll now rather than waiting for the next page load.
    ensureSyncIntervalRunning();
    return localId;
  }catch(e){ console.error('queueOfflineEntry failed', e); return null; }
}

async function getQueuedEntries(){
  try{
    const db = await openOfflineDB();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(OFFLINE_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = ()=> resolve(req.result || []);
      req.onerror = ()=> reject(req.error);
    });
  }catch(e){ console.error('getQueuedEntries failed', e); return []; }
}

async function removeQueuedEntry(localId){
  try{
    const db = await openOfflineDB();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      const req = tx.objectStore(OFFLINE_STORE).delete(localId);
      req.onsuccess = ()=> resolve(true);
      req.onerror = ()=> reject(req.error);
    });
  }catch(e){ console.error('removeQueuedEntry failed', e); return false; }
}

function isNetworkError(e){
  if(!navigator.onLine) return true;
  const msg = (e && e.message) ? e.message.toLowerCase() : '';
  return e instanceof TypeError || msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed');
}

function showToast(text){
  let host = document.getElementById('toastHost');
  if(!host){
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(()=> el.classList.add('show'));
  setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=> el.remove(), 300);
  }, 3500);
}

let syncInFlight = false;
let syncIntervalId = null;

// The 'online' event covers the common case for free (zero cost while
// idle). This interval is only a fallback for flaky connections that never
// cleanly fire 'online' - so it only runs while something is actually
// queued, instead of polling forever on every open tab.
function ensureSyncIntervalRunning(){
  if(syncIntervalId !== null) return;
  syncIntervalId = setInterval(syncOfflineQueue, 30000);
}
function stopSyncIntervalIfIdle(){
  if(syncIntervalId === null) return;
  clearInterval(syncIntervalId);
  syncIntervalId = null;
}

async function syncOfflineQueue(){
  if(syncInFlight || !navigator.onLine) return;
  syncInFlight = true;
  try{
    const queued = await getQueuedEntries();
    if(!queued.length){ stopSyncIntervalIfIdle(); return; }
    ensureSyncIntervalRunning();
    let syncedCount = 0;
    for(const item of queued){
      try{
        const { data, error } = await sb.from('entries').insert(item.row).select().single();
        if(error) throw error;
        await removeQueuedEntry(item.localId);
        entries = entries.filter(e=> e.localId !== item.localId);
        entries.unshift(rowToEntry(data));
        syncedCount++;
      }catch(e){
        if(isNetworkError(e)) break; // still offline — stop and retry later
        console.error('offline sync failed for item', item.localId, e);
      }
    }
    if(syncedCount){
      showToast(`Synced ${syncedCount} offline ${syncedCount===1?'entry':'entries'}.`);
      render();
    }
    const remaining = await getQueuedEntries();
    if(!remaining.length) stopSyncIntervalIfIdle();
  } finally {
    syncInFlight = false;
  }
}

window.addEventListener('online', syncOfflineQueue);
// Cheap one-off check at load: if a previous offline session left entries
// queued, start the fallback interval; otherwise it stays off entirely.
getQueuedEntries().then(q => { if(q.length) ensureSyncIntervalRunning(); });

