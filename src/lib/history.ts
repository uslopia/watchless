// Summary history. Pure logic: no chrome.* dependency, the storage calls stay with the callers
// (content script and popup).
// Record shape — deliberately source-agnostic, so non-video content (article, repo) fits the
// same shelf without migration.

import type { NoteMeta, Rec, Summary } from './types.ts';

const KEY_PREFIX = 'wl:';
export const recordKey = (id: string): string => KEY_PREFIX + id;

// One key per record rather than a single array: reading a video's cache loads only it, and two
// simultaneous writers (tab + popup) cannot clobber each other through a read-modify-write. The
// price is this filter over a storage.get(null).
export const recordsFrom = (all: Record<string, unknown>): Rec[] =>
  Object.entries(all)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([, record]) => record as Rec);

const WORDS_PER_MINUTE = 200;
// A very short summary is still read: without a floor, a 40 s video would look like 40 s "saved".
const MIN_READING = 30;

export function formatClock(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const countWords = (text: string): number => (text.trim().match(/\S+/g) ?? []).length;

export function readingSeconds(summary: Summary): number {
  const words =
    countWords(summary.tldr) + summary.idees.reduce((n: number, i: string) => n + countWords(i), 0);
  return Math.max(MIN_READING, Math.round((words / WORDS_PER_MINUTE) * 60));
}

export function savedSeconds(record: Rec): number {
  const original = record.seconds ?? (record.words ? (record.words / WORDS_PER_MINUTE) * 60 : 0);
  return Math.max(0, Math.round(original - readingSeconds(record.summary)));
}

export const totalSaved = (records: Rec[]): number =>
  records.reduce((n: number, r: Rec) => n + savedSeconds(r), 0);

// Units passed by the caller (chrome.i18n on the popup side), same convention as buildNote.
export function formatDuration(
  seconds: number,
  units: { h: string; min: string; s: string } = { h: 'h', min: 'min', s: 's' },
): string {
  if (seconds < 60) return `${Math.round(seconds)} ${units.s}`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (!h) return `${m} ${units.min}`;
  return m ? `${h} ${units.h} ${m} ${units.min}` : `${h} ${units.h}`;
}

export function searchRecords(records: Rec[], query: string): Rec[] {
  const q = query.trim().toLowerCase();
  if (!q) return records;
  return records.filter((r: Rec) =>
    // `?? []`: records predating this field have no keywords.
    [r.title, r.author, ...r.summary.tags, ...(r.keywords ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(q),
  );
}

export const sortRecords = (records: Rec[]): Rec[] =>
  [...records].sort((a, b) => b.capturedAt - a.capturedAt);

// Returns the ids to remove, not the records to keep: the caller does a storage.remove().
export function prune(records: Rec[], max = 500): string[] {
  return sortRecords(records)
    .slice(max)
    .map((r) => r.id);
}

export function toNoteMeta(record: Rec): NoteMeta {
  return {
    title: record.title,
    channel: record.author,
    url: record.url,
    duration: formatClock(record.seconds),
    published: record.published,
    captured: new Date(record.capturedAt).toISOString().slice(0, 10),
    checks: record.checks ?? null,
  };
}
