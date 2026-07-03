'use strict';
/* ============================================================
   Demand Projection Tool — app.js
   Drop into profile_tool/static/app.js

   API endpoints (served by app.py):
     GET  /choose-output-folder  → { ok, path }
     POST /generate              → { ok, output_path, rows_written,
                                     summaries, graph }
   ============================================================ */

// ── Constants ────────────────────────────────────────────────
const ACCENT  = '#3b6ef6';
const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DEFAULT_PERIODS = 24;
const DAYS_PER_YEAR   = 365;

// ── App state ────────────────────────────────────────────────
const state = {
  step: 1,
  files: { base: null, peak: null, energy: null }, // { name, file }
  outputFolder: '',
  generating: false,
  hasResults: false,
  outputPath: '',
  selYear: 0,
};

// ── Chart state ──────────────────────────────────────────────
let chartYears = [];
let viewMin    = 0,  viewMax  = 1;
let hoverPos   = null;
let dragging   = false;
let dragX, dragMin, dragMax, plot;

// ── Helpers ──────────────────────────────────────────────────
function nf(v, d = 0) {
  const n = Number(v);
  if (!isFinite(n)) return '-';
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtPct(v, d = 2) {
  const n = Number(v);
  if (!isFinite(n) || v == null) return '—';
  return (n >= 0 ? '+' : '') + nf(n, d) + '%';
}
function shortPath(p) {
  if (!p) return 'Waiting';
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fyLabel(y) { return `${y}–${String(Number(y) + 1).slice(2)}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function spanV() { return (viewMax - viewMin) || 1; }
function clampView(mn, mx) {
  const span = mx - mn;
  if (span >= 1) return [0, 1];
  if (mn < 0) { mn = 0; mx = span; }
  if (mx > 1) { mx = 1; mn = 1 - span; }
  return [mn, mx];
}
function allFilesLoaded() {
  return !!(state.files.base && state.files.peak && state.files.energy);
}

// ── Step navigation ──────────────────────────────────────────
function goNext() {
  if (state.step === 1 && !allFilesLoaded()) return;
  if (state.step === 2 && !state.outputFolder) return;
  if (state.step < 3) { state.step++; render(); }
}
function goBack() {
  if (state.generating) return;
  if (state.step > 1) { state.step--; render(); }
}
function goToStep(n) {
  if (state.hasResults || state.generating) return;
  if (n <= state.step) { state.step = n; render(); return; }
  if (n === 2 && allFilesLoaded())                          { state.step = 2; render(); return; }
  if (n === 3 && allFilesLoaded() && state.outputFolder)   { state.step = 3; render(); }
}

// ── Master render ────────────────────────────────────────────
function render() {
  renderPill();
  renderSteps();
  renderFileTiles();
  renderPanels();
  renderButtons();
  if (state.step === 3 && !state.generating) renderReview();
}

function renderPill() {
  const pill = document.getElementById('status-pill');
  const dot  = document.getElementById('pill-dot');
  const lbl  = document.getElementById('pill-label');
  if (!pill) return;
  if (state.generating) {
    Object.assign(pill.style, { background:'rgba(245,165,36,0.12)', color:'#b6790a', border:'1px solid rgba(245,165,36,0.3)' });
    dot.style.background = '#f5a524'; pill.dataset.status = 'running'; lbl.textContent = 'Running';
  } else if (state.hasResults) {
    Object.assign(pill.style, { background:'rgba(18,179,160,0.12)', color:'#0e8f80', border:'1px solid rgba(18,179,160,0.32)' });
    dot.style.background = '#12b3a0'; pill.dataset.status = 'complete'; lbl.textContent = 'Complete';
  } else {
    Object.assign(pill.style, { background:'rgba(255,255,255,0.5)', color:'#5a6a86', border:'1px solid rgba(120,140,170,0.3)' });
    dot.style.background = '#94a3b8'; pill.dataset.status = 'ready'; lbl.textContent = 'Ready';
  }
}

function renderSteps() {
  for (let n = 1; n <= 3; n++) {
    const circle = document.getElementById(`step-circle-${n}`);
    const line   = document.getElementById(`step-line-${n}`);
    const title  = document.getElementById(`step-title-${n}`);
    const sub    = document.getElementById(`step-sub-${n}`);
    const done   = n < state.step, active = n === state.step;
    circle.dataset.status = done ? 'done' : (active ? 'active' : 'todo');
    circle.textContent = done ? '✓' : String(n);
    if (line && n < 3) line.dataset.done = done ? 'true' : 'false';
    title.style.color = (active || done) ? '#13203a' : '#8593aa';
    sub.style.color   = active ? '#5a6a86' : '#9aa7bd';
  }
}

function renderFileTiles() {
  ['base', 'peak', 'energy'].forEach(key => {
    const tile   = document.getElementById(`tile-${key}`);
    const name   = document.getElementById(`name-${key}`);
    const badge  = document.getElementById(`badge-${key}`);
    const action = document.getElementById(`action-${key}`);
    const f = state.files[key];
    tile.dataset.loaded   = f ? 'true' : 'false';
    badge.textContent     = f ? '✓' : key[0].toUpperCase();
    name.textContent      = f ? f.name : 'Drag & drop or click to browse';
    action.textContent    = f ? 'Replace' : 'CSV / XLSX';
  });
}

function renderPanels() {
  const formSection    = document.getElementById('form-section');
  const resultsSection = document.getElementById('results-section');
  if (state.hasResults) {
    formSection.hidden    = true;
    resultsSection.hidden = false;
    return;
  }
  formSection.hidden    = false;
  resultsSection.hidden = true;
  for (let n = 1; n <= 3; n++) {
    document.getElementById(`panel-${n}`).classList.toggle('active', n === state.step);
  }
}

function renderButtons() {
  const c1 = document.getElementById('continue-1');
  const c2 = document.getElementById('continue-2');
  const b3 = document.getElementById('btn-back-3');
  if (c1) c1.disabled = !allFilesLoaded();
  if (c2) c2.disabled = !state.outputFolder;
  if (b3) b3.disabled = state.generating;
}

function renderReview() {
  const container = document.getElementById('review-rows');
  if (!container) return;
  const startYear = document.getElementById('f-start-year')?.value || '?';
  const endYear   = document.getElementById('f-end-year')?.value   || '?';
  const baseStart = document.getElementById('f-base-start')?.value || '';
  const baseEnd   = document.getElementById('f-base-end')?.value   || '';
  const profile   = document.getElementById('f-profile')?.value    || 'profile';
  const rows = [
    { label: 'Input files',  value: '3 of 3 files ready', style: 'font:700 13px Manrope,sans-serif;color:#0e8f80;' },
    { label: 'Base period',  value: `${fmtDate(baseStart)} → ${fmtDate(baseEnd)}`, style: 'font:600 13px Manrope,sans-serif;color:#13203a;' },
    { label: 'Projection',   value: `${fyLabel(startYear)} → ${fyLabel(endYear)} · ${Math.max(0, Number(endYear) - Number(startYear) + 1)} yrs`, style: 'font:600 13px Manrope,sans-serif;color:#13203a;' },
    { label: 'Output file',  value: `${profile}_projected.csv`, style: "font:600 12.5px 'JetBrains Mono',monospace;color:#42536e;" },
  ];
  container.innerHTML = rows.map(r =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid rgba(120,140,170,0.14);">
       <span style="font:600 13px 'Manrope',sans-serif;color:#5a6a86;">${r.label}</span>
       <span style="${r.style}">${r.value}</span>
     </div>`
  ).join('');
}

// ── File handling ────────────────────────────────────────────
function setupFileTiles() {
  ['base', 'peak', 'energy'].forEach(key => {
    const tile  = document.getElementById(`tile-${key}`);
    const input = document.getElementById(`input-${key}`);
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) {
        state.files[key] = { name: input.files[0].name, file: input.files[0] };
        render();
      }
    });
    tile.addEventListener('dragover',  e => { e.preventDefault(); tile.dataset.dragging = 'true'; });
    tile.addEventListener('dragleave', e => { e.preventDefault(); tile.dataset.dragging = 'false'; });
    tile.addEventListener('drop',      e => {
      e.preventDefault(); tile.dataset.dragging = 'false';
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) { state.files[key] = { name: f.name, file: f }; render(); }
    });
  });
}

