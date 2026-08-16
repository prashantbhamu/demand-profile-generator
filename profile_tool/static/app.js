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
const {
  basePeriodForStartYear,
  bindFinancialYearInput,
  parseFinancialYear,
} = FinancialYear;
const FINANCIAL_YEAR_FIELDS = {
  base:  { inputId: 'f-base-year',  errorId: 'f-base-year-error' },
  start: { inputId: 'f-start-year', errorId: 'f-start-year-error' },
  end:   { inputId: 'f-end-year',   errorId: 'f-end-year-error' },
};

// ── App state ────────────────────────────────────────────────
const state = {
  step: 1,
  files: { base: null, peak: null, energy: null, rooftopTrajectory: null, rooftopProfile: null }, // { name, file }
  coreValidation: {
    base: { status:'empty', message:'', data:null },
    peak: { status:'empty', message:'', data:null },
    energy: { status:'empty', message:'', data:null },
  },
  coreValidationTokens: { base:0, peak:0, energy:0 },
  rooftopEnabled: false,
  rooftopMode: 'daily',
  rooftopProfileValidation: { status: 'empty', message: '', data: null },
  rooftopTrajectoryValidation: { status: 'empty', message: '', data: null },
  rooftopValidationToken: 0,
  rooftopTrajectoryValidationToken: 0,
  outputFolder: '',
  generating: false,
  hasResults: false,
  outputPath: '',
  selYear: 0,
  periodsPerDay: DEFAULT_PERIODS,
  solarStartMinutes: 360,
  solarEndMinutes: 1080,
  solarInputError: '',
  summaryPeriod: 'solar',
  lastResults: null,
};

// ── Chart state ──────────────────────────────────────────────
let chartYears = [];
let viewMin    = 0,  viewMax  = 1;
let hoverPos   = null;
let dragging   = false;
let dragX, dragMin, dragMax, plot;
const financialYearBindings = new Map();

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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function spanV() { return (viewMax - viewMin) || 1; }
function clampView(mn, mx) {
  const span = mx - mn;
  if (span >= 1) return [0, 1];
  if (mn < 0) { mn = 0; mx = span; }
  if (mx > 1) { mx = 1; mn = 1 - span; }
  return [mn, mx];
}
function requiredFilesReady(files, rooftopEnabled, profileStatus, trajectoryStatus, coreValidation = null) {
  const coreValid = !coreValidation || ['base','peak','energy'].every(
    key => coreValidation[key]?.status === 'valid'
  );
  const standard = !!(files.base && files.peak && files.energy && coreValid);
  if (!rooftopEnabled) return standard;
  return !!(
    standard && files.rooftopTrajectory && files.rooftopProfile &&
    profileStatus === 'valid' && trajectoryStatus === 'valid'
  );
}
function allFilesLoaded() {
  return requiredFilesReady(
    state.files,
    state.rooftopEnabled,
    state.rooftopProfileValidation.status,
    state.rooftopTrajectoryValidation.status,
    state.coreValidation,
  );
}

function contextualFilesReady() {
  const coreReady = ['base','peak','energy'].every(key =>
    state.coreValidation[key].status === 'valid' &&
    state.coreValidation[key].data?.coverage_valid === true
  );
  if (!coreReady || !state.rooftopEnabled) return coreReady;
  return state.rooftopTrajectoryValidation.status === 'valid' &&
    state.rooftopTrajectoryValidation.data?.coverage_valid === true;
}

function solarWindowValidation() {
  const step = 1440 / (state.periodsPerDay || DEFAULT_PERIODS);
  if (state.solarInputError) return state.solarInputError;
  if (!(0 <= state.solarStartMinutes && state.solarStartMinutes < state.solarEndMinutes && state.solarEndMinutes <= 1440)) {
    return 'Use a same-day solar window with the start before the end.';
  }
  if (state.solarStartMinutes % step || state.solarEndMinutes % step) {
    return `Boundaries must align to ${step}-minute intervals.`;
  }
  if (state.solarEndMinutes - state.solarStartMinutes >= 1440) {
    return 'Solar and non-solar periods must each contain at least one interval.';
  }
  return '';
}
function intervalRange(period, periodsPerDay) {
  const minutesPerPeriod = 1440 / periodsPerDay;
  const format = minutes => {
    if (minutes === 1440) return '24:00';
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
  };
  return `${format((period - 1) * minutesPerPeriod)}–${format(period * minutesPerPeriod)}`;
}
function parsedFinancialYears() {
  const values = Object.fromEntries(
    Object.entries(FINANCIAL_YEAR_FIELDS).map(([key, { inputId }]) => [
      key,
      parseFinancialYear(document.getElementById(inputId)?.value),
    ])
  );
  return {
    ...values,
    valid: Object.values(values).every(value => value.valid),
  };
}
function validateFinancialYearFields() {
  let valid = true;
  financialYearBindings.forEach(binding => {
    valid = binding.validate(false).valid && valid;
  });
  const values = parsedFinancialYears();
  return valid && values.valid ? values : null;
}

// ── Step navigation ──────────────────────────────────────────
function goNext() {
  if (state.step === 1 && !allFilesLoaded()) return;
  if (state.step === 2) {
    const financialYears = validateFinancialYearFields();
    if (!state.outputFolder || !financialYears || !allFilesLoaded() || !contextualFilesReady() || solarWindowValidation()) return;
  }
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
  if (n === 3 && allFilesLoaded() && contextualFilesReady() && !solarWindowValidation() && state.outputFolder && validateFinancialYearFields()) {
    state.step = 3; render();
  }
}

