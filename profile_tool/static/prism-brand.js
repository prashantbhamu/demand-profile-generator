'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PrismBrand = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const EXPANDED_LABEL = 'Collapse PRISM full name';
  const COLLAPSED_LABEL = 'Expand PRISM full name';

  function createPrismBrandController(element, options = {}) {
    if (!element) return null;

    const holdMs = options.holdMs ?? 10000;
    const expansionMs = options.expansionMs ?? 600;
    const setTimer = options.setTimer ?? setTimeout;
    const clearTimer = options.clearTimer ?? clearTimeout;
    let expansionTimer = null;
    let collapseTimer = null;
    let expanded = element.getAttribute('aria-expanded') === 'true';

    function clearTimers() {
      if (expansionTimer !== null) clearTimer(expansionTimer);
      if (collapseTimer !== null) clearTimer(collapseTimer);
      expansionTimer = null;
      collapseTimer = null;
    }

    function sync() {
      element.dataset.expanded = String(expanded);
      element.setAttribute('aria-expanded', String(expanded));
      element.setAttribute('aria-label', expanded ? EXPANDED_LABEL : COLLAPSED_LABEL);
    }

    function collapse() {
      clearTimers();
      expanded = false;
      sync();
    }

    function expand() {
      clearTimers();
      expanded = true;
      sync();
      expansionTimer = setTimer(() => {
        expansionTimer = null;
        collapseTimer = setTimer(collapse, holdMs);
      }, expansionMs);
    }

    function toggle() {
      if (expanded) collapse();
      else expand();
    }

    function onClick() {
      toggle();
    }

    function onKeyDown(event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    }

    element.addEventListener('click', onClick);
    element.addEventListener('keydown', onKeyDown);
    sync();

    return {
      collapse,
      destroy() {
        clearTimers();
        element.removeEventListener('click', onClick);
        element.removeEventListener('keydown', onKeyDown);
      },
      expand,
      isExpanded: () => expanded,
      toggle,
    };
  }

  function setupPrismBrand() {
    return createPrismBrandController(document.getElementById('prism-brand'));
  }

  return { createPrismBrandController, setupPrismBrand };
}));
