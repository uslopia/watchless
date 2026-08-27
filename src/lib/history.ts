// Summary history. Pure logic: no chrome.* dependency, the storage calls stay with the callers
// (content script and popup).
// Record shape — deliberately source-agnostic, so non-video content (article, repo) fits the
// same shelf without migration.

import type { NoteMeta, Preset, Rec, Summary, Variant } from './types.ts';

const KEY_PREFIX = 'wl:';
export const recordKey = (id: string): string => KEY_PREFIX + id;

// One key per record rather than a single array: reading a video's cache loads only it, and two
// simultaneous writers (tab + popup) cannot clobber each other through a read-modify-write. The
// price is this filter over a storage.get(null).
export const recordsFrom = (all: Record<string, unknown>): Rec[] =>
  Object.entries(all)
    .filter(([key]) => key.startsWith(KEY_PREFIX))
    .map(([, record]) => record as Rec);

// --- Styles ------------------------------------------------------------------
// A video is summarized once per preset at most, and all its styles live in the same record:
// the latest run stays at the top level — every reader already reads it — and the previous
// ones fall into `variants`. Nothing to migrate: records predating this have no variants.

const styleOf = (record: Rec): Preset => record.preset ?? 'default';

export function withVariant(previous: Rec | null, next: Rec): Rec {
  const variants: Partial<Record<Preset, Variant>> = { ...previous?.variants };
  if (previous) {
    variants[styleOf(previous)] = {
      summary: previous.summary,
      format: previous.format,
      checks: previous.checks ?? null,
      lang: previous.lang,
      capturedAt: previous.capturedAt,
    };
  }
  delete variants[styleOf(next)]; // the style being written is the top level now, not a variant
  return { ...next, variants };
}

// A full Rec, never a Variant: the panel and the note page render records, and neither has to
// know that a style other than the last one is stored differently. Same invariant as a saved
// record — displayed style at the top, the others in `variants` — so switching twice works.
export function variantOf(record: Rec, preset: Preset): Rec | null {
  if (styleOf(record) === preset) return record;
  const variant = record.variants?.[preset];
  return variant ? withVariant(record, { ...record, ...variant, preset }) : null;
}

export const presetsOf = (record: Rec): Preset[] => [
  styleOf(record),
  ...(Object.keys(record.variants ?? {}) as Preset[]),
];

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