// ── Master render ────────────────────────────────────────────
function render() {
  renderPill();
  renderSteps();
  renderFileTiles();
  renderRooftopControls();
  renderCoverageValidation();
  renderSolarWindow();
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
  ['base', 'peak', 'energy', 'rooftopTrajectory', 'rooftopProfile'].forEach(key => {
    const tile   = document.getElementById(`tile-${key}`);
    const name   = document.getElementById(`name-${key}`);
    const badge  = document.getElementById(`badge-${key}`);
    const action = document.getElementById(`action-${key}`);
    const f = state.files[key];
    const validation = ['base','peak','energy'].includes(key)
      ? state.coreValidation[key]
      : (key === 'rooftopProfile' ? state.rooftopProfileValidation : state.rooftopTrajectoryValidation);
    const valid = !!f && validation.status === 'valid';
    tile.dataset.loaded   = valid ? 'true' : 'false';
    badge.textContent     = valid ? '✓' : ({ rooftopTrajectory:'T', rooftopProfile:'R' }[key] || key[0].toUpperCase());
    name.textContent      = f ? f.name : 'Drag & drop or click to browse';
    action.textContent    = f ? 'Replace' : 'CSV / XLSX';
  });
  ['base','peak','energy'].forEach(key => {
    const element = document.getElementById(`${key}-validation`);
    const validation = state.coreValidation[key];
    if (!element) return;
    element.className = `file-validation ${validation.status === 'valid' ? 'valid' : (validation.status === 'error' ? 'error' : '')}`;
    element.textContent = validation.message;
  });
}

function renderRooftopControls() {
  const controls = document.getElementById('rooftop-controls');
  const toggle = document.getElementById('rooftop-toggle');
  const profileValidation = document.getElementById('rooftop-profile-validation');
  const trajectoryValidation = document.getElementById('rooftop-trajectory-validation');
  if (!controls || !toggle || !profileValidation || !trajectoryValidation) return;
  controls.hidden = !state.rooftopEnabled;
  toggle.checked = state.rooftopEnabled;
  [
    [profileValidation, state.rooftopProfileValidation],
    [trajectoryValidation, state.rooftopTrajectoryValidation],
  ].forEach(([element, validation]) => {
    const status = validation.status;
    element.className = `rooftop-validation ${status === 'valid' ? 'valid' : (status === 'error' ? 'error' : '')}`;
    element.textContent = validation.message;
  });
}

function renderCoverageValidation() {
  const element = document.getElementById('coverage-validation');
  if (!element) return;
  const validationData = ['base','peak','energy'].map(key => state.coreValidation[key]);
  if (state.rooftopEnabled) validationData.push(state.rooftopTrajectoryValidation);
  if (!validationData.every(validation => validation.status === 'valid')) {
    element.className = 'coverage-validation';
    element.textContent = '';
    return;
  }
  const pending = validationData.some(validation => validation.data?.coverage_valid == null);
  if (pending) {
    element.className = 'coverage-validation';
    element.textContent = 'Validating input coverage…';
    return;
  }
  const errors = validationData
    .map(validation => validation.data?.coverage_error)
    .filter(Boolean);
  element.className = `coverage-validation ${errors.length ? 'error' : 'valid'}`;
  element.textContent = errors.length
    ? `⚠ ${errors.join(' ')}`
    : '✓ Input files cover the configured base year and projection span.';
}

function formatMinutes(total) {
  if (total === 1440) return '24:00';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
}

function parseTimeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours === 24 && minutes === 0) return 1440;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function renderSolarWindow() {
  const startRange = document.getElementById('solar-start-range');
  const endRange = document.getElementById('solar-end-range');
  const startField = document.getElementById('solar-start-time');
  const endField = document.getElementById('solar-end-time');
  const band = document.getElementById('solar-active-band');
  const summary = document.getElementById('solar-window-summary');
  const error = document.getElementById('solar-window-error');
  if (!startRange || !endRange || !startField || !endField || !band || !summary || !error) return;
  const step = 1440 / (state.periodsPerDay || DEFAULT_PERIODS);
  startRange.step = String(step);
  endRange.step = String(step);
  startRange.value = String(state.solarStartMinutes);
  endRange.value = String(state.solarEndMinutes);
  startField.value = formatMinutes(state.solarStartMinutes);
  endField.value = formatMinutes(state.solarEndMinutes);
  band.style.left = `${state.solarStartMinutes / 1440 * 100}%`;
  band.style.width = `${(state.solarEndMinutes - state.solarStartMinutes) / 1440 * 100}%`;
  summary.textContent = `☀ Solar: ${formatMinutes(state.solarStartMinutes)}–${formatMinutes(state.solarEndMinutes)} · ☾ Non-solar: ${formatMinutes(state.solarEndMinutes)}–24:00 and 00:00–${formatMinutes(state.solarStartMinutes)} · ${step}-minute steps`;
  error.textContent = solarWindowValidation();
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
  if (c2) c2.disabled = !state.outputFolder || !parsedFinancialYears().valid || !allFilesLoaded() || !contextualFilesReady() || !!solarWindowValidation();
  if (b3) b3.disabled = state.generating;
}

