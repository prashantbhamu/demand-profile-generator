'use strict';

(function exposeFinancialYear(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FinancialYear = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFinancialYearApi() {
  function invalid(error) {
    return { valid: false, startYear: null, label: '', error };
  }

  function suffixForStartYear(startYear) {
    return String((startYear + 1) % 100).padStart(2, '0');
  }

  function parseFinancialYear(value) {
    const match = String(value ?? '').trim().match(/^(\d{4})(?:-(\d{2}))?$/);
    if (!match) {
      return invalid('Enter a financial year as YYYY-YY.');
    }

    const startYear = Number(match[1]);
    if (startYear < 1900 || startYear > 2200) {
      return invalid('Financial year must begin between 1900 and 2200.');
    }

    const expectedSuffix = suffixForStartYear(startYear);
    if (match[2] && match[2] !== expectedSuffix) {
      return invalid(
        `Financial year beginning ${startYear} must end in ${expectedSuffix}.`
      );
    }

    return {
      valid: true,
      startYear,
      label: `${startYear}-${expectedSuffix}`,
      error: '',
    };
  }

  function basePeriodForStartYear(startYear) {
    return {
      startDate: `${startYear}-04-01`,
      endDate: `${startYear + 1}-03-31`,
    };
  }

  function bindFinancialYearInput(input, errorElement, onValidityChange = () => {}) {
    function showValidation(formatValue, showError) {
      const result = parseFinancialYear(input.value);
      if (result.valid && formatValue) {
        input.value = result.label;
      }
      input.setCustomValidity(result.error);
      input.setAttribute('aria-invalid', String(!result.valid));
      errorElement.textContent = showError ? result.error : '';
      onValidityChange(result.valid);
      return result;
    }

    input.addEventListener('input', () => {
      input.setCustomValidity('');
      input.setAttribute('aria-invalid', 'false');
      errorElement.textContent = '';
      onValidityChange(parseFinancialYear(input.value).valid);
    });
    input.addEventListener('blur', () => showValidation(true, true));
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      showValidation(true, true);
    });

    return {
      validate: () => showValidation(true, true),
    };
  }

  return {
    basePeriodForStartYear,
    bindFinancialYearInput,
    parseFinancialYear,
  };
}));
