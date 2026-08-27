// Format/Preset/Phase are derived from the const objects that define them rather than restated,
// so adding a format in summarize.ts cannot silently drift from the type.

import type { PHASES } from './perf.ts';
import type { CHECKS, FORMATS, PRESETS } from './summarize.ts';

export type Format = keyof typeof FORMATS; // essay | comedy | tutorial | interview | news | vlog
export type Preset = keyof typeof PRESETS; // default | triage | action | quotes | figures
export type Phase = keyof typeof PHASES; // transcript | prepare | frame | analyze | synthesis | check

export interface Summary {
  tldr: string;
  idees: string[];
  tags: string[];
}

type CheckPromise = (typeof CHECKS.promise)[number];
type CheckSources = (typeof CHECKS.sources)[number];

export interface Checks {
  promise: CheckPromise;
  sources: CheckSources;
  sponsor: string;
  why: string;
  // Merged in by buildRecord() from YouTube's own disclosure. Absent when the blob was stale —
  // unknown is not "no paid promotion".
  paid?: boolean;
}

export interface Badge {
  key: string;
  arg?: string;
}

export interface FormatDef {
  chunk: string;
  final: string;
}

export interface PresetDef {
  fields: string;
  chunk?: string;
  final?: string;
  verbatim?: boolean;
}

export interface Meta {
  id: string; // `yt:${videoId()}`
  title: string;
  channel: string;
  url: string;
  seconds: number | null; // NaN -> null: "unknown duration" is not "0-second video"
  duration: string;
  captured: string;
  published: string | null;
  // ...videoMeta()
  description?: string | null;
  category?: string | null;
  keywords?: string[] | null;
  channelId?: string | null;
  paid?: boolean;
  // ...channelMeta()
  channelDescription?: string | null;
  channelKeywords?: string[] | null;
}

export interface Rec {
  id: string;
  source: 'youtube';
  url: string;
  title: string;
  author: string; // meta.channel — "`channel` -> `author`", source-agnostic on purpose
  seconds: number | null;
  published: string | null;
  capturedAt: number;
  lang: string;
  format: Format | null;
  summary: Summary;
  words?: number | null;
  keywords?: string[] | null;
  preset?: Preset | null;
  checks?: Checks | null;
}

export interface NoteMeta {
  title: string;
  channel: string;
  url: string;
  duration: string;
  published: string | null;
  captured: string;
  // Partial: buildNote only renders promise/sources/sponsor/paid.
  checks?: Partial<Checks> | null;
}

// chrome.storage.sync
export interface Settings {
  lang: string; // 'auto', or any BCP-47 tag
  preset: Preset;
  vault: string;
  folder: string;
  autoExport: 'off' | 'obsidian' | 'download';
  // Strings, not numbers: the value comes from a <select> and goes to storage.sync as it stands.
  concurrency: 'auto' | '1' | '2' | '3' | '4';
  prewarm: boolean;
  debug: boolean;
}

// The port protocol: the one cross-file contract with no test behind it. These catch drift
// between content/index.ts and background/summarize.ts.
interface Timings {
  prepare?: number;
  frame?: number;
  analyze?: number;
  synthesis?: number;
  check?: number;
  chunkMs: number[];
  chunkCount: number;
  passes: number;
  workerMs: number;
}

export type ToWorker =
  | { type: 'warm'; lang: string; preset: Preset; meta: Meta | null }
  | { type: 'transcript'; transcript: string };

export type FromWorker =
  | { type: 'download'; loaded: number }
  | { type: 'progress'; step: string; pct: number }
  | { type: 'error'; message: string }
  | { type: 'done'; summary: Summary; format: Format; checks: Checks | null; timings: Timings };

export type Trace = Timings & {
  at: number;
  title: string;
  duration: number | null;
  lang: string;
  preset: Preset | null;
  format: Format;
  chars: number;
  transcriptMs: number;
  endToEndMs: number;
};

export interface Handlers {
  onNote: (btn: HTMLButtonElement) => void;
  onRedo: (btn: HTMLButtonElement) => void;
}

export interface Session {
  meta: Meta | null;
  summary: Summary | null;
  format: Format | null;
  checks: Checks | null;
  lang: string | null;
  preset: Preset | null;
  record: Rec | null;
  port: chrome.runtime.Port | null;
  modelPort: chrome.runtime.Port | null;
}

declare global {
  // Chrome-only, absent from TS's DOM lib. Read directly at popup.ts's hardware card.
  interface Navigator {
    readonly deviceMemory?: number;
  }
}