function renderReview() {
  const container = document.getElementById('review-rows');
  if (!container) return;
  const financialYears = parsedFinancialYears();
  const profile   = document.getElementById('f-profile')?.value    || 'profile';
  const inputCount = state.rooftopEnabled ? '5 of 5 files ready' : '3 of 3 files ready';
  const outputName = state.rooftopEnabled ? `${profile}_rooftop_adjusted.csv` : `${profile}_projected.csv`;
  const rows = [
    { label: 'Input files',  value: inputCount, style: 'font:700 13px Manrope,sans-serif;color:#0e8f80;' },
    ...(state.rooftopEnabled ? [{ label: 'Scenario', value: `Rooftop adjustment · ${state.rooftopMode}`, style: 'font:700 13px Manrope,sans-serif;color:#b6790a;' }] : []),
    { label: 'Base financial year', value: financialYears.base.label, style: 'font:600 13px Manrope,sans-serif;color:#13203a;' },
    { label: 'Projection', value: `${financialYears.start.label} → ${financialYears.end.label} · ${Math.max(0, financialYears.end.startYear - financialYears.start.startYear + 1)} yrs`, style: 'font:600 13px Manrope,sans-serif;color:#13203a;' },
    { label: 'Solar period', value: `${formatMinutes(state.solarStartMinutes)} → ${formatMinutes(state.solarEndMinutes)}`, style: 'font:700 13px Manrope,sans-serif;color:#b6790a;' },
    { label: 'Output file',  value: outputName, style: "font:600 12.5px 'JetBrains Mono',monospace;color:#42536e;" },
  ];
  container.innerHTML = rows.map(r =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid rgba(120,140,170,0.14);">
       <span style="font:600 13px 'Manrope',sans-serif;color:#5a6a86;">${r.label}</span>
       <span style="${r.style}">${r.value}</span>
     </div>`
  ).join('');
}

// ── File handling ────────────────────────────────────────────
function acceptFile(key, file) {
  state.files[key] = { name: file.name, file };
  if (['base','peak','energy'].includes(key)) validateCoreFile(key);
  if (key === 'rooftopProfile') validateRooftopProfile();
  if (key === 'rooftopTrajectory') validateRooftopTrajectory();
  render();
}

function consumeSelectedFile(input) {
  const file = input.files && input.files[0] ? input.files[0] : null;
  if (file) input.value = '';
  return file;
}

function setupFileTiles() {
  ['base', 'peak', 'energy', 'rooftopTrajectory', 'rooftopProfile'].forEach(key => {
    const tile  = document.getElementById(`tile-${key}`);
    const input = document.getElementById(`input-${key}`);
    input.addEventListener('change', () => {
      const file = consumeSelectedFile(input);
      if (file) acceptFile(key, file);
    });
    tile.addEventListener('dragover',  e => { e.preventDefault(); tile.dataset.dragging = 'true'; });
    tile.addEventListener('dragleave', e => { e.preventDefault(); tile.dataset.dragging = 'false'; });
    tile.addEventListener('drop',      e => {
      e.preventDefault(); tile.dataset.dragging = 'false';
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) acceptFile(key, f);
    });
  });
}

async function validateCoreFile(key) {
  const uploaded = state.files[key];
  if (!uploaded) return;
  const financialYears = parsedFinancialYears();
  if (!financialYears.valid) {
    state.coreValidation[key] = {
      status:'validating',
      message:'Waiting for valid financial-year settings…',
      data:null,
    };
    render();
    return;
  }
  const validationToken = ++state.coreValidationTokens[key];
  state.coreValidation[key] = { status:'validating', message:'Validating file…', data:null };
  render();
  const fd = new FormData();
  let endpoint;
  if (key === 'base') {
    endpoint = '/validate-base-profile';
    fd.append('base_profile', uploaded.file);
    fd.append('base_financial_year', financialYears.base.startYear);
  } else {
    endpoint = '/validate-target-file';
    fd.append(`${key}_projection`, uploaded.file);
    fd.append('target_kind', key);
    fd.append('projection_start_year', financialYears.start.startYear);
    fd.append('projection_end_year', financialYears.end.startYear);
    fd.append('profile_name', document.getElementById('f-profile')?.value || '');
  }
  try {
    const response = await fetch(endpoint, { method:'POST', body:fd });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Input validation failed.');
    if (validationToken !== state.coreValidationTokens[key]) return;
    const message = key === 'base'
      ? `✓ ${nf(data.row_count)} rows · ${data.periods_per_day} periods/day · value: ${data.value_column}`
      : `✓ ${nf(data.row_count)} targets · ${data.first_year}–${data.last_year} · value: ${data.value_column}`;
    state.coreValidation[key] = { status:'valid', message, data };
    if (key === 'base') state.periodsPerDay = Number(data.periods_per_day) || DEFAULT_PERIODS;
  } catch (error) {
    if (validationToken !== state.coreValidationTokens[key]) return;
    state.coreValidation[key] = { status:'error', message:`⚠ ${error.message}`, data:null };
  }
  render();
}

function revalidateCoreCoverage() {
  ['base','peak','energy'].forEach(key => {
    if (state.files[key]) validateCoreFile(key);
  });
}

async function validateRooftopProfile() {
  const uploaded = state.files.rooftopProfile;
  if (!uploaded) return;
  const validationToken = ++state.rooftopValidationToken;
  state.rooftopProfileValidation = { status:'validating', message:'Validating profile…', data:null };
  render();
  const fd = new FormData();
  fd.append('rooftop_profile', uploaded.file);
  fd.append('rooftop_profile_mode', state.rooftopMode);
  try {
    const response = await fetch('/validate-rooftop-profile', { method:'POST', body:fd });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Profile validation failed.');
    if (validationToken !== state.rooftopValidationToken) return;
    state.rooftopProfileValidation = {
      status:'valid',
      message:`✓ ${nf(data.row_count)} rows · ${data.periods_per_day} periods/day · Profile CUF ${nf(data.template_cuf_percent, 2)}%`,
      data,
    };
  } catch (error) {
    if (validationToken !== state.rooftopValidationToken) return;
    state.rooftopProfileValidation = { status:'error', message:`⚠ ${error.message}`, data:null };
  }
  render();
}

async function validateRooftopTrajectory() {
  const uploaded = state.files.rooftopTrajectory;
  if (!uploaded) return;
  const financialYears = parsedFinancialYears();
  if (!financialYears.valid) {
    ++state.rooftopTrajectoryValidationToken;
    state.rooftopTrajectoryValidation = {
      status:'pending',
      message:'Complete the financial-year fields to validate trajectory coverage.',
      data:null,
    };
    render();
    return;
  }
  const signature = `${financialYears.base.startYear}:${financialYears.start.startYear}:${financialYears.end.startYear}`;
  if (
    ['valid', 'validating'].includes(state.rooftopTrajectoryValidation.status) &&
    state.rooftopTrajectoryValidation.data?.signature === signature
  ) return;
  const validationToken = ++state.rooftopTrajectoryValidationToken;
  state.rooftopTrajectoryValidation = {
    status:'validating',
    message:'Validating trajectory…',
    data:{ signature },
  };
  render();
  const fd = new FormData();
  fd.append('rooftop_trajectory', uploaded.file);
  fd.append('base_financial_year', financialYears.base.startYear);
  fd.append('projection_start_year', financialYears.start.startYear);
  fd.append('projection_end_year', financialYears.end.startYear);
  try {
    const response = await fetch('/validate-rooftop-trajectory', { method:'POST', body:fd });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Trajectory validation failed.');
    if (validationToken !== state.rooftopTrajectoryValidationToken) return;
    state.rooftopTrajectoryValidation = {
      status:'valid',
      message:`✓ ${nf(data.milestone_count)} milestones · ${data.first_year}–${data.last_year} · final ${nf(data.final_capacity_mw)} MW`,
      data:{ ...data, signature },
    };
  } catch (error) {
    if (validationToken !== state.rooftopTrajectoryValidationToken) return;
    state.rooftopTrajectoryValidation = {
      status:'error',
      message:`⚠ ${error.message}`,
      data:{ signature },
    };
  }
  render();
}

function setupRooftopControls() {
  const toggle = document.getElementById('rooftop-toggle');
  const mode = document.getElementById('rooftop-mode');
  toggle.addEventListener('change', () => {
    state.rooftopEnabled = toggle.checked;
    render();
  });
  mode.addEventListener('change', () => {
    state.rooftopMode = mode.value;
    if (state.files.rooftopProfile) validateRooftopProfile();
    else render();
  });
}

function setupFinancialYearInputs() {
  Object.values(FINANCIAL_YEAR_FIELDS).forEach(({ inputId, errorId }) => {
    const input = document.getElementById(inputId);
    const error = document.getElementById(errorId);
    const binding = bindFinancialYearInput(input, error, () => {
      renderButtons();
      revalidateCoreCoverage();
      if (state.files.rooftopTrajectory) validateRooftopTrajectory();
    });
    financialYearBindings.set(inputId, binding);
  });
  document.getElementById('f-profile')?.addEventListener('change', () => {
    ['peak','energy'].forEach(key => {
      if (state.files[key]) validateCoreFile(key);
    });
  });
}

function setupSolarWindowControls() {
  const startRange = document.getElementById('solar-start-range');
  const endRange = document.getElementById('solar-end-range');
  const startField = document.getElementById('solar-start-time');
  const endField = document.getElementById('solar-end-time');
  const setBoundary = (kind, minutes) => {
    const step = 1440 / (state.periodsPerDay || DEFAULT_PERIODS);
    const other = kind === 'start' ? state.solarEndMinutes : state.solarStartMinutes;
    const validOrder = kind === 'start' ? minutes <= other - step : minutes >= other + step;
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440 || minutes % step || !validOrder) {
      state.solarInputError = `Enter interval-aligned times with at least one ${step}-minute interval in each period.`;
      renderSolarWindow();
      renderButtons();
      return;
    }
    state.solarInputError = '';
    if (kind === 'start') state.solarStartMinutes = minutes;
    else state.solarEndMinutes = minutes;
    renderSolarWindow();
    renderButtons();
  };
  startRange.addEventListener('input', () => setBoundary('start', Number(startRange.value)));
  endRange.addEventListener('input', () => setBoundary('end', Number(endRange.value)));
  startField.addEventListener('change', () => setBoundary('start', parseTimeMinutes(startField.value)));
  endField.addEventListener('change', () => setBoundary('end', parseTimeMinutes(endField.value)));
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
  const financialYears = validateFinancialYearFields();
  if (!financialYears || !contextualFilesReady() || solarWindowValidation()) return;
  const basePeriod = basePeriodForStartYear(financialYears.base.startYear);
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
    fd.append('base_start_date',      basePeriod.startDate);
    fd.append('base_end_date',        basePeriod.endDate);
    fd.append('projection_start_year',financialYears.start.startYear);
    fd.append('projection_end_year',  financialYears.end.startYear);
    fd.append('profile_name',         document.getElementById('f-profile').value);
    fd.append('output_folder',        state.outputFolder);
    fd.append('rooftop_enabled',      String(state.rooftopEnabled));
    fd.append('solar_start_minutes',  state.solarStartMinutes);
    fd.append('solar_end_minutes',    state.solarEndMinutes);
    if (state.rooftopEnabled) {
      fd.append('rooftop_profile_mode', state.rooftopMode);
      fd.append('rooftop_profile', state.files.rooftopProfile.file);
      fd.append('rooftop_trajectory', state.files.rooftopTrajectory.file);
    }

    // Animate progress while fetch is in flight
    let p = 5;
    const stages = state.rooftopEnabled
      ? [[0,'Uploading files…'],[18,'Reading demand and rooftop inputs…'],[42,'Mapping demand and solar profiles…'],[67,'Interpolating rooftop capacity…'],[84,'Adjusting grid demand…'],[91,'Writing rooftop-adjusted CSV…']]
      : [[0,'Uploading files…'],[20,'Reading base profile…'],[45,'Mapping daily profile…'],[70,'Scaling to peak & energy targets…'],[88,'Writing projected CSV…']];
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
    state.summaryPeriod = 'solar';
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
  state.lastResults = data;
  document.getElementById('output-path-text').textContent = data.output_path;

  const sums  = data.summaries || [];
  const first = sums[0]  || {};
  const last  = sums[sums.length - 1] || {};
  const fyOf  = s => s.financial_year || s.projection_year || '';
  const rooftop = !!first.rooftop_enabled;

  // Metrics
  const metricData = rooftop ? [
    { label: 'Projection span', value: sums.length ? `${fyOf(first)} → ${fyOf(last)}` : '—' },
    { label: 'Profile CUF', value: `${nf(first.rooftop_template_cuf_percent, 2)}%` },
    { label: 'Output file', value: shortPath(data.output_path) },
  ] : [
    { label: 'Rows written', value: nf(data.rows_written) },
    { label: 'Projection span', value: sums.length ? `${fyOf(first)} → ${fyOf(last)}` : '—' },
    { label: 'Periods / day', value: String(first.periods_per_day || DEFAULT_PERIODS) },
    { label: 'Output file', value: shortPath(data.output_path) },
  ];
  document.getElementById('metrics-grid').innerHTML = metricData.map(m =>
    `<div class="metric-tile">
       <div class="metric-label">${m.label}</div>
       <div class="metric-value${m.negative ? ' negative-value' : ''}">${m.value}</div>
     </div>`
  ).join('');

  // Summary table
  const periodViews = {
    solar: {
      label:'Solar period', peak:'solar_peak_mw', date:'solar_peak_date', period:'solar_peak_period',
      growth:'solar_peak_growth_percent', beforePeak:'before_rooftop_solar_peak_mw',
      beforeDate:'before_rooftop_solar_peak_date', beforePeriod:'before_rooftop_solar_peak_period',
      reduction:'solar_peak_reduction_mw', reductionPercent:'solar_peak_reduction_percent',
    },
    non_solar: {
      label:'Non-solar period', peak:'non_solar_peak_mw', date:'non_solar_peak_date', period:'non_solar_peak_period',
      growth:'non_solar_peak_growth_percent', beforePeak:'before_rooftop_non_solar_peak_mw',
      beforeDate:'before_rooftop_non_solar_peak_date', beforePeriod:'before_rooftop_non_solar_peak_period',
      reduction:'non_solar_peak_reduction_mw', reductionPercent:'non_solar_peak_reduction_percent',
    },
  };
  const solar = state.summaryPeriod === 'solar';
  const periodView = periodViews[state.summaryPeriod];
  const classLabel = periodView.label;
  const finalPeakKey = periodView.peak;
  const finalDateKey = periodView.date;
  const finalPeriodKey = periodView.period;
  const growthKey = periodView.growth;
  const beforePeakKey = periodView.beforePeak;
  const beforeDateKey = periodView.beforeDate;
  const beforePeriodKey = periodView.beforePeriod;
  const reductionKey = periodView.reduction;
  const reductionPercentKey = periodView.reductionPercent;
  document.getElementById('period-toggle-solar')?.setAttribute('aria-pressed', String(solar));
  document.getElementById('period-toggle-non-solar')?.setAttribute('aria-pressed', String(!solar));
  const peakTitle = document.getElementById('summary-peak-title');
  const secondarySection = document.getElementById('summary-secondary-section');
  if (rooftop) {
    peakTitle.hidden = false;
    secondarySection.hidden = false;
    document.getElementById('summary-head').innerHTML = `
      <tr class="summary-group-row">
        <th class="summary-fy" rowspan="2">FY</th>
        <th rowspan="2" title="Cumulative rooftop capacity at the end of the financial year">Rooftop capacity</th>
        <th colspan="2">Overall peak</th>
        <th colspan="5">Peak during ${classLabel.toLowerCase()}</th>
      </tr>
      <tr>
        <th>Unadjusted</th><th>Adjusted</th>
        <th>Unadjusted peak</th><th>Unadjusted timing</th>
        <th>Adjusted peak</th><th>Adjusted timing</th><th>Reduction</th>
      </tr>`;
    document.getElementById('summary-tbody').innerHTML = sums.map(s => {
      return `<tr>
        <td class="summary-fy" data-label="FY">${fyOf(s)}</td>
        <td data-label="Rooftop capacity">${nf(s.rooftop_year_end_capacity_mw)} MW</td>
        <td data-label="Overall peak — Unadjusted demand">${nf(s.before_rooftop_peak_mw)} MW</td>
        <td data-label="Overall peak — Adjusted demand">${nf(s.achieved_peak_mw)} MW</td>
        <td data-label="${classLabel} — Unadjusted peak">${nf(s[beforePeakKey])} MW</td>
        <td data-label="${classLabel} — Unadjusted timing">${formatPeakIntervalCell(s[beforeDateKey], s[beforePeriodKey], s.periods_per_day)}</td>
        <td data-label="${classLabel} — Adjusted peak" class="${Number(s[finalPeakKey]) < 0 ? 'negative-value' : ''}">${nf(s[finalPeakKey])} MW</td>
        <td data-label="${classLabel} — Adjusted timing">${formatPeakIntervalCell(s[finalDateKey], s[finalPeriodKey], s.periods_per_day)}</td>
        <td data-label="${classLabel} — Peak reduction"><span class="peak-reduction-line"><span class="peak-reduction-value">${nf(s[reductionKey])} MW</span><span class="peak-reduction-percent">(${nf(s[reductionPercentKey], 2)}%)</span></span></td>
      </tr>`;
    }).join('');
    document.getElementById('summary-energy-head').innerHTML = `<tr>
      <th class="summary-fy">FY</th><th>Unadjusted energy</th><th>Adjusted energy</th>
      <th>Rooftop generation</th><th>Minimum demand</th><th>Projected CUF</th>
    </tr>`;
    document.getElementById('summary-energy-tbody').innerHTML = sums.map(s => {
      const negative = Number(s.adjusted_minimum_mw) < 0;
      return `<tr>
        <td class="summary-fy" data-label="FY">${fyOf(s)}</td>
        <td data-label="Unadjusted energy">${nf(s.before_rooftop_energy_gwh)} GWh</td>
        <td data-label="Adjusted energy">${nf(s.achieved_energy_gwh)} GWh</td>
        <td data-label="Rooftop generation">${nf(s.rooftop_generation_gwh)} GWh</td>
        <td data-label="Minimum demand" class="${negative ? 'negative-value' : ''}">${nf(s.adjusted_minimum_mw)} MW</td>
        <td data-label="Projected CUF">${s.rooftop_effective_cuf_percent == null ? 'N/A' : `${nf(s.rooftop_effective_cuf_percent, 2)}%`}</td>
      </tr>`;
    }).join('');
  } else {
    peakTitle.hidden = true;
    secondarySection.hidden = true;
    document.getElementById('summary-head').innerHTML = `<tr>
      <th class="summary-fy">FY</th><th>Rows</th><th>Overall peak</th><th>Peak during ${classLabel.toLowerCase()}</th><th>${classLabel} timing</th><th>Energy</th><th>${classLabel} peak YoY</th><th>Energy YoY</th>
    </tr>`;
    document.getElementById('summary-tbody').innerHTML = sums.map(s =>
      `<tr>
        <td class="summary-fy" data-label="FY">${fyOf(s)}</td>
        <td data-label="Rows">${nf(s.row_count)}</td>
        <td data-label="Overall peak">${nf(s.achieved_peak_mw)} MW</td>
        <td data-label="${classLabel} peak">${nf(s[finalPeakKey])} MW</td>
        <td data-label="${classLabel} timing">${formatPeakIntervalCell(s[finalDateKey], s[finalPeriodKey], s.periods_per_day)}</td>
        <td data-label="Energy">${nf(s.achieved_energy_gwh)} GWh</td>
        <td data-label="${classLabel} peak YoY" class="growth">${fmtPct(s[growthKey], 2)}</td>
        <td data-label="Energy YoY" class="growth">${fmtPct(s.energy_growth_percent, 2)}</td>
      </tr>`
    ).join('');
  }
  requestAnimationFrame(updateSummaryScrollHint);
}

function setSummaryPeriod(period) {
  if (!['solar','non_solar'].includes(period) || state.summaryPeriod === period) return;
  state.summaryPeriod = period;
  if (state.lastResults) populateResults(state.lastResults);
}

function updateSummaryScrollHint() {
  document.querySelectorAll('.summary-table-section').forEach(section => {
    const hint = section.querySelector('.summary-scroll-hint');
    const scroller = section.querySelector('.summary-table-scroll');
    if (!hint || !scroller) return;
    hint.hidden = window.matchMedia('(max-width: 700px)').matches ||
      scroller.scrollWidth <= scroller.clientWidth + 1;
  });
}

function formatPeakInterval(isoDate, period, periodsPerDay) {
  if (!isoDate || !period) return '—';
  const date = new Date(`${isoDate}T00:00:00`);
  const dateLabel = `${String(date.getDate()).padStart(2,'0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return `${dateLabel}, ${intervalRange(Number(period), Number(periodsPerDay))}`;
}

function formatPeakIntervalCell(isoDate, period, periodsPerDay) {
  const formatted = formatPeakInterval(isoDate, period, periodsPerDay);
  if (formatted === '—') return formatted;
  const separator = formatted.indexOf(', ');
  return `<span class="summary-timing"><span>${formatted.slice(0, separator)}</span><span class="summary-timing-time">${formatted.slice(separator + 2)}</span></span>`;
}

function copyOutputPath() {
  try { navigator.clipboard.writeText(state.outputPath); } catch (e) {}
}

function newRun() {
  state.hasResults = false; state.step = 1; state.generating = false;
  state.summaryPeriod = 'solar'; state.lastResults = null;
  hoverPos = null; viewMin = 0; viewMax = 1;
  document.getElementById('progress-area').hidden     = true;
  document.getElementById('generate-btn-area').hidden = false;
  setProgress(0, '');
  render();
}

// ── Chart setup ──────────────────────────────────────────────
function setupChart(graph) {
  const rooftop = !!graph.rooftop_enabled;
  state.selYear = 0;
  chartYears = (graph.years || []).map(y => ({
    year:         y.year,
    label:        y.label,
    startDate:    y.start_date,
    periodsPerDay: y.periods_per_day || DEFAULT_PERIODS,
    rooftop,
    base:         rooftop ? y.before_rooftop.points : y.mapped_base.points,
    projected:    rooftop ? y.adjusted.points : y.projected.points,
    rooftopGeneration: rooftop ? y.rooftop_generation.points : null,
  }));
  document.getElementById('chart-title').textContent = rooftop ? 'Rooftop-adjusted demand profile' : 'Normalized profile view';
  document.getElementById('chart-legend').innerHTML = rooftop
    ? `<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:18px;height:0;border-top:2px dashed #56637a;display:inline-block;"></span>Unadjusted demand</span>
       <span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:18px;height:2px;background:#111827;display:inline-block;border-radius:2px;"></span>Adjusted demand</span>
       <span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:18px;height:8px;background:rgba(245,190,36,.55);display:inline-block;border-radius:2px;"></span>Rooftop generation</span>`
    : `<span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:18px;height:0;border-top:2px dashed #1b2740;display:inline-block;"></span>Mapped base</span>
       <span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:18px;height:2px;background:#3b6ef6;display:inline-block;border-radius:2px;"></span>Projected</span>`;
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
function buildScreenPts(pts, pl, yOf) {
  const n = pts.length, span = spanV();
  const i0 = Math.max(0, Math.floor(viewMin * (n - 1)));
  const i1 = Math.min(n - 1, Math.ceil(viewMax * (n - 1)));
  const xOf = idx => pl.left + (((idx / (n - 1)) - viewMin) / span) * pl.w;
  const arr = [];
  if ((i1 - i0 + 1) <= pl.w * 1.5) {
    for (let i = i0; i <= i1; i++) arr.push([xOf(i), yOf(pts[i])]);
  } else {
    const px = Math.max(2, Math.floor(pl.w));
    for (let p = 0; p <= px; p++) {
      const a = Math.max(0, Math.floor((viewMin + span * (p / px)) * (n - 1)));
      const b = Math.min(n - 1, Math.max(a, Math.ceil((viewMin + span * ((p + 1) / px)) * (n - 1))));
      let mn = pts[a], mx = pts[a];
      for (let k = a + 1; k <= b; k++) { if (pts[k] < mn) mn = pts[k]; if (pts[k] > mx) mx = pts[k]; }
      const x = pl.left + (p / px) * pl.w;
      arr.push([x, yOf(mx)]);
      arr.push([x, yOf(mn)]);
    }
  }
  return arr;
}

function buildTopEnvelope(pts, pl, yOf) {
  const n = pts.length, span = spanV();
  const px = Math.max(2, Math.floor(pl.w));
  const arr = [];
  for (let p = 0; p <= px; p++) {
    const a = Math.max(0, Math.floor((viewMin + span * (p / px)) * (n - 1)));
    const b = Math.min(n - 1, Math.max(a, Math.ceil((viewMin + span * ((p + 1) / px)) * (n - 1))));
    let mx = pts[a];
    for (let k = a + 1; k <= b; k++) { if (pts[k] > mx) mx = pts[k]; }
    arr.push([pl.left + (p / px) * pl.w, yOf(mx)]);
  }
  return arr;
}

function buildTimeGridTicks(yr, min = 0, max = 1) {
  const n = yr?.base?.length || 0;
  const periodsPerDay = Number(yr?.periodsPerDay);
  if (n < 2 || !periodsPerDay || !yr?.startDate) return [];

  const safeMin = Math.max(0, Math.min(1, Number(min)));
  const safeMax = Math.max(safeMin, Math.min(1, Number(max)));
  const firstIndex = Math.max(0, Math.floor(safeMin * (n - 1)));
  const lastIndex = Math.min(n - 1, Math.ceil(safeMax * (n - 1)));
  const firstDay = Math.max(0, Math.floor(firstIndex / periodsPerDay));
  const lastDay = Math.min(Math.ceil(n / periodsPerDay) - 1, Math.floor(lastIndex / periodsPerDay));
  const visibleDays = Math.max(1, (lastIndex - firstIndex + 1) / periodsPerDay);
  const startDate = new Date(`${yr.startDate}T00:00:00`);
  const ticks = [];

  const dateForDay = dayOffset => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + dayOffset);
    return date;
  };
  const dayLabel = date => `${String(date.getDate()).padStart(2,'0')} ${MONTHS[date.getMonth()]}`;
  const addTick = (dayOffset, periodOffset, kind, label = '') => {
    const index = dayOffset * periodsPerDay + periodOffset;
    if (index < 0 || index > n - 1) return;
    const pos = index / (n - 1);
    if (pos < safeMin - 1e-9 || pos > safeMax + 1e-9) return;
    ticks.push({ pos, kind, label });
  };

  if (visibleDays <= 3) {
    const quarterDay = periodsPerDay / 4;
    for (let day = firstDay; day <= lastDay; day++) {
      const date = dateForDay(day);
      for (let quarter = 0; quarter < 4; quarter++) {
        const periodOffset = quarter * quarterDay;
        addTick(day, periodOffset, quarter === 0 ? (date.getDate() === 1 ? 'month' : 'day') : 'hour',
          quarter === 0 ? dayLabel(date) : formatMinutes(periodOffset * 1440 / periodsPerDay));
      }
    }
  } else if (visibleDays <= 31) {
    const labelEvery = visibleDays <= 10 ? 1 : (visibleDays <= 20 ? 2 : 5);
    for (let day = firstDay; day <= lastDay; day++) {
      const date = dateForDay(day);
      const monthBoundary = date.getDate() === 1;
      const label = monthBoundary || (day - firstDay) % labelEvery === 0 ? dayLabel(date) : '';
      addTick(day, 0, monthBoundary ? 'month' : 'day', label);
    }
  } else if (visibleDays <= 120) {
    for (let day = firstDay; day <= lastDay; day++) {
      const date = dateForDay(day);
      if (date.getDate() === 1) addTick(day, 0, 'month', dayLabel(date));
      else if (date.getDay() === 1) addTick(day, 0, 'week', dayLabel(date));
    }
  } else {
    for (let day = firstDay; day <= lastDay; day++) {
      const date = dateForDay(day);
      if (date.getDate() === 1) addTick(day, 0, 'month', MONTHS[date.getMonth()]);
    }
  }
  return ticks;
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
  const pl = { left:yr.rooftop ? 68 : 42, right:w-14, top:14, bottom:h-28 };
  pl.w = pl.right - pl.left; pl.h = pl.bottom - pl.top;
  plot = pl;

  const sp = spanV();
  let yMin = 0, yMax = 1;
  if (yr.rooftop) {
    yMin = 0; yMax = 0;
    [yr.base, yr.projected, yr.rooftopGeneration || []].forEach(series => {
      series.forEach(value => { if (value < yMin) yMin = value; if (value > yMax) yMax = value; });
    });
  }
  if (yMax === yMin) yMax = yMin + 1;
  const pad = yr.rooftop ? (yMax - yMin) * 0.05 : 0;
  yMin -= pad; yMax += pad;
  const yOf = value => pl.bottom - ((value - yMin) / (yMax - yMin)) * pl.h;

  ctx.font = "11px 'JetBrains Mono', monospace";
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const y = pl.top + pl.h * i / 4;
    ctx.strokeStyle = 'rgba(90,110,140,0.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pl.left, y); ctx.lineTo(pl.right, y); ctx.stroke();
    ctx.fillStyle = 'rgba(90,106,134,0.85)';
    const tickValue = yMax - (yMax - yMin) * i / 4;
    ctx.fillText(yr.rooftop ? nf(tickValue) : tickValue.toFixed(2), pl.left - 8, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const gridStyles = {
    month: { stroke:'rgba(73,91,120,0.25)', width:1.4 },
    week:  { stroke:'rgba(90,110,140,0.13)', width:1 },
    day:   { stroke:'rgba(90,110,140,0.18)', width:1.1 },
    hour:  { stroke:'rgba(90,110,140,0.08)', width:1 },
  };
  buildTimeGridTicks(yr, viewMin, viewMax).forEach(tick => {
    const x = pl.left + ((tick.pos - viewMin) / sp) * pl.w;
    const style = gridStyles[tick.kind];
    ctx.strokeStyle = style.stroke; ctx.lineWidth = style.width;
    ctx.beginPath(); ctx.moveTo(x, pl.top); ctx.lineTo(x, pl.bottom); ctx.stroke();
    if (tick.label) {
      ctx.fillStyle = tick.kind === 'month' ? 'rgba(66,83,110,0.94)' : 'rgba(90,106,134,0.85)';
      ctx.fillText(tick.label, x, pl.bottom + 8);
    }
  });

  ctx.save();
  ctx.beginPath(); ctx.rect(pl.left, pl.top, pl.w, pl.h); ctx.clip();

  const fillSeries = yr.rooftop ? yr.rooftopGeneration : yr.projected;
  const fillTop = buildTopEnvelope(fillSeries, pl, yOf);
  if (fillTop.length) {
    const grad = ctx.createLinearGradient(0, pl.top, 0, pl.bottom);
    grad.addColorStop(0, yr.rooftop ? 'rgba(245,190,36,0.58)' : 'rgba(59,110,246,0.20)');
    grad.addColorStop(1, yr.rooftop ? 'rgba(245,190,36,0.12)' : 'rgba(59,110,246,0.0)');
    const baselineY = yr.rooftop ? yOf(0) : pl.bottom;
    ctx.beginPath(); ctx.moveTo(fillTop[0][0], fillTop[0][1]);
    for (let k = 1; k < fillTop.length; k++) ctx.lineTo(fillTop[k][0], fillTop[k][1]);
    ctx.lineTo(fillTop[fillTop.length - 1][0], baselineY);
    ctx.lineTo(fillTop[0][0], baselineY);
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
  strokePts(buildScreenPts(yr.base, pl, yOf), yr.rooftop ? '#56637a' : '#1b2740', [7,5], yr.rooftop ? 0.8 : 0.5, 1.6);
  strokePts(buildScreenPts(yr.projected, pl, yOf), yr.rooftop ? '#111827' : ACCENT, [], 0.95, 2.2);

  // Hover crosshair + dots
  if (hoverPos != null) {
    const n = yr.base.length;
    const x = pl.left + ((hoverPos - viewMin) / sp) * pl.w;
    if (x >= pl.left && x <= pl.right) {
      const i = Math.max(0, Math.min(n - 1, Math.round(hoverPos * (n - 1))));
      ctx.strokeStyle = 'rgba(27,39,64,0.26)'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(x, pl.top); ctx.lineTo(x, pl.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#56637a'; ctx.beginPath(); ctx.arc(x, yOf(yr.base[i]), 3.2, 0, 7); ctx.fill();
      ctx.fillStyle = yr.rooftop ? '#111827' : ACCENT; ctx.beginPath(); ctx.arc(x, yOf(yr.projected[i]), 4, 0, 7); ctx.fill();
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
  const dayOffset = Math.floor(i / p), period = i % p + 1;
  const d = new Date(yr.startDate + 'T00:00:00'); d.setDate(d.getDate() + dayOffset);
  const dateLabel = `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const header = `<div style="font-weight:700;color:#13203a;font-size:12.5px;margin-bottom:7px;">${dateLabel} · ${intervalRange(period, p)}</div>`;
  if (yr.rooftop) {
    tip.innerHTML = header +
      `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;"><span>Unadjusted demand</span><b style="font-family:'JetBrains Mono',monospace;color:#13203a;">${nf(yr.base[i])} MW</b></div>` +
      `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;margin-top:4px;"><span>Rooftop generation</span><b style="font-family:'JetBrains Mono',monospace;color:#b6790a;">${nf(yr.rooftopGeneration[i])} MW</b></div>` +
      `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;margin-top:4px;"><span>Adjusted demand</span><b style="font-family:'JetBrains Mono',monospace;color:${yr.projected[i] < 0 ? '#b42318' : '#111827'};">${nf(yr.projected[i])} MW</b></div>`;
  } else {
    tip.innerHTML = header +
      `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;"><span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:14px;height:0;border-top:2px dashed #1b2740;display:inline-block;"></span>Mapped base</span><b style="font-family:'JetBrains Mono',monospace;color:#13203a;">${yr.base[i].toFixed(3)}</b></div>` +
      `<div style="display:flex;justify-content:space-between;gap:18px;color:#5a6a86;margin-top:4px;"><span style="display:inline-flex;align-items:center;gap:7px;"><span style="width:14px;height:2px;background:${ACCENT};display:inline-block;border-radius:1px;"></span>Projected</span><b style="font-family:'JetBrains Mono',monospace;color:#13203a;">${yr.projected[i].toFixed(3)}</b></div>`;
  }
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
  PrismBrand.setupPrismBrand();
  setupFileTiles();
  setupRooftopControls();
  setupFinancialYearInputs();
  setupSolarWindowControls();
  setupInfoPopovers();
  setupChartInteractions();
  window.addEventListener('resize', updateSummaryScrollHint);
  render();
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    intervalRange,
    formatPeakInterval,
    formatPeakIntervalCell,
    populateResults,
    requiredFilesReady,
    consumeSelectedFile,
    formatMinutes,
    parseTimeMinutes,
    setSummaryPeriod,
    setupChart,
    buildTimeGridTicks,
  };
}
