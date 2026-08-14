'use strict';

const assert = require('node:assert/strict');

global.FinancialYear = {
  basePeriodForStartYear() {},
  bindFinancialYearInput() {},
  parseFinancialYear() {},
};
global.document = { addEventListener() {} };

const {
  intervalRange,
  formatPeakInterval,
  populateResults,
  requiredFilesReady,
  setupChart,
} = require('../profile_tool/static/app.js');

assert.equal(intervalRange(1, 24), '00:00–01:00');
assert.equal(intervalRange(19, 24), '18:00–19:00');
assert.equal(intervalRange(1, 96), '00:00–00:15');
assert.equal(intervalRange(73, 96), '18:00–18:15');
assert.equal(intervalRange(96, 96), '23:45–24:00');
assert.equal(
  formatPeakInterval('2030-05-15', 73, 96),
  '15 May 2030, 18:00–18:15'
);

const standardFiles = { base:{}, peak:{}, energy:{} };
assert.equal(requiredFilesReady(standardFiles, false, 'empty', 'empty'), true);
const rooftopFiles = { ...standardFiles, rooftopProfile:{}, rooftopTrajectory:{} };
assert.equal(requiredFilesReady(rooftopFiles, true, 'valid', 'valid'), true);
assert.equal(requiredFilesReady(rooftopFiles, true, 'valid', 'validating'), false);
assert.equal(requiredFilesReady(rooftopFiles, true, 'error', 'valid'), false);

const elements = new Map([
  ['output-path-text', {}], ['metrics-grid', {}], ['summary-head', {}],
  ['summary-tbody', {}], ['chart-title', {}], ['chart-legend', {}], ['year-chips', {}],
]);
global.document.getElementById = id => elements.get(id);
global.requestAnimationFrame = () => {};

const summary = {
  financial_year: '2025-26', rooftop_enabled: true, periods_per_day: 96,
  before_rooftop_peak_mw: 250, achieved_peak_mw: 225, peak_reduction_mw: 25,
  peak_reduction_percent: 10, before_rooftop_energy_gwh: 1000,
  achieved_energy_gwh: 900, rooftop_generation_gwh: 100,
  rooftop_template_cuf_percent: 20, rooftop_effective_cuf_percent: 19.5,
  rooftop_year_end_capacity_mw: 500, adjusted_minimum_mw: -5,
  adjusted_peak_date: '2030-05-15', adjusted_peak_period: 73,
};
populateResults({output_path:'utility_rooftop_adjusted.csv', rows_written:35040, summaries:[summary]});
assert.match(elements.get('summary-head').innerHTML, /Before peak MW/);
assert.match(elements.get('summary-tbody').innerHTML, /2025-26/);
assert.match(elements.get('summary-tbody').innerHTML, /negative-value/);
assert.match(elements.get('summary-tbody').innerHTML, /18:00–18:15/);

setupChart({rooftop_enabled:true, years:[{
  year:2025, label:'2025-26', start_date:'2025-04-01', periods_per_day:24,
  before_rooftop:{points:[200,210]}, adjusted:{points:[190,205]},
  rooftop_generation:{points:[10,5]},
}]});
assert.match(elements.get('year-chips').innerHTML, /2025-26/);
assert.match(elements.get('chart-legend').innerHTML, /Rooftop generation/);

console.log('UI helper tests passed.');
