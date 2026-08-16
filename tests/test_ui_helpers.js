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
  formatPeakIntervalCell,
  populateResults,
  requiredFilesReady,
  formatMinutes,
  parseTimeMinutes,
  setSummaryPeriod,
  setupChart,
  buildTimeGridTicks,
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
assert.match(
  formatPeakIntervalCell('2030-05-15', 73, 96),
  /15 May 2030.*18:00–18:15/
);
assert.equal(formatMinutes(360), '06:00');
assert.equal(formatMinutes(1440), '24:00');
assert.equal(parseTimeMinutes('18:15'), 1095);
assert.equal(parseTimeMinutes('24:00'), 1440);
assert.equal(parseTimeMinutes('25:00'), null);

const standardFiles = { base:{}, peak:{}, energy:{} };
assert.equal(requiredFilesReady(standardFiles, false, 'empty', 'empty'), true);
const rooftopFiles = { ...standardFiles, rooftopProfile:{}, rooftopTrajectory:{} };
assert.equal(requiredFilesReady(rooftopFiles, true, 'valid', 'valid'), true);
assert.equal(requiredFilesReady(rooftopFiles, true, 'valid', 'validating'), false);
assert.equal(requiredFilesReady(rooftopFiles, true, 'error', 'valid'), false);
const validCore = Object.fromEntries(['base','peak','energy'].map(key => [key,{status:'valid'}]));
const invalidCore = { ...validCore, peak:{status:'error'} };
assert.equal(requiredFilesReady(standardFiles, false, 'empty', 'empty', validCore), true);
assert.equal(requiredFilesReady(standardFiles, false, 'empty', 'empty', invalidCore), false);

