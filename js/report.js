/* ---- Doctor report (PDF export) ----
   Builds a clinic-ready PDF for a user-chosen date range: summary stats,
   Bristol Scale distribution, weekly symptom trend, flare history, food
   correlations, and the medication log. Runs entirely client-side.

   jsPDF is loaded lazily from the CDN already allowed by the app's CSP
   (script-src already includes https://cdn.jsdelivr.net for supabase-js)
   only when a report is actually requested - most sessions never touch
   this feature, so it shouldn't cost anyone a ~140KB script on every
   page load. */

const JSPDF_CDN_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
let jsPDFReadyPromise = null;

function ensureJsPDFLoaded(){
  if(window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  if(jsPDFReadyPromise) return jsPDFReadyPromise;
  jsPDFReadyPromise = new Promise((resolve, reject)=>{
    const script = document.createElement('script');
    script.src = JSPDF_CDN_URL;
    script.onload = ()=> resolve();
    script.onerror = ()=>{ jsPDFReadyPromise = null; reject(new Error('Could not load the PDF library — check your connection.')); };
    document.head.appendChild(script);
  });
  return jsPDFReadyPromise;
}

// Fetches every entry (any kind) in [fromDate, toDate] (inclusive, local
// calendar days), batched like fetchAllEntriesForExport() so an
// arbitrarily long report range can't silently drop rows.
async function fetchEntriesForReport(fromDate, toDate){
  await ensureAuth();
  const fromISO = new Date(fromDate + 'T00:00:00').toISOString();
  const toISO = new Date(toDate + 'T23:59:59.999').toISOString();
  const BATCH = 1000;
  let all = [];
  let cursor = null;
  while(true){
    let query = sb.from('entries').select('*')
      .gte('ts', fromISO).lte('ts', toISO)
      .order('ts', {ascending:true}).limit(BATCH);
    if(cursor) query = query.gt('ts', cursor);
    const { data, error } = await query;
    if(error) throw error;
    const rows = (data||[]).map(rowToEntry);
    all = all.concat(rows);
    if(rows.length < BATCH) break;
    cursor = rows[rows.length-1].ts;
  }
  return all;
}

function reportIsFlagged(e){
  return e.tags.includes('blood') || e.tags.includes('urgent') || (e.pain!==null && e.pain>=2);
}

function computeReportData(rows, fromDate, toDate){
  const stoolEntries = rows.filter(e=>e.kind==='stool');
  const foodEntries = rows.filter(e=>e.kind==='food');
  const medicationEntries = rows.filter(e=>e.kind==='medication');
  const flares = stoolEntries.filter(reportIsFlagged);

  const bristolCounts = [0,0,0,0,0,0,0];
  stoolEntries.forEach(e=>{ if(e.type>=1 && e.type<=7) bristolCounts[e.type-1]++; });

  const avgType = stoolEntries.length
    ? (stoolEntries.reduce((s,e)=>s+e.type,0)/stoolEntries.length).toFixed(1)
    : null;

  const daySet = new Set();
  rows.forEach(e=>{ const d = new Date(e.ts); d.setHours(0,0,0,0); daySet.add(d.getTime()); });
  const rangeDays = Math.max(1, Math.round((new Date(toDate+'T00:00:00') - new Date(fromDate+'T00:00:00'))/86400000) + 1);
  const loggedDays = daySet.size;
  const adherencePct = Math.round((loggedDays/rangeDays)*100);

  let mostCommonType = null;
  if(stoolEntries.length){
    mostCommonType = bristolCounts.reduce((best,c,i)=> c>bristolCounts[best] ? i : best, 0);
  }

  const summaryRows = [
    {metric:'Total entries logged', value:String(rows.length)},
    {metric:'Symptom entries', value:String(stoolEntries.length)},
    {metric:'Days logged', value:`${loggedDays} of ${rangeDays} (${adherencePct}%)`},
    {metric:'Average Bristol type', value: avgType || 'No symptom entries logged'},
    {metric:'Most common Bristol type', value: mostCommonType!==null ? `Type ${mostCommonType+1} — ${BRISTOL[mostCommonType].label}` : 'No symptom entries logged'},
    {metric:'Flagged entries (blood, urgency, or pain 2+)', value:String(flares.length)},
    {metric:'Food entries logged', value:String(foodEntries.length)},
    {metric:'Medication entries logged', value:String(medicationEntries.length)},
  ];

  // Monday-start weekly buckets.
  const weekMap = new Map();
  stoolEntries.forEach(e=>{
    const d = new Date(e.ts);
    const day = d.getDay();
    const diffToMonday = (day===0 ? -6 : 1-day);
    const weekStart = new Date(d); weekStart.setHours(0,0,0,0); weekStart.setDate(d.getDate()+diffToMonday);
    // Local calendar date, not toISOString() (UTC) - see localIsoDate's own
    // comment. weekStart is already local midnight Monday; converting it to
    // UTC before slicing would roll it back to Sunday's date for any
    // positive-UTC-offset timezone, mislabeling the week by one day (the
    // grouping itself stays correct since every entry in the same local
    // week produces the same key either way - only the printed label was wrong).
    const key = localIsoDate(weekStart);
    if(!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key).push(e);
  });
  const weeklyRows = [...weekMap.entries()].sort((a,b)=> a[0]<b[0] ? -1 : 1).map(([key, weekEntries])=>{
    const flaggedCount = weekEntries.filter(reportIsFlagged).length;
    const avg = (weekEntries.reduce((s,e)=>s+e.type,0)/weekEntries.length).toFixed(1);
    return {
      week: new Date(key+'T00:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}),
      count: String(weekEntries.length),
      avgType: avg,
      flagged: String(flaggedCount),
    };
  });

  const flareRows = flares.map(e=>{
    const d = new Date(e.ts);
    return {
      date: d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}),
      time: d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),
      type: String(e.type),
      symptoms: e.tags.map(t=>TAG_LABELS[t]||t).join(', ') || '—',
      pain: (e.pain!==null && e.pain!==undefined) ? painLabels[e.pain] : '—',
      note: e.note || '',
    };
  });

  // Same 48h-before-a-flare correlation as the Trends tab, scoped to this
  // report's own date range rather than the tab's fixed 180-day window.
  const WINDOW_MS = 48*3600*1000;
  const counts = {};
  flares.forEach(flare=>{
    const flareTime = new Date(flare.ts).getTime();
    const seen = new Set();
    foodEntries.forEach(f=>{
      const ft = new Date(f.ts).getTime();
      if(ft <= flareTime && ft >= flareTime - WINDOW_MS){
        const key = (f.foodName||'').trim().toLowerCase();
        if(!key || seen.has(key)) return;
        seen.add(key);
        counts[key] = counts[key] || {name:f.foodName, count:0};
        counts[key].count++;
      }
    });
  });
  const foodCorrelationRows = Object.values(counts)
    .filter(c=>c.count>=2)
    .sort((a,b)=>b.count-a.count)
    .slice(0,10)
    .map(c=>({name:c.name, count:String(c.count)}));

  const medicationRows = medicationEntries.map(e=>{
    const d = new Date(e.ts);
    return {
      date: d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}),
      time: d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}),
      note: e.note || '—',
    };
  });

  return { summaryRows, bristolCounts, weeklyRows, flareRows, foodCorrelationRows, medicationRows, hasStoolEntries: stoolEntries.length>0 };
}

