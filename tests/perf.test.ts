import assert from 'node:assert/strict';
import test from 'node:test';
import { PHASES, phasePct } from '../src/lib/perf.ts';

test('single-shot phases land on the end of their bracket', () => {
  for (const name of ['prepare', 'frame', 'synthesis', 'check'] as const) {
    assert.equal(phasePct(name), PHASES[name][1], name);
  }
});

test('analyze interpolates across its bracket', () => {
  assert.equal(phasePct('analyze', 0, 4), PHASES.analyze[0]);
  assert.equal(phasePct('analyze', 4, 4), PHASES.analyze[1]);
  assert.equal(phasePct('analyze', 2, 4), Math.round((PHASES.analyze[0] + PHASES.analyze[1]) / 2));
});

test('brackets partition 0-100 in order', () => {
  const ranges: readonly (readonly [number, number])[] = Object.values(PHASES);
  assert.equal(ranges[0]?.[0], 0);
  for (let i = 0; i < ranges.length; i++) {
    assert.ok((ranges[i] as [number, number])[0] < (ranges[i] as [number, number])[1], String(i));
    if (i > 0)
      assert.equal(
        (ranges[i] as [number, number])[0],
        (ranges[i - 1] as [number, number])[1],
        String(i),
      );
  }
  assert.ok((ranges.at(-1) as [number, number])[1] <= 100);
});

test('phasePct clamps done and total', () => {
  assert.equal(phasePct('analyze', 99, 3), PHASES.analyze[1]);
  assert.equal(phasePct('analyze', -1, 3), PHASES.analyze[0]);
});