const elements = new Map([
  ['output-path-text', {}], ['metrics-grid', {}], ['summary-head', {}],
  ['summary-tbody', {}], ['summary-peak-title', {hidden:true}],
  ['summary-secondary-section', {hidden:true}], ['summary-energy-head', {}],
  ['summary-energy-tbody', {}], ['chart-title', {}], ['chart-legend', {}], ['year-chips', {}],
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
  unadjusted_peak_date: '2030-05-14', unadjusted_peak_period: 72,
  adjusted_peak_date: '2030-05-15', adjusted_peak_period: 73,
  solar_peak_mw: 225, solar_peak_date: '2030-05-15', solar_peak_period: 71,
  before_rooftop_solar_peak_mw: 250,
  before_rooftop_solar_peak_date: '2030-05-14', before_rooftop_solar_peak_period: 72,
  solar_peak_reduction_mw: 25, solar_peak_reduction_percent: 10,
  non_solar_peak_mw: 215, non_solar_peak_date: '2030-05-16', non_solar_peak_period: 73,
  before_rooftop_non_solar_peak_mw: 220,
  before_rooftop_non_solar_peak_date: '2030-05-16', before_rooftop_non_solar_peak_period: 74,
  non_solar_peak_reduction_mw: 5, non_solar_peak_reduction_percent: 2.27,
};
populateResults({output_path:'utility_rooftop_adjusted.csv', rows_written:35040, summaries:[summary]});
assert.match(elements.get('metrics-grid').innerHTML, /Profile CUF/);
assert.doesNotMatch(elements.get('metrics-grid').innerHTML, /Minimum/);
assert.match(elements.get('summary-head').innerHTML, /Overall peak/);
assert.match(elements.get('summary-head').innerHTML, /Peak during solar period/);
assert.match(elements.get('summary-head').innerHTML, /Rooftop capacity/);
assert.doesNotMatch(elements.get('summary-head').innerHTML, />Cumulative rooftop capacity</);
assert.match(elements.get('summary-head').innerHTML, /Unadjusted timing/);
assert.match(elements.get('summary-head').innerHTML, /Adjusted timing/);
assert.doesNotMatch(elements.get('summary-head').innerHTML, /Before rooftop|After rooftop/);
assert.match(elements.get('summary-energy-head').innerHTML, /Unadjusted energy/);
assert.match(elements.get('summary-energy-head').innerHTML, /Projected CUF/);
assert.doesNotMatch(elements.get('summary-head').innerHTML, /MW|GWh|Effective|FY-end/);
assert.match(elements.get('summary-tbody').innerHTML, /2025-26/);
assert.match(elements.get('summary-tbody').innerHTML, /250 MW/);
assert.match(elements.get('summary-energy-tbody').innerHTML, /1,000 GWh/);
assert.match(elements.get('summary-tbody').innerHTML, /500 MW/);
assert.match(elements.get('summary-tbody').innerHTML, /25 MW.*\(10\.00%\)/);
assert.match(elements.get('summary-energy-tbody').innerHTML, /negative-value/);
assert.doesNotMatch(elements.get('summary-tbody').innerHTML, /Net export/);
assert.match(elements.get('summary-tbody').innerHTML, /17:45–18:00/);
assert.equal(elements.get('summary-peak-title').hidden, false);
assert.equal(elements.get('summary-secondary-section').hidden, false);

setSummaryPeriod('non_solar');
assert.match(elements.get('summary-head').innerHTML, /Peak during non-solar period/);
assert.match(elements.get('summary-tbody').innerHTML, /215 MW/);
assert.match(elements.get('summary-tbody').innerHTML, /5 MW.*\(2\.27%\)/);
assert.match(elements.get('summary-tbody').innerHTML, /18:00–18:15/);

setSummaryPeriod('solar');
populateResults({output_path:'utility_projected_demand.csv', rows_written:8760, summaries:[{
  financial_year:'2025-26', rooftop_enabled:false, periods_per_day:24, row_count:8760,
  achieved_peak_mw:240, achieved_energy_gwh:1000, energy_growth_percent:null,
  solar_peak_mw:220, solar_peak_date:'2025-05-01', solar_peak_period:18,
  solar_peak_growth_percent:null, non_solar_peak_mw:240,
  non_solar_peak_date:'2025-06-01', non_solar_peak_period:24,
  non_solar_peak_growth_percent:null,
}]});
assert.match(elements.get('summary-head').innerHTML, /Peak during solar period/);
assert.match(elements.get('summary-tbody').innerHTML, /220 MW/);
assert.match(elements.get('summary-tbody').innerHTML, /17:00–18:00/);
assert.equal(elements.get('summary-peak-title').hidden, true);
assert.equal(elements.get('summary-secondary-section').hidden, true);
setSummaryPeriod('non_solar');
assert.match(elements.get('summary-head').innerHTML, /Peak during non-solar period/);
assert.match(elements.get('summary-tbody').innerHTML, /240 MW/);
assert.match(elements.get('summary-tbody').innerHTML, /23:00–24:00/);

setupChart({rooftop_enabled:true, years:[{
  year:2025, label:'2025-26', start_date:'2025-04-01', periods_per_day:24,
  before_rooftop:{points:[200,210]}, adjusted:{points:[190,205]},
  rooftop_generation:{points:[10,5]},
}]});
assert.match(elements.get('year-chips').innerHTML, /2025-26/);
assert.match(elements.get('chart-title').textContent, /Rooftop-adjusted demand profile/);
assert.match(elements.get('chart-legend').innerHTML, /Unadjusted demand/);
assert.match(elements.get('chart-legend').innerHTML, /Rooftop generation/);


const hourlyYear = {
  startDate:'2025-04-01', periodsPerDay:24, base:Array(365 * 24).fill(0),
};
const fullYearTicks = buildTimeGridTicks(hourlyYear, 0, 1);
assert.deepEqual(
  fullYearTicks.map(tick => tick.label),
  ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']
);
assert.ok(fullYearTicks.every(tick => tick.kind === 'month'));

const twoDayMax = (2 * hourlyYear.periodsPerDay) / (hourlyYear.base.length - 1);
const closeTicks = buildTimeGridTicks(hourlyYear, 0, twoDayMax);
assert.ok(closeTicks.some(tick => tick.label === '01 Apr' && tick.kind === 'month'));
assert.ok(closeTicks.some(tick => tick.label === '02 Apr' && tick.kind === 'day'));
assert.ok(closeTicks.some(tick => tick.label === '06:00' && tick.kind === 'hour'));
assert.ok(closeTicks.some(tick => tick.label === '18:00' && tick.kind === 'hour'));

const panStart = (40 * hourlyYear.periodsPerDay + 6) / (hourlyYear.base.length - 1);
const panEnd = (42 * hourlyYear.periodsPerDay + 6) / (hourlyYear.base.length - 1);
const pannedTicks = buildTimeGridTicks(hourlyYear, panStart, panEnd);
assert.ok(pannedTicks.some(tick => tick.label === '12 May' && tick.kind === 'day'));
assert.ok(pannedTicks.some(tick => tick.label === '13 May' && tick.kind === 'day'));
assert.ok(pannedTicks.every(tick => tick.pos >= panStart && tick.pos <= panEnd));
assert.ok(pannedTicks.every(tick => tick.label !== '01 Apr'));

const leapYear = {
  startDate:'2027-04-01', periodsPerDay:96, base:Array(366 * 96).fill(0),
};
const leapStart = new Date('2027-04-01T00:00:00');
const leapDay = new Date('2028-02-29T00:00:00');
const leapOffset = Math.round((leapDay - leapStart) / 86400000);
const leapMin = (leapOffset * leapYear.periodsPerDay) / (leapYear.base.length - 1);
const leapMax = ((leapOffset + 2) * leapYear.periodsPerDay) / (leapYear.base.length - 1);
const leapTicks = buildTimeGridTicks(leapYear, leapMin, leapMax);
assert.ok(leapTicks.some(tick => tick.label === '29 Feb' && tick.kind === 'day'));
console.log('UI helper tests passed.');