/* ---- PDF layout ---- */
const RPT_MARGIN = 15;
const RPT_PAGE_W = 210;
const RPT_PAGE_H = 297;
const RPT_CONTENT_W = RPT_PAGE_W - RPT_MARGIN*2;
const RPT_TEAL_DEEP = [43,78,71];
const RPT_TEAL = [63,111,102];
const RPT_INK = [30,42,40];
const RPT_INK_SOFT = [75,93,89];
const RPT_LINE = [215,222,217];
const RPT_PAPER = [237,241,238];

function formatReportDate(dateStr){
  return new Date(dateStr+'T00:00:00').toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'});
}

function rptCheckPageBreak(doc, y, needed){
  if(y + needed > RPT_PAGE_H - RPT_MARGIN - 8){
    doc.addPage();
    return RPT_MARGIN + 2;
  }
  return y;
}

function rptSectionHeading(doc, y, text){
  y = rptCheckPageBreak(doc, y, 16);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...RPT_TEAL_DEEP);
  doc.text(text, RPT_MARGIN, y);
  doc.setDrawColor(...RPT_TEAL);
  doc.setLineWidth(0.6);
  doc.line(RPT_MARGIN, y+2, RPT_MARGIN+RPT_CONTENT_W, y+2);
  doc.setLineWidth(0.2);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...RPT_INK);
  return y + 9;
}