// ── Input format help ────────────────────────────────────────
function setupInfoPopovers() {
  const popovers = Array.from(document.querySelectorAll('.info-popover'));

  const setOpen = (popover, open) => {
    const balloon = popover.querySelector('.info-balloon');
    if (!balloon) return;
    balloon.classList.toggle('is-open', open);
    if (open) {
      balloon.style.opacity = '1';
      balloon.style.visibility = 'visible';
      balloon.style.transform = window.matchMedia('(max-width: 700px)').matches
        ? 'translateY(0)'
        : 'translate(-18%, 0)';
    } else {
      balloon.style.removeProperty('opacity');
      balloon.style.removeProperty('visibility');
      balloon.style.removeProperty('transform');
    }
  };

  const closeAll = except => {
    popovers.forEach(popover => {
      if (popover === except) return;
      popover.dataset.pinned = 'false';
      setOpen(popover, false);
      popover.querySelector('.info-trigger')?.setAttribute('aria-expanded', 'false');
    });
  };

  popovers.forEach(popover => {
    const trigger = popover.querySelector('.info-trigger');
    const balloon = popover.querySelector('.info-balloon');
    if (!trigger || !balloon) return;

    trigger.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = popover.dataset.pinned !== 'true';
      closeAll(popover);
      popover.dataset.pinned = String(willOpen);
      setOpen(popover, willOpen);
      trigger.setAttribute('aria-expanded', String(willOpen));
    });

    popover.addEventListener('mouseenter', () => setOpen(popover, true));
    popover.addEventListener('mouseleave', () => {
      if (popover.dataset.pinned !== 'true') setOpen(popover, false);
    });
    trigger.addEventListener('focus', () => setOpen(popover, true));
    trigger.addEventListener('blur', () => {
      if (popover.dataset.pinned !== 'true') setOpen(popover, false);
    });

    trigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        trigger.click();
      } else if (event.key === 'Escape') {
        popover.dataset.pinned = 'false';
        setOpen(popover, false);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.blur();
      }
    });
  });

  document.addEventListener('click', () => closeAll());
}

