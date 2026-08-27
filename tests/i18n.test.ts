import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { CHECKS, checkBadges, FORMATS, PRESETS } from '../src/lib/summarize.ts';
import type { Preset } from '../src/lib/types.ts';

const load = (locale: string): Record<string, { message: string }> =>
  JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
const locales = readdirSync(new URL('../_locales', import.meta.url));
const reference = load('en'); // default_locale of the manifest

test('each locale has exactly the keys of the default locale', () => {
  for (const locale of locales) {
    assert.deepEqual(Object.keys(load(locale)).sort(), Object.keys(reference).sort(), locale);
  }
});

test('one label per detectable format', () => {
  for (const format of Object.keys(FORMATS)) assert.ok(reference[`format_${format}`], format);
});

test('one label per preset', () => {
  for (const preset of Object.keys(PRESETS)) assert.ok(reference[`preset_${preset}`], preset);
});

// Section titles compose (`section_${name}_${preset}`): the overrides must target a real preset.
test('section overrides target existing presets', () => {
  const composed = Object.keys(reference).filter((k) => /^section_[a-z]+_[a-z]+$/.test(k));
  for (const key of composed) {
    assert.ok(PRESETS[key.split('_')[2] as Preset], key);
  }
});

// The badges compose (`check_promise_${value}`): go through checkBadges rather than a hand-written
// list, which would drift at the first added check.
test('one label per check badge', () => {
  const keys = new Set(['check_clean', 'check_paid']);
  for (const promise of CHECKS.promise) {
    for (const sources of CHECKS.sources) {
      for (const badge of checkBadges({ promise, sources, sponsor: 'X', paid: true }, 'essay'))
        keys.add(badge.key);
    }
  }
  for (const key of keys) assert.ok(reference[key], key);
});

test('translation placeholders match the reference', () => {
  const slots = (s: string) => [...s.matchAll(/\$\d/g)].map((m) => m[0]).sort();
  for (const locale of locales) {
    const messages = load(locale);
    for (const [key, { message }] of Object.entries(reference)) {
      assert.deepEqual(slots(messages[key]?.message ?? ''), slots(message), `${locale}/${key}`);
    }
  }
});

// Keys are referenced by string: nothing links a typo in the code to _locales before runtime.
// This test makes that link, in both directions.
const sources = [
  'src/content/index.ts',
  'src/content/panel.ts',
  'src/content/scrape.ts',
  'src/content/util.ts',
  'src/background/index.ts',
  'src/background/summarize.ts',
  'src/popup/popup.ts',
  'src/popup/popup.html',
  'src/summary/summary.ts',
  'src/summary/summary.html',
  'manifest.json',
]
  .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
  .join('\n');

const used = new Set([
  ...[...sources.matchAll(/\bt\('([a-z0-9_]+)'\s*[,)]/g)].map((m) => m[1] as string),
  ...[...sources.matchAll(/data-i18n(?:-placeholder)?="([a-z0-9_]+)"/g)].map((m) => m[1] as string),
  ...[...sources.matchAll(/__MSG_([a-z0-9_]+)__/g)].map((m) => m[1] as string),
]);

test('every key used in the code exists in _locales', () => {
  for (const key of used) assert.ok(reference[key], `missing from _locales/en: ${key}`);
});

test('no orphan key in _locales', () => {
  // format_*, check_*, preset_* and section_* are resolved dynamically (t('format_' + format),
  // composed badge keys, template presets, sectionTitle() and its bare fallback): covered by the
  // dedicated tests above.
  const dynamic = (k: string) =>
    k.startsWith('format_') ||
    k.startsWith('check_') ||
    k.startsWith('preset_') ||
    /^section_[a-z]+(_[a-z]+)?$/.test(k);
  const orphans = Object.keys(reference).filter((k) => !dynamic(k) && !used.has(k));
  assert.deepEqual(orphans, []);
});