function rptEmptyNote(doc, y, text){
  doc.setFontSize(9.5);
  doc.setTextColor(...RPT_INK_SOFT);
  doc.text(text, RPT_MARGIN, y);
  doc.setTextColor(...RPT_INK);
  return y + 8;
}

// Generic table: columns = [{header, key, width}], rows = [{key: value}].
// Wraps long cell text, zebra-stripes rows, repeats the header after a
// page break so a table split across pages is still readable.
function rptDrawTable(doc, startY, columns, rows){
  const lineHeight = 4.4;
  const cellPad = 1.6;
  const headerHeight = 7;
  const totalWidth = columns.reduce((s,c)=>s+c.width, 0);
  let y = startY;

  function drawHeaderRow(){
    doc.setFillColor(...RPT_TEAL_DEEP);
    doc.rect(RPT_MARGIN, y, totalWidth, headerHeight, 'F');
    doc.setTextColor(255,255,255);
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9);
    let x = RPT_MARGIN;
    columns.forEach(c=>{
      doc.text(c.header, x+cellPad, y+headerHeight/2+1.3);
      x += c.width;
    });
    y += headerHeight;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...RPT_INK);
  }

  drawHeaderRow();

  rows.forEach((row, idx)=>{
    doc.setFontSize(8.5);
    const cellLines = columns.map(c=> doc.splitTextToSize(String(row[c.key] ?? ''), c.width - cellPad*2));
    const rowLineCount = Math.max(...cellLines.map(l=>l.length), 1);
    const rowHeight = rowLineCount*lineHeight + cellPad*2;

    if(y + rowHeight > RPT_PAGE_H - RPT_MARGIN - 8){
      doc.addPage();
      y = RPT_MARGIN + 2;
      drawHeaderRow();
    }

    if(idx % 2 === 1){
      doc.setFillColor(...RPT_PAPER);
      doc.rect(RPT_MARGIN, y, totalWidth, rowHeight, 'F');
    }

    let x = RPT_MARGIN;
    columns.forEach((c, ci)=>{
      doc.text(cellLines[ci], x+cellPad, y+cellPad+3.1);
      x += c.width;
    });
    y += rowHeight;
  });

  doc.setDrawColor(...RPT_LINE);
  doc.line(RPT_MARGIN, y, RPT_MARGIN+totalWidth, y);
  return y + 7;
}

function rptDrawBarChart(doc, startY, labels, values){
  const height = 42;
  const barGap = 3;
  const barWidth = (RPT_CONTENT_W - barGap*(values.length-1)) / values.length;
  const max = Math.max(1, ...values);
  const baseline = startY + height;

  doc.setDrawColor(...RPT_LINE);
  doc.line(RPT_MARGIN, baseline, RPT_MARGIN+RPT_CONTENT_W, baseline);

  values.forEach((v, i)=>{
    const barH = (v/max) * (height-8);
    const x = RPT_MARGIN + i*(barWidth+barGap);
    doc.setFillColor(...RPT_TEAL);
    if(barH > 0) doc.rect(x, baseline-barH, barWidth, barH, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...RPT_INK);
    doc.text(String(v), x+barWidth/2, baseline-barH-1.5, {align:'center'});
    doc.setTextColor(...RPT_INK_SOFT);
    doc.text(labels[i], x+barWidth/2, baseline+5, {align:'center'});
  });
  doc.setTextColor(...RPT_INK);
  return baseline + 10;
}

