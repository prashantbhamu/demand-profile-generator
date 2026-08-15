'use strict';

const assert = require('node:assert/strict');
const { createPrismBrandController } = require('../profile_tool/static/prism-brand.js');

function fakeElement() {
  const attributes = new Map([['aria-expanded', 'false']]);
  const listeners = new Map();
  return {
    dataset: {},
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    click() { listeners.get('click')?.(); },
    press(key) {
      let prevented = false;
      listeners.get('keydown')?.({ key, preventDefault() { prevented = true; } });
      return prevented;
    },
  };
}

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId++;
      callbacks.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) { callbacks.delete(id); },
    pending() { return [...callbacks.values()].map(item => item.delay); },
    runDelay(delay) {
      const item = [...callbacks.entries()].find(([, value]) => value.delay === delay);
      assert.ok(item, `Expected a ${delay} ms timer`);
      callbacks.delete(item[0]);
      item[1].callback();
    },
  };
}

const element = fakeElement();
const timers = fakeTimers();
const controller = createPrismBrandController(element, {
  expansionMs: 600,
  holdMs: 10000,
  setTimer: timers.setTimer,
  clearTimer: timers.clearTimer,
});

assert.equal(controller.isExpanded(), false);
assert.equal(element.dataset.expanded, 'false');
assert.equal(element.getAttribute('aria-label'), 'Expand PRISM full name');

element.click();
assert.equal(controller.isExpanded(), true);
assert.equal(element.getAttribute('aria-expanded'), 'true');
assert.deepEqual(timers.pending(), [600]);

element.click();
assert.equal(controller.isExpanded(), false);
assert.deepEqual(timers.pending(), []);

controller.expand();
timers.runDelay(600);
assert.deepEqual(timers.pending(), [10000]);
timers.runDelay(10000);
assert.equal(controller.isExpanded(), false);

controller.expand();
controller.collapse();
controller.expand();
assert.deepEqual(timers.pending(), [600]);
controller.collapse();
assert.equal(element.press('Enter'), true);
assert.equal(controller.isExpanded(), true);
assert.equal(element.press(' '), true);
assert.equal(controller.isExpanded(), false);
assert.equal(element.press('Escape'), false);
controller.destroy();
assert.deepEqual(timers.pending(), []);

console.log('PRISM brand tests passed.');