// ── Folder picker ────────────────────────────────────────────
async function chooseFolder() {
  const btn = document.getElementById('btn-choose-folder');
  btn.disabled = true;
  try {
    const resp = await fetch('/choose-output-folder');
    const data = await resp.json();
    if (data.ok && data.path) {
      state.outputFolder = data.path;
      document.getElementById('f-folder').value = data.path;
      render();
    } else if (data.error) {
      console.warn('Folder picker:', data.error);
    }
  } catch (e) { console.error('chooseFolder:', e); }
  finally { btn.disabled = false; }
}

// ── Generation ───────────────────────────────────────────────
async function runGenerate() {
  if (state.generating) return;
  state.generating = true;
  render();
  document.getElementById('generate-btn-area').hidden = true;
  document.getElementById('progress-area').hidden = false;
  setProgress(0, 'Uploading files…');

  try {
    const fd = new FormData();
    fd.append('base_profile',         state.files.base.file);
    fd.append('peak_projection',      state.files.peak.file);
    fd.append('energy_projection',    state.files.energy.file);
    fd.append('base_start_date',      document.getElementById('f-base-start').value);
    fd.append('base_end_date',        document.getElementById('f-base-end').value);
    fd.append('projection_start_year',document.getElementById('f-start-year').value);
    fd.append('projection_end_year',  document.getElementById('f-end-year').value);
    fd.append('profile_name',         document.getElementById('f-profile').value);
    fd.append('output_folder',        state.outputFolder);

    // Animate progress while fetch is in flight
    let p = 5;
    const stages = [[0,'Uploading files…'],[20,'Reading base profile…'],[45,'Mapping daily profile…'],[70,'Scaling to peak & energy targets…'],[88,'Writing projected CSV…']];
    const timer = setInterval(() => {
      p = Math.min(p + 3 + Math.random() * 5, 92);
      const label = stages.filter(s => s[0] <= p).pop()[1];
      setProgress(p, label);
    }, 300);

    const resp = await fetch('/generate', { method: 'POST', body: fd });
    clearInterval(timer);

    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Generation failed.');

    setProgress(100, 'Complete');
    await sleep(420);

    state.outputPath  = data.output_path;
    state.hasResults  = true;
    state.generating  = false;
    render();                   // shows results panel
    populateResults(data);      // fill metrics + table
    setupChart(data.graph);     // draw chart

  } catch (err) {
    state.generating = false;
    document.getElementById('progress-area').hidden     = true;
    document.getElementById('generate-btn-area').hidden = false;
    setProgress(0, '');
    // Surface error inside review card
    const rr = document.getElementById('review-rows');
    rr.insertAdjacentHTML('beforeend',
      `<div style="padding:14px 0;color:#b42318;font:600 13px 'Manrope',sans-serif;">⚠ ${err.message}</div>`);
    render();
  }
}

function setProgress(pct, label) {
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('progress-label').textContent = label;
  document.getElementById('progress-pct').textContent   = `${Math.round(pct)}%`;
}