function rptAddFooters(doc, rangeLabel){
  const pageCount = doc.internal.getNumberOfPages();
  for(let i=1;i<=pageCount;i++){
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...RPT_INK_SOFT);
    doc.text('Personal tracking only — not a diagnosis or medical advice.', RPT_MARGIN, RPT_PAGE_H-10);
    doc.text(`Gut Log · ${rangeLabel}`, RPT_MARGIN, RPT_PAGE_H-6.5);
    doc.text(`Page ${i} of ${pageCount}`, RPT_PAGE_W-RPT_MARGIN, RPT_PAGE_H-6.5, {align:'right'});
  }
}

async function generateDoctorReportPDF(fromDate, toDate){
  await ensureJsPDFLoaded();
  const { jsPDF } = window.jspdf;
  const rows = await fetchEntriesForReport(fromDate, toDate);
  const data = computeReportData(rows, fromDate, toDate);
  const rangeLabel = `${formatReportDate(fromDate)} – ${formatReportDate(toDate)}`;

  const doc = new jsPDF({unit:'mm', format:'a4'});
  let y = RPT_MARGIN;

  doc.setFont(undefined, 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...RPT_TEAL_DEEP);
  doc.text('Gut Log — Symptom Report', RPT_MARGIN, y+4);
  y += 11;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...RPT_INK_SOFT);
  doc.text(`Report period: ${rangeLabel}`, RPT_MARGIN, y);
  y += 5.5;
  const generatedLine = `Generated ${new Date().toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}` + (currentUsername ? ` for ${currentUsername}` : '');
  doc.text(generatedLine, RPT_MARGIN, y);
  y += 8;
  doc.setDrawColor(...RPT_TEAL_DEEP);
  doc.setLineWidth(0.8);
  doc.line(RPT_MARGIN, y, RPT_PAGE_W-RPT_MARGIN, y);
  doc.setLineWidth(0.2);
  doc.setTextColor(...RPT_INK);
  y += 10;

  y = rptSectionHeading(doc, y, 'Summary');
  y = rptDrawTable(doc, y,
    [{header:'Metric', key:'metric', width:120}, {header:'Value', key:'value', width:60}],
    data.summaryRows
  );

  y = rptSectionHeading(doc, y, 'Bristol Stool Scale distribution');
  if(data.hasStoolEntries){
    y = rptCheckPageBreak(doc, y, 55);
    y = rptDrawBarChart(doc, y, ['1','2','3','4','5','6','7'], data.bristolCounts);
  } else {
    y = rptEmptyNote(doc, y, 'No symptom entries logged in this period.');
  }
  y = rptDrawTable(doc, y,
    [{header:'Type', key:'n', width:18}, {header:'Description', key:'label', width:162}],
    BRISTOL.map(b=>({n:String(b.n), label:b.label}))
  );

  if(data.weeklyRows.length){
    y = rptSectionHeading(doc, y, 'Symptom trend by week');
    y = rptDrawTable(doc, y,
      [{header:'Week of', key:'week', width:45}, {header:'Entries', key:'count', width:40}, {header:'Avg type', key:'avgType', width:40}, {header:'Flagged', key:'flagged', width:40}],
      data.weeklyRows
    );
  }

  y = rptSectionHeading(doc, y, `Flare history (${data.flareRows.length})`);
  if(data.flareRows.length){
    y = rptDrawTable(doc, y,
      [{header:'Date', key:'date', width:28}, {header:'Time', key:'time', width:20}, {header:'Type', key:'type', width:14}, {header:'Symptoms', key:'symptoms', width:38}, {header:'Pain', key:'pain', width:20}, {header:'Note', key:'note', width:60}],
      data.flareRows
    );
  } else {
    y = rptEmptyNote(doc, y, 'No flagged entries (blood, urgency, or pain 2+) in this period.');
  }

  y = rptSectionHeading(doc, y, 'Foods logged before a flare (within 48h)');
  if(data.foodCorrelationRows.length){
    y = rptDrawTable(doc, y,
      [{header:'Food', key:'name', width:120}, {header:'Times before a flare', key:'count', width:60}],
      data.foodCorrelationRows
    );
  } else {
    y = rptEmptyNote(doc, y, 'Not enough food and flare data in this period to show a correlation.');
  }

  y = rptSectionHeading(doc, y, `Medication log (${data.medicationRows.length})`);
  if(data.medicationRows.length){
    y = rptDrawTable(doc, y,
      [{header:'Date', key:'date', width:35}, {header:'Time', key:'time', width:30}, {header:'Note', key:'note', width:115}],
      data.medicationRows
    );
  } else {
    y = rptEmptyNote(doc, y, 'No medication entries logged in this period.');
  }

  rptAddFooters(doc, rangeLabel);

  const filename = `gut-log-report-${fromDate}-to-${toDate}.pdf`;
  doc.save(filename);
  return filename;
}

