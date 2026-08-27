import { getTraces } from './storage.ts';
import type { Phase, Trace } from './types.ts';

// Global progress and performance tracing. A summary runs through fixed steps of wildly
// different durations: the global percentage maps each step to a bracket of 0-100 so the loading
// gauge is not a black box, and debug traces record every phase end to end to tune the pipeline.

// Brackets of the global percentage per step. Real time is not linear: these weights estimate
// each step's share of the total, they do not measure it. Tune them when a phase drifts.
export const PHASES = {
  transcript: [0, 10],
  prepare: [10, 20],
  frame: [20, 30],
  analyze: [30, 75],
  synthesis: [75, 90],
  check: [90, 98],
} as const satisfies Record<string, readonly [number, number]>;

// Steps with a sub-progress (analyze: done/total chunks) interpolate inside their bracket; the
// others land on the end of theirs. The caller clamps the display so the gauge only moves forward.
export function phasePct(name: Phase, done?: number, total?: number | null): number {
  const [lo, hi] = PHASES[name] ?? [0, 0];
  if (total == null || total === 0) return hi;
  const p = Math.min(1, Math.max(0, (done ?? 0) / total));
  return Math.round(lo + (hi - lo) * p);
}

// Debug traces accumulate in storage.local, capped to the most recent runs.
const MAX_TRACES = 100;

export async function appendTrace(trace: Trace): Promise<Trace[]> {
  const log = [...(await getTraces()), trace].slice(-MAX_TRACES);
  await chrome.storage.local.set({ debugLog: log });
  return log;
}