// ── Results population ───────────────────────────────────────
function populateResults(data) {
  document.getElementById('output-path-text').textContent = data.output_path;

  const sums  = data.summaries || [];
  const first = sums[0]  || {};
  const last  = sums[sums.length - 1] || {};
  const fyOf  = s => s.financial_year || s.projection_year || '';

  // Metrics
  const metricData = [
    { label: 'Rows written',    value: nf(data.rows_written) },
    { label: 'Projection span', value: sums.length ? `${fyOf(first)} → ${fyOf(last)}` : '—' },
    { label: 'Periods / day',   value: String(first.periods_per_day || DEFAULT_PERIODS) },
    { label: 'Output file',     value: shortPath(data.output_path) },
  ];
  document.getElementById('metrics-grid').innerHTML = metricData.map(m =>
    `<div class="metric-tile">
       <div class="metric-label">${m.label}</div>
       <div class="metric-value">${m.value}</div>
     </div>`
  ).join('');

  // Summary table
  document.getElementById('summary-tbody').innerHTML = sums.map(s =>
    `<tr>
       <td>${fyOf(s)}</td>
       <td>${nf(s.row_count)}</td>
       <td>${nf(s.achieved_peak_mw)}</td>
       <td>${nf(s.achieved_energy_gwh, 3)}</td>
       <td class="growth">${fmtPct(s.peak_growth_percent, 2)}</td>
       <td class="growth">${fmtPct(s.energy_growth_percent, 2)}</td>
     </tr>`
  ).join('');
}

function copyOutputPath() {
  try { navigator.clipboard.writeText(state.outputPath); } catch (e) {}
}

function newRun() {
  state.hasResults = false; state.step = 1; state.generating = false;
  hoverPos = null; viewMin = 0; viewMax = 1;
  document.getElementById('progress-area').hidden     = true;
  document.getElementById('generate-btn-area').hidden = false;
  setProgress(0, '');
  render();
}

// ── Chart setup ──────────────────────────────────────────────
function setupChart(graph) {
  chartYears = (graph.years || []).map(y => ({
    year:         y.year,
    label:        y.label,
    startDate:    y.start_date,
    periodsPerDay: y.periods_per_day || DEFAULT_PERIODS,
    base:         y.mapped_base.points,
    projected:    y.projected.points,
  }));
  viewMin = 0; viewMax = 1; hoverPos = null;
  renderYearChips();
  requestAnimationFrame(drawChart);
}

function renderYearChips() {
  document.getElementById('year-chips').innerHTML = chartYears.map((y, i) =>
    `<div class="year-chip${i === state.selYear ? ' active' : ''}" onclick="selectYear(${i})">${y.label}</div>`
  ).join('');
}

function selectYear(i) {
  state.selYear = i; hoverPos = null; viewMin = 0; viewMax = 1;
  renderYearChips(); drawChart();
}

function resetChartView() {
  viewMin = 0; viewMax = 1; hoverPos = null;
  const tip = document.getElementById('chart-tooltip');
  if (tip) tip.style.opacity = '0';
  drawChart();
}

function curYear() { return chartYears[state.selYear] || null; }

// ── Chart drawing ────────────────────────────────────────────
function buildScreenPts(pts, pl) {
  const n = pts.length, span = spanV();
  const i0 = Math.max(0, Math.floor(viewMin * (n - 1)));
  const i1 = Math.min(n - 1, Math.ceil(viewMax * (n - 1)));
  const xOf = idx => pl.left + (((idx / (n - 1)) - viewMin) / span) * pl.w;
  const arr = [];
  if ((i1 - i0 + 1) <= pl.w * 1.5) {
    for (let i = i0; i <= i1; i++) arr.push([xOf(i), pl.bottom - pts[i] * pl.h]);
  } else {
    const px = Math.max(2, Math.floor(pl.w));
    for (let p = 0; p <= px; p++) {
      const a = Math.max(0, Math.floor((viewMin + span * (p / px)) * (n - 1)));
      const b = Math.min(n - 1, Math.max(a, Math.ceil((viewMin + span * ((p + 1) / px)) * (n - 1))));
      let mn = pts[a], mx = pts[a];
      for (let k = a + 1; k <= b; k++) { if (pts[k] < mn) mn = pts[k]; if (pts[k] > mx) mx = pts[k]; }
      const x = pl.left + (p / px) * pl.w;
      arr.push([x, pl.bottom - mx * pl.h]);
      arr.push([x, pl.bottom - mn * pl.h]);
    }
  }
  return arr;
}