/* ---- UI wiring ---- */
// Local calendar date, not toISOString().slice(0,10) - that's UTC, which
// for anyone east of UTC (roughly UTC+1 through UTC+12) during the hours
// between local midnight and UTC's date rollover would return yesterday's
// date as "today". That date string becomes this report's `to` boundary
// (fetchEntriesForReport interprets it as local end-of-day), so the bug
// silently excluded a user's own same-day entries from the PDF for a large
// part of the world for part of every day. Matches the local-date pattern
// already used elsewhere (e.g. reminders.js's handleReminderUrlParams).
function localIsoDate(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoDateNDaysAgo(n){
  const d = new Date(); d.setDate(d.getDate()-n);
  return localIsoDate(d);
}
function todayIsoDate(){ return localIsoDate(new Date()); }

function setReportPreset(days){
  const fromEl = document.getElementById('reportFromInput');
  const toEl = document.getElementById('reportToInput');
  if(!fromEl || !toEl) return;
  toEl.value = todayIsoDate();
  fromEl.value = days === 'all'
    ? (profileCreatedAt ? profileCreatedAt.slice(0,10) : '2000-01-01')
    : isoDateNDaysAgo(days);
}

document.querySelectorAll('#reportPresets [data-preset]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#reportPresets [data-preset]').forEach(b=>{
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('on');
    btn.setAttribute('aria-pressed', 'true');
    const preset = btn.dataset.preset;
    setReportPreset(preset === 'all' ? 'all' : +preset);
  });
});

// Default to a 90-day range so the button works without any setup.
setReportPreset(90);
document.querySelector('#reportPresets [data-preset="90"]')?.classList.add('on');
document.querySelector('#reportPresets [data-preset="90"]')?.setAttribute('aria-pressed', 'true');

document.getElementById('generateReportBtn')?.addEventListener('click', async ()=>{
  const from = document.getElementById('reportFromInput').value;
  const to = document.getElementById('reportToInput').value;
  const statusEl = document.getElementById('reportStatus');
  const btn = document.getElementById('generateReportBtn');
  statusEl.className = 'report-status';
  if(!from || !to){ statusEl.className = 'report-status err'; statusEl.textContent = 'Choose both a from and to date.'; return; }
  if(from > to){ statusEl.className = 'report-status err'; statusEl.textContent = 'The "from" date must be before the "to" date.'; return; }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Generating…';
  statusEl.textContent = '';
  try{
    await generateDoctorReportPDF(from, to);
    statusEl.className = 'report-status ok';
    statusEl.textContent = 'Report downloaded.';
  }catch(e){
    console.error('generate doctor report failed', e);
    statusEl.className = 'report-status err';
    statusEl.textContent = 'Could not generate the report — check your connection and try again.';
  }
  btn.disabled = false;
  btn.textContent = originalLabel;
});
