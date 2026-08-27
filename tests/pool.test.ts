import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../src/lib/pool.ts';

const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// The whole point of the pool is that a lane moves on without its neighbours: the results must
// still come back in the input order, or the chunk notes are silently shuffled.
test('pool: keeps the input order whatever the completion order', async () => {
  const out = await pool([30, 0, 10, 0], 2, (ms, i) => after(ms, i));
  assert.deepEqual(out, [0, 1, 2, 3]);
});

test('pool: never runs more than width at once', async () => {
  let live = 0;
  let peak = 0;
  await pool([...Array(7).keys()], 3, async () => {
    peak = Math.max(peak, ++live);
    await after(5, null);
    live--;
  });
  assert.equal(peak, 3);
});

// A width above the item count must not spawn lanes with nothing to do.
test('pool: more lanes than items runs each item once', async () => {
  const seen: number[] = [];
  const out = await pool([1, 2], 8, async (n) => {
    seen.push(n);
    return n * 2;
  });
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(out, [2, 4]);
});

test('pool: an empty list runs nothing', async () => {
  assert.deepEqual(await pool([], 3, async () => 1), []);
});
