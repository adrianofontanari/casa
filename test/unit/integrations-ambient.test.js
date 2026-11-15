'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
  const listeners = {};
  const sandbox = { window: {}, document: { addEventListener: (n, f) => { listeners[n] = f; } }, setTimeout, clearTimeout, Math, Float32Array };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'room', 'panels', 'ambient.js'), 'utf8'), sandbox);
  return { A: sandbox.window.CasaAmbient, listeners };
}

test('ambient: API, and no AudioContext means play() returns false instead of throwing', () => {
  const { A, listeners } = load();
  assert.deepEqual(Array.from(A.names), ['sea', 'rain', 'fire', 'birds']);
  assert.equal(A.play('sea'), false);
  assert.equal(A.play('nope'), false);
  assert.equal(A.playing(), null);
  assert.equal(A.state(), 'none');
  assert.equal(A.volume(2), 1);
  assert.equal(A.volume(-1), 0);
  assert.ok(listeners['casa:pause'] && listeners['casa:resume'], 'listens to casa:pause and casa:resume');
});

test('ambient: every sound renders finite, normalised, and loops without a click', () => {
  const { A } = load();
  for (const name of A.names) {
    const t = Date.now();
    const x = A.render(name);
    const ms = Date.now() - t;
    let sum = 0, peak = 0, maxStep = 0, sumStep = 0;
    for (let i = 0; i < x.length; i++) {
      assert.ok(Number.isFinite(x[i]), name + ' sample ' + i);
      sum += x[i] * x[i];
      peak = Math.max(peak, Math.abs(x[i]));
      if (i) { const d = Math.abs(x[i] - x[i - 1]); sumStep += d; maxStep = Math.max(maxStep, d); }
    }
    const rms = Math.sqrt(sum / x.length);
    const meanStep = sumStep / (x.length - 1);
    const seam = Math.abs(x[0] - x[x.length - 1]);
    assert.ok(peak <= 0.921, name + ' peak ' + peak.toFixed(3));
    assert.ok(rms > 0.03 && rms <= 0.161, name + ' rms ' + rms.toFixed(3));
    // the jump across the loop point is no bigger than the sound's own sample-to-sample motion
    assert.ok(seam <= Math.max(maxStep * 0.6, meanStep * 8), name + ' seam ' + seam.toFixed(4) + ' vs mean step ' + meanStep.toFixed(4));
    assert.ok(ms < 1500, name + ' rendered in ' + ms + ' ms');
    console.log(name, 'seconds', (x.length / A.sampleRate).toFixed(1), 'rms', rms.toFixed(3), 'peak', peak.toFixed(3), 'seam', seam.toFixed(4), 'meanStep', meanStep.toFixed(4), 'render ms', ms);
  }
});
