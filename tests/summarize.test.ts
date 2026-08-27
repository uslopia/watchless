import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHECK_SCHEMA,
  CHECKS,
  checkBadges,
  checkPrompt,
  chunkPrompt,
  cleanSummary,
  contextBlock,
  FORMAT_SCHEMA,
  FORMATS,
  finalPrompt,
  foldToFit,
  languageName,
  NOTE_BUDGET,
  notesPerChunk,
  notesSchema,
  SUMMARY_SCHEMA,
  splitTranscript,
  systemPrompt,
} from '../src/lib/summarize.ts';
import type { Format, Preset } from '../src/lib/types.ts';

test('short text: a single chunk', () => {
  assert.deepEqual(splitTranscript('Une phrase.', 100), ['Une phrase.']);
});

test('splits on a sentence boundary', () => {
  const text = `${'A'.repeat(50)}. ${'B'.repeat(50)}.`;
  const chunks = splitTranscript(text, 60);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0]?.endsWith('.'));
  assert.ok(chunks[1]?.startsWith('B'));
});

test('no sentence boundary: hard cut without losing text', () => {
  const chunks = splitTranscript('X'.repeat(150), 60);
  assert.ok(chunks.every((c) => c.length <= 60));
  assert.equal(chunks.join(''), 'X'.repeat(150));
});

test('the schema requires tldr, idees, tags', () => {
  assert.deepEqual(SUMMARY_SCHEMA.required, ['tldr', 'idees', 'tags']);
});

test('notesPerChunk: the budget is split across the chunks', () => {
  assert.equal(notesPerChunk(7), 9);
  assert.equal(notesPerChunk(1), 12); // ceiling: a short video gets no bloated note
  assert.equal(notesPerChunk(30), 3); // floor: every chunk still says something
});

// The invariant the whole gain rests on: total generation stays bounded whatever the duration.
test('notesPerChunk: the total stays around the budget', () => {
  for (let chunks = 1; chunks <= 20; chunks++) {
    const total = notesPerChunk(chunks) * chunks;
    assert.ok(total <= NOTE_BUDGET + 12, `${chunks} chunks -> ${total} notes`);
  }
});

test('notesSchema carries the per-chunk cap', () => {
  assert.equal(notesSchema(7).properties.notes.maxItems, 9);
});

test('foldToFit: short material, no pass', async () => {
  let calls = 0;
  assert.equal(
    await foldToFit('court', 100, (p) => {
      calls++;
      return p;
    }),
    'court',
  );
  assert.equal(calls, 0);
});

test('foldToFit: refolds until it fits', async () => {
  let calls = 0;
  const out = await foldToFit('X'.repeat(400), 100, (parts) => {
    calls++;
    return parts.map((p) => p.slice(0, p.length / 4)); // the model compresses x4
  });
  assert.ok(out.length <= 100);
  assert.equal(calls, 2);
});

test('foldToFit: a model that does not compress -> bounded and truncated', async () => {
  let calls = 0;
  const out = await foldToFit('X'.repeat(400), 100, (parts) => {
    calls++;
    return parts;
  });
  assert.equal(out.length, 100);
  assert.equal(calls, 4);
});

const META = {
  title: 'Les flics',
  channel: 'Palmashow',
  category: 'Comedy',
  keywords: ['flics', 'humour'],
};

test('languageName: BCP-47 tag -> English name', () => {
  assert.equal(languageName('fr-FR'), 'French');
  assert.equal(languageName('ja'), 'Japanese');
});

test('languageName: invalid tag -> English', () => {
  assert.equal(languageName(''), 'English');
  assert.equal(languageName(undefined), 'English');
});

test('contextBlock: omits empty fields', () => {
  const block = contextBlock({ title: 'Les flics', channel: '', keywords: [] });
  assert.match(block, /- Title: Les flics/);
  assert.doesNotMatch(block, /Channel|Keywords/);
});

test('contextBlock: description flattened and truncated', () => {
  const block = contextBlock({ description: `a\n\nb ${'X'.repeat(500)}` });
  const line = block.split('\n').find((l) => l.startsWith('- Description'));
  assert.ok((line ?? '').length < 430, String(line?.length));
  assert.ok(line?.startsWith('- Description: a b XXX'));
  assert.ok(line?.endsWith('…'));
});

test('contextBlock: channel metadata', () => {
  const block = contextBlock({
    channelKeywords: ['humour', 'sketch'],
    channelDescription: 'Sketches',
  });
  assert.match(block, /- Channel keywords: humour, sketch/);
  assert.match(block, /- Channel description: Sketches/);
});

test('contextBlock: no channel lines when the fetch failed', () => {
  assert.doesNotMatch(contextBlock({ title: 'Les flics' }), /Channel keywords|Channel description/);
});

test('contextBlock: no metadata -> empty', () => {
  assert.equal(contextBlock(null), '');
  assert.equal(contextBlock({}), '');
});

