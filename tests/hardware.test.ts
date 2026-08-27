import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLanes, RECO, weakReasons } from '../src/lib/hardware.ts';

test('weakReasons: a machine at or above the recommendation gives no reason', () => {
  assert.deepEqual(weakReasons({ deviceMemory: RECO.memory, hardwareConcurrency: RECO.cores }), []);
});

// The most important case: if navigator exposes nothing, let it pass. Blocking on the unknown
// would disable the extension for everyone.
test('weakReasons: absent values never block', () => {
  assert.deepEqual(weakReasons({}), []);
  assert.deepEqual(weakReasons({ deviceMemory: undefined, hardwareConcurrency: undefined }), []);
});

test('weakReasons: less RAM than the recommendation', () => {
  assert.deepEqual(
    weakReasons({ deviceMemory: RECO.memory / 2, hardwareConcurrency: RECO.cores }),
    ['memory'],
  );
});

test('weakReasons: fewer cores than the recommendation', () => {
  assert.deepEqual(
    weakReasons({ deviceMemory: RECO.memory, hardwareConcurrency: RECO.cores / 2 }),
    ['cores'],
  );
});

test('weakReasons: both reasons stack', () => {
  assert.deepEqual(
    weakReasons({ deviceMemory: RECO.memory / 2, hardwareConcurrency: RECO.cores / 2 }),
    ['memory', 'cores'],
  );
});

// deviceMemory is capped at 8 by the spec: the recommendation must stay reachable, otherwise
// every machine would be declared weak.
test('the RAM recommendation stays under the deviceMemory cap', () => {
  assert.ok(RECO.memory <= 8);
});

test('defaultLanes: a weak machine runs one chunk at a time', () => {
  assert.equal(defaultLanes({ deviceMemory: RECO.memory / 2, hardwareConcurrency: RECO.cores }), 1);
});

test('defaultLanes: unknown hardware falls back on the measured default', () => {
  assert.equal(defaultLanes({}), 2);
});

test('defaultLanes: a machine with cores to spare gets a third lane', () => {
  assert.equal(defaultLanes({ deviceMemory: RECO.memory, hardwareConcurrency: 8 }), 3);
});
