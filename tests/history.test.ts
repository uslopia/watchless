import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatClock,
  formatDuration,
  presetsOf,
  prune,
  readingSeconds,
  recordKey,
  recordsFrom,
  savedSeconds,
  searchRecords,
  sortRecords,
  toNoteMeta,
  totalSaved,
  variantOf,
  withVariant,
} from '../src/lib/history.ts';
import type { Rec, Summary } from '../src/lib/types.ts';

const summary = (words: number): Summary => ({
  tldr: 'mot '.repeat(words).trim(),
  idees: [],
  tags: ['test'],
});

const record = (over: Partial<Rec> = {}): Rec => ({
  id: 'yt:dQw4w9WgXcQ',
  source: 'youtube',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Titre',
  author: 'Chaine',
  seconds: 754,
  published: '2026-01-02',
  capturedAt: 1700000000000,
  lang: 'fr',
  format: 'essay',
  summary: summary(200),
  ...over,
});

test('recordKey prefixes the id', () => {
  assert.equal(recordKey('yt:abc'), 'wl:yt:abc');
});

test('formatClock: mm:ss under an hour, h:mm:ss beyond', () => {
  assert.equal(formatClock(754), '12:34');
  assert.equal(formatClock(3723), '1:02:03');
  assert.equal(formatClock(9), '0:09');
});

test('formatClock: unknown duration -> empty string', () => {
  assert.equal(formatClock(null), '');
  assert.equal(formatClock(0), '');
});

test('readingSeconds: 200 words/min', () => {
  assert.equal(readingSeconds(summary(200)), 60);
});

test('readingSeconds: 30 s floor', () => {
  // A very short summary is still read: do not inflate the time saved.
  assert.equal(readingSeconds(summary(3)), 30);
});

test('readingSeconds: counts the tldr AND the ideas', () => {
  const s = { tldr: 'un deux', idees: ['trois quatre cinq', 'six'], tags: [] };
  assert.equal(readingSeconds(s), 30); // 6 words -> floor, but no crash on idees
  const long = {
    tldr: 'mot '.repeat(100).trim(),
    idees: Array(10).fill('mot '.repeat(10).trim()),
    tags: [],
  };
  assert.equal(readingSeconds(long), 60); // 100 + 100 = 200 words
});

test('savedSeconds: duration minus summary reading time', () => {
  assert.equal(savedSeconds(record({ seconds: 754, summary: summary(200) })), 754 - 60);
});

test('savedSeconds: never negative when the video is shorter than its summary', () => {
  assert.equal(savedSeconds(record({ seconds: 20, summary: summary(1000) })), 0);
});

test('savedSeconds: without a duration, falls back on the original words (v3 seam: text)', () => {
  const r = record({ seconds: null, words: 2000, summary: summary(200) });
  assert.equal(savedSeconds(r), 600 - 60);
});

test('savedSeconds: neither duration nor words -> 0', () => {
  assert.equal(savedSeconds(record({ seconds: null, words: null })), 0);
});

test('totalSaved adds up', () => {
  const rs = [record({ seconds: 754 }), record({ seconds: 300 })];
  assert.equal(totalSaved(rs), 754 - 60 + (300 - 60));
});

test('formatDuration: hours, minutes, seconds', () => {
  assert.equal(formatDuration(15720), '4 h 22 min');
  assert.equal(formatDuration(660), '11 min');
  assert.equal(formatDuration(48), '48 s');
  assert.equal(formatDuration(0), '0 s');
});

test('formatDuration: whole hour without minutes', () => {
  assert.equal(formatDuration(7200), '2 h');
});

test('formatDuration: units provided by the caller (i18n)', () => {
  assert.equal(formatDuration(15720, { h: 'h', min: 'm', s: 's' }), '4 h 22 m');
});