test('systemPrompt: output language + context', () => {
  const p = systemPrompt('fr-FR', META);
  assert.match(p, /Write every value in French\./);
  assert.match(p, /YouTube category: Comedy/);
});

test('systemPrompt: without metadata, the rules stay', () => {
  const p = systemPrompt('en', null);
  assert.match(p, /Write every value in English\./);
  assert.doesNotMatch(p, /About this video/);
});

test('finalPrompt: the comedy format forbids reporting fiction as facts', () => {
  const p = finalPrompt('MATERIAU', 'comedy', 'default', 'fr');
  assert.match(p, /comedy or fiction/);
  assert.match(p, /Never present anything said in it as a fact/);
  assert.match(p, /Write every value in French\./);
  assert.match(p, /MATERIAU/);
});

test('finalPrompt: unknown format -> essay', () => {
  assert.equal(
    finalPrompt('M', 'nawak' as Format, 'en' as Preset),
    finalPrompt('M', 'essay', 'en' as Preset),
  );
  assert.equal(
    finalPrompt('M', undefined, 'en' as Preset),
    finalPrompt('M', 'essay', 'en' as Preset),
  );
});

test('chunkPrompt: the instruction follows the format', () => {
  assert.match(chunkPrompt('EXTRAIT', 'comedy'), /PERFORMED, not reported/);
  assert.match(chunkPrompt('EXTRAIT', 'comedy'), /EXTRAIT/);
  assert.equal(chunkPrompt('E', 'nawak' as Format), chunkPrompt('E', 'essay'));
});

test('FORMAT_SCHEMA: the enum covers exactly the known formats', () => {
  assert.deepEqual(FORMAT_SCHEMA.properties.format.enum, Object.keys(FORMATS));
  assert.ok(FORMATS.essay, 'essay is the fallback, it must exist');
});

test('checkPrompt: names the output language and carries the material', () => {
  const p = checkPrompt('MATERIAU', 'fr');
  assert.match(p, /one sentence in French/);
  assert.match(p, /MATERIAU/);
});

test('CHECK_SCHEMA: the enums follow CHECKS', () => {
  assert.deepEqual(CHECK_SCHEMA.properties.promise.enum, CHECKS.promise);
  assert.deepEqual(CHECK_SCHEMA.properties.sources.enum, CHECKS.sources);
});

test('checkBadges: nothing to flag is still a result, not an absence', () => {
  assert.deepEqual(checkBadges(null, 'essay'), []); // no checks at all: no line
  assert.deepEqual(checkBadges({ promise: 'kept', sources: 'cited', sponsor: '' }, 'essay'), [
    { key: 'check_clean' },
  ]);
});

test('checkBadges: one badge per notable check', () => {
  assert.deepEqual(checkBadges({ promise: 'stretched', sources: 'vague', sponsor: '' }, 'essay'), [
    { key: 'check_promise_stretched' },
    { key: 'check_sources_vague' },
  ]);
});

test('checkBadges: sourcing does not apply to sketches or vlogs', () => {
  const checks = { promise: 'kept', sources: 'none', sponsor: '' };
  assert.deepEqual(checkBadges(checks, 'comedy'), [{ key: 'check_clean' }]);
  assert.deepEqual(checkBadges(checks, 'vlog'), [{ key: 'check_clean' }]);
  assert.deepEqual(checkBadges(checks, 'essay'), [{ key: 'check_sources_none' }]);
});

test('checkBadges: a named sponsor replaces the disclosure, more precise than it', () => {
  const base = { promise: 'kept', sources: 'cited' };
  assert.deepEqual(checkBadges({ ...base, sponsor: 'MSI', paid: true }, 'essay'), [
    { key: 'check_sponsor', arg: 'MSI' },
  ]);
  assert.deepEqual(checkBadges({ ...base, sponsor: '', paid: true }, 'essay'), [
    { key: 'check_paid' },
  ]);
});

// The model ran out of array slots and kept decoding inside the last entry: it comes back ending
// on a run of quotes and commas, cut mid-run by maxLength.
test('cleanSummary: strips the tail left by a saturated array', () => {
  const junk = 'Plus de 77% des Français soutiennent les assemblées. ”,”, “ ”, “ ”, “ ”.”, “ ”.”';
  assert.equal(
    cleanSummary({ tldr: 'x', idees: [junk], tags: [] }).idees[0],
    'Plus de 77% des Français soutiennent les assemblées.',
  );
});

test('cleanSummary: a normal ending is left alone', () => {
  const summary = {
    tldr: 'Ce que dit la vidéo... et pourquoi !',
    idees: ['Une idée (avec une parenthèse).', 'Une autre — avec un tiret ?'],
    tags: ['climat', 'énergie'],
  };
  assert.deepEqual(cleanSummary(summary), summary);
});

test('cleanSummary: an entry that was nothing but noise is dropped', () => {
  assert.deepEqual(cleanSummary({ tldr: 'x', idees: ['ok', '”, “ ”, “ ”, “ ”'], tags: [] }).idees, [
    'ok',
  ]);
});
