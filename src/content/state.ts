// Per-tab session state, shared by the flow (index.ts) and the panel. Reset on every navigation.
import type { Session } from '../lib/types.ts';

export const state: Session = {
  meta: null,
  summary: null,
  format: null,
  checks: null,
  lang: null,
  preset: null,
  record: null,
  port: null,
  modelPort: null,
};

export function reset(): void {
  state.port?.disconnect();
  state.modelPort?.disconnect();
  state.port = null;
  state.modelPort = null;
  state.meta = state.summary = state.format = state.checks = state.record = null;
  state.lang = state.preset = null;
}