function buildTopEnvelope(pts, pl) {
  const n = pts.length, span = spanV();
  const px = Math.max(2, Math.floor(pl.w));
  const arr = [];
  for (let p = 0; p <= px; p++) {
    const a = Math.max(0, Math.floor((viewMin + span * (p / px)) * (n - 1)));
    const b = Math.min(n - 1, Math.max(a, Math.ceil((viewMin + span * ((p + 1) / px)) * (n - 1))));
    let mx = pts[a];
    for (let k = a + 1; k <= b; k++) { if (pts[k] > mx) mx = pts[k]; }
    arr.push([pl.left + (p / px) * pl.w, pl.bottom - mx * pl.h]);
  }
  return arr;
}

function xLabelFor(pos, yr, mode) {
  const n = yr.base.length, p = yr.periodsPerDay;
  const idx = Math.max(0, Math.min(n - 1, Math.round(pos * (n - 1))));
  const day = Math.floor(idx / p), period = idx % p;
  const d = new Date(yr.startDate + 'T00:00:00'); d.setDate(d.getDate() + day);
  if (mode === 'hour') return `${String(period).padStart(2,'0')}:00`;
  if (mode === 'day')  return `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]}`;
  return MONTHS[d.getMonth()];
}

function drawChart() {
  const cv = document.getElementById('profile-chart'), yr = curYear();
  if (!cv || !yr) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) { requestAnimationFrame(drawChart); return; }
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pl = { left:42, right:w-14, top:14, bottom:h-28 };
  pl.w = pl.right - pl.left; pl.h = pl.bottom - pl.top;
  plot = pl;

  const sp = spanV();
  const visibleDays = sp * DAYS_PER_YEAR;
  const mode = visibleDays <= 3 ? 'hour' : (visibleDays <= 70 ? 'day' : 'month');

  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = pl.top + pl.h * i / 4;
    ctx.strokeStyle = 'rgba(90,110,140,0.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl.left, y); ctx.lineTo(pl.right, y); ctx.stroke();
    ctx.fillStyle = 'rgba(90,106,134,0.85)';
    ctx.fillText((1 - i / 4).toFixed(2), pl.left - 8, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (let i = 0; i <= 6; i++) {
    const frac = i / 6, x = pl.left + pl.w * frac, pos = viewMin + sp * frac;
    ctx.strokeStyle = 'rgba(90,110,140,0.10)';
    ctx.beginPath(); ctx.moveTo(x, pl.top); ctx.lineTo(x, pl.bottom); ctx.stroke();
    ctx.fillStyle = 'rgba(90,106,134,0.85)';
    ctx.fillText(xLabelFor(pos, yr, mode), x, pl.bottom + 8);
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(pl.left, pl.top, pl.w, pl.h); ctx.clip();

  // Gradient fill under projected
  const fillTop = buildTopEnvelope(yr.projected, pl);
  if (fillTop.length) {
    const grad = ctx.createLinearGradient(0, pl.top, 0, pl.bottom);
    grad.addColorStop(0, 'rgba(59,110,246,0.20)');
    grad.addColorStop(1, 'rgba(59,110,246,0.0)');
    ctx.beginPath(); ctx.moveTo(fillTop[0][0], fillTop[0][1]);
    for (let k = 1; k < fillTop.length; k++) ctx.lineTo(fillTop[k][0], fillTop[k][1]);
    ctx.lineTo(fillTop[fillTop.length - 1][0], pl.bottom);
    ctx.lineTo(fillTop[0][0], pl.bottom);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  }

  const strokePts = (arr, color, dash, alpha, lw) => {
    if (!arr.length) return;
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash(dash); ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(arr[0][0], arr[0][1]);
    for (let k = 1; k < arr.length; k++) ctx.lineTo(arr[k][0], arr[k][1]);
    ctx.stroke(); ctx.restore();
  };
  strokePts(buildScreenPts(yr.base, pl),      '#1b2740', [7,5], 0.5,  1.6);
  strokePts(buildScreenPts(yr.projected, pl), ACCENT,    [],    0.95, 2.2);

  // Hover crosshair + dots
  if (hoverPos != null) {
    const n = yr.base.length;
    const x = pl.left + ((hoverPos - viewMin) / sp) * pl.w;
    if (x >= pl.left && x <= pl.right) {
      const i = Math.max(0, Math.min(n - 1, Math.round(hoverPos * (n - 1))));
      ctx.strokeStyle = 'rgba(27,39,64,0.26)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(x, pl.top); ctx.lineTo(x, pl.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#1b2740'; ctx.beginPath(); ctx.arc(x, pl.bottom - yr.base[i] * pl.h, 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = ACCENT;   ctx.beginPath(); ctx.arc(x, pl.bottom - yr.projected[i] * pl.h, 4, 0, 7); ctx.fill();
    }
  }
  ctx.restore();
}

function posFromX(x) {
  if (!plot) return 0;
  return viewMin + Math.max(0, Math.min(1, (x - plot.left) / plot.w)) * spanV();
}

function updateTooltip(x) {
  const yr  = curYear();
  const tip = document.getElementById('chart-tooltip');
  if (!yr || !tip || !plot || hoverPos == null) return;
  const n = yr.base.length, p = yr.periodsPerDay;
  const i = Math.max(0, Math.min(n - 1, Math.round(hoverPos * (n - 1))));
  const dayOffset = Math.floor(i / p), period = i % p;
  const d = new Date(yr.startDate + 'T00:00:00'); d.setDate(d.getDate() + dayOffset);
  const dateLabel = `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  tip.innerHTML =
    `<div style="font-weight:700;color:#13203a;font-size:12.5px;margin-bottom:7px;">${dateLabel} · ${String(period).padStart(2,'0')}:00 · P${period+1}</div>` +
    `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;"><span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:14px;height:0;border-top:2px dashed #1b2740;display:inline-block;"></span>Mapped base</span><b style="font-family:'JetBrains Mono',monospace;color:#13203a;">${yr.base[i].toFixed(3)}</b></div>` +
    `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;margin-top:4px;"><span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:14px;height:2px;background:${ACCENT};display:inline-block;border-radius:1px;"></span>Projected</span><b style="font-family:'JetBrains Mono',monospace;color:#13203a;">${yr.projected[i].toFixed(3)}</b></div>`;
  tip.style.opacity = '1';
  const tw = 200, left = x > plot.w - tw ? x - tw - 10 : x + 14;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top  = '14px';
}

// ── Chart interactions ───────────────────────────────────────
function setupChartInteractions() {
  const cv = document.getElementById('profile-chart');
  if (!cv) return;

  // Zoom on wheel
  cv.addEventListener('wheel', e => {
    const yr = curYear(); if (!plot || !yr) return;
    e.preventDefault();
    const rect   = cv.getBoundingClientRect();
    const cx     = e.clientX - rect.left;
    const anchor = posFromX(cx);
    const sp     = spanV();
    const minSpan = 4 / (yr.base.length - 1);
    const nSpan  = Math.max(minSpan, Math.min(1, sp * (e.deltaY < 0 ? 0.82 : 1.22)));
    const ratio  = (anchor - viewMin) / sp;
    [viewMin, viewMax] = clampView(anchor - nSpan * ratio, anchor - nSpan * ratio + nSpan);
    hoverPos = anchor; drawChart(); updateTooltip(cx);
  }, { passive: false });

  // Drag to pan (start)
  cv.addEventListener('mousedown', e => {
    if (!plot) return;
    dragging = true; dragX = e.clientX; dragMin = viewMin; dragMax = viewMax;
    hoverPos = null;
    const tip = document.getElementById('chart-tooltip');
    if (tip) tip.style.opacity = '0';
    cv.style.cursor = 'grabbing';
  });

  // Hover crosshair
  cv.addEventListener('mousemove', e => {
    if (dragging) return;
    const yr = curYear(); if (!yr || !plot) return;
    const rect = cv.getBoundingClientRect(), x = e.clientX - rect.left;
    hoverPos = posFromX(x); drawChart(); updateTooltip(x);
  });

  cv.addEventListener('mouseleave', () => {
    if (dragging) return;
    hoverPos = null;
    const tip = document.getElementById('chart-tooltip');
    if (tip) tip.style.opacity = '0';
    drawChart();
  });

  // Double-click reset
  cv.addEventListener('dblclick', resetChartView);

  // Drag pan + release (window-level so it works outside canvas)
  window.addEventListener('mousemove', e => {
    if (!dragging || !plot) return;
    const sp = dragMax - dragMin;
    const dx = (e.clientX - dragX) / plot.w;
    [viewMin, viewMax] = clampView(dragMin - dx * sp, dragMax - dx * sp);
    drawChart();
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      const cv2 = document.getElementById('profile-chart');
      if (cv2) cv2.style.cursor = 'grab';
    }
  });
  window.addEventListener('resize', drawChart);
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupFileTiles();
  setupInfoPopovers();
  setupChartInteractions();
  render();
});