test('searchRecords: title, author and tags, case-insensitive', () => {
  const rs = [
    record({
      id: 'a',
      title: 'Le Cerveau',
      author: 'Arte',
      summary: { ...summary(10), tags: ['neuro'] },
    }),
    record({
      id: 'b',
      title: 'Cuisine',
      author: 'Chef',
      summary: { ...summary(10), tags: ['food'] },
    }),
  ];
  assert.deepEqual(
    searchRecords(rs, 'cerveau').map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(
    searchRecords(rs, 'CHEF').map((r) => r.id),
    ['b'],
  );
  assert.deepEqual(
    searchRecords(rs, 'neuro').map((r) => r.id),
    ['a'],
  );
});

test('searchRecords: also searches the YouTube keywords', () => {
  const rs = [
    record({ id: 'a', keywords: ['flics', 'sketch'] }),
    record({ id: 'b' }), // record predating the field: must not crash
  ];
  assert.deepEqual(
    searchRecords(rs, 'sketch').map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(
    searchRecords(rs, 'titre').map((r) => r.id),
    ['a', 'b'],
  );
});

test('searchRecords: empty query -> everything', () => {
  const rs = [record({ id: 'a' }), record({ id: 'b' })];
  assert.equal(searchRecords(rs, '   ').length, 2);
});

test('sortRecords: most recent first, without mutating the input', () => {
  const rs = [record({ id: 'vieux', capturedAt: 1 }), record({ id: 'neuf', capturedAt: 9 })];
  assert.deepEqual(
    sortRecords(rs).map((r) => r.id),
    ['neuf', 'vieux'],
  );
  assert.equal(rs[0]?.id, 'vieux');
});

test('prune: nothing to remove under the cap', () => {
  assert.deepEqual(prune([record({ id: 'a' })], 500), []);
});

test('prune: removes the oldest beyond the cap', () => {
  const rs = [1, 2, 3, 4].map((n) => record({ id: `r${n}`, capturedAt: n }));
  assert.deepEqual(prune(rs, 2), ['r2', 'r1']);
});

test('toNoteMeta: the shape expected by buildNote', () => {
  assert.deepEqual(toNoteMeta(record({ capturedAt: Date.UTC(2026, 7, 26, 10) })), {
    title: 'Titre',
    channel: 'Chaine',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    duration: '12:34',
    published: '2026-01-02',
    captured: '2026-08-26',
    checks: null,
  });
});

test('toNoteMeta: checks follow the record when it has them', () => {
  const checks = { promise: 'kept', sources: 'cited', sponsor: '', why: 'ok' };
  assert.deepEqual(toNoteMeta(record({ checks })).checks, checks);
});

test('recordsFrom: ignores keys that are not records', () => {
  const all = { 'wl:yt:a': record({ id: 'yt:a' }), lang: 'fr', vault: 'MonVault' };
  assert.deepEqual(
    recordsFrom(all).map((r) => r.id),
    ['yt:a'],
  );
});

// --- Styles ------------------------------------------------------------------

const styled = (preset: Rec['preset'], tldr: string): Rec =>
  record({ preset, summary: { tldr, idees: [], tags: [] } });

test('withVariant: a second style joins the same record', () => {
  const merged = withVariant(styled('default', 'un'), styled('quotes', 'deux'));
  assert.equal(merged.preset, 'quotes');
  assert.equal(merged.summary.tldr, 'deux');
  assert.equal(merged.variants?.default?.summary.tldr, 'un');
  assert.deepEqual(Object.keys(merged.variants ?? {}), ['default']);
});

test('withVariant: regenerating a known style replaces it, never duplicates it', () => {
  const two = withVariant(styled('default', 'un'), styled('quotes', 'deux'));
  const back = withVariant(two, styled('default', 'trois'));
  assert.equal(back.summary.tldr, 'trois');
  assert.deepEqual(Object.keys(back.variants ?? {}), ['quotes']);
  assert.equal(back.variants?.quotes?.summary.tldr, 'deux');
});

test('withVariant: a record predating presets is filed under default', () => {
  const legacy = record({ preset: undefined });
  assert.ok(withVariant(legacy, styled('triage', 'x')).variants?.default);
});

test('variantOf: the top level, a stored style, or nothing', () => {
  const merged = withVariant(styled('default', 'un'), styled('quotes', 'deux'));
  assert.equal(variantOf(merged, 'quotes')?.summary.tldr, 'deux');
  const older = variantOf(merged, 'default');
  assert.equal(older?.summary.tldr, 'un');
  assert.equal(older?.preset, 'default');
  assert.equal(older?.title, 'Titre'); // a full record: the video's fields come along
  assert.equal(variantOf(merged, 'figures'), null);
});

test('presetsOf: every style of the record, once', () => {
  const merged = withVariant(styled('default', 'un'), styled('quotes', 'deux'));
  assert.deepEqual(presetsOf(merged), ['quotes', 'default']);
  // variantOf leaves the displayed style in `variants`: the picker must still list it once.
  assert.deepEqual(presetsOf(variantOf(merged, 'default') as Rec), ['default', 'quotes']);
  assert.deepEqual(presetsOf(record()), ['default']);
});
