'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financialYearCases = require('./financial_year_cases.json');

const {
  basePeriodForStartYear,
  bindFinancialYearInput,
  parseFinancialYear,
} = require('../profile_tool/static/financial-year.js');


function fakeInput(value) {
  const listeners = new Map();
  return {
    value,
    attributes: {},
    customValidity: '',
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    blur() {},
    dispatch(name, event = {}) {
      listeners.get(name)?.(event);
    },
    setAttribute(name, attributeValue) {
      this.attributes[name] = attributeValue;
    },
    setCustomValidity(message) {
      this.customValidity = message;
    },
  };
}


test('four-digit year completes to a financial-year label', () => {
  assert.deepEqual(parseFinancialYear('2025'), {
    valid: true,
    startYear: 2025,
    label: '2025-26',
    error: '',
  });
});

test('complete consecutive financial-year label is accepted', () => {
  assert.deepEqual(parseFinancialYear('2025-26'), {
    valid: true,
    startYear: 2025,
    label: '2025-26',
    error: '',
  });
});

test('inconsistent complete financial-year label is rejected', () => {
  assert.deepEqual(parseFinancialYear('2025-27'), {
    valid: false,
    startYear: null,
    label: '',
    error: 'Financial year beginning 2025 must end in 26.',
  });
});

test('financial-year labels match shared cross-runtime cases', () => {
  for (const financialYearCase of financialYearCases) {
    assert.equal(
      parseFinancialYear(financialYearCase.input).label,
      financialYearCase.label
    );
  }
});

test('base period is derived as April through March', () => {
  assert.deepEqual(basePeriodForStartYear(2024), {
    startDate: '2024-04-01',
    endDate: '2025-03-31',
  });
});

test('bound field completes a four-digit year on blur', () => {
  const input = fakeInput('2025');
  const error = { textContent: '' };
  bindFinancialYearInput(input, error);

  input.dispatch('blur');

  assert.equal(input.value, '2025-26');
  assert.equal(input.attributes['aria-invalid'], 'false');
  assert.equal(error.textContent, '');
});

test('bound field completes a four-digit year on Enter', () => {
  const input = fakeInput('2025');
  const error = { textContent: '' };
  let prevented = false;
  bindFinancialYearInput(input, error);

  input.dispatch('keydown', {
    key: 'Enter',
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, true);
  assert.equal(input.value, '2025-26');
});

test('bound field exposes an inline error for inconsistent labels', () => {
  const input = fakeInput('2025-27');
  const error = { textContent: '' };
  bindFinancialYearInput(input, error);

  input.dispatch('blur');

  assert.equal(input.attributes['aria-invalid'], 'true');
  assert.equal(input.customValidity, 'Financial year beginning 2025 must end in 26.');
  assert.equal(error.textContent, 'Financial year beginning 2025 must end in 26.');
});

test('explicit silent validation does not restart contextual validation', () => {
  const input = fakeInput('2025-26');
  const error = { textContent: '' };
  let notifications = 0;
  const binding = bindFinancialYearInput(input, error, () => { notifications += 1; });

  const result = binding.validate(false);

  assert.equal(result.valid, true);
  assert.equal(notifications, 0);
});
