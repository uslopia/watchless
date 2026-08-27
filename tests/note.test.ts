import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNote, sanitizeTitle } from '../src/lib/note.ts';

test('sanitizeTitle replaces / with -', () => {
  assert.equal(sanitizeTitle('AC/DC: le retour'), 'AC-DC: le retour');
});

test('buildNote produces escaped frontmatter + sections', () => {
  const note = buildNote(
    {
      title: 'Titre "quoté"',
      url: 'https://www.youtube.com/watch?v=x',
      channel: 'Chaîne "A"',
      duration: '12:34',
      published: '2026-01-02',
      captured: '2026-08-26',
    },
    { tldr: 'La thèse.', idees: ['Idée une.', 'Idée deux.'], tags: ['ia', 'agents'] },
  );
  assert.match(note, /^---\ntitle: "Titre \\"quoté\\""\n/);
  assert.match(note, /channel: "Chaîne \\"A\\""/);
  assert.match(note, /tags: \[youtube, ia, agents\]/);
  assert.match(note, /# Titre "quoté"/);
  assert.match(note, /## TL;DR\nLa thèse\./);
  assert.match(note, /## Key ideas\n- Idée une\.\n- Idée deux\.\n$/);
});

test('buildNote escapes backslashes before quotes', () => {
  const note = buildNote(
    {
      title: String.raw`¯\_(ツ)_/¯ C:\docs`,
      url: 'https://www.youtube.com/watch?v=x',
      channel: '',
      duration: '',
      published: '',
      captured: '2026-08-26',
    },
    { tldr: 'T', idees: [], tags: [] },
  );
  assert.match(note, /^---\ntitle: "¯\\\\_\(ツ\)_\/¯ C:\\\\docs"\n/);
});

test('buildNote: format and section labels overridable', () => {
  const note = buildNote(
    {
      title: 'T',
      url: 'u',
      channel: 'C',
      duration: '1:00',
      published: '2026-01-02',
      captured: '2026-08-26',
    },
    { tldr: 'Thesis.', idees: ['One.'], tags: ['ia'] },
    'comedy',
    { tldr: 'TL;DR', ideas: 'Key ideas' },
  );
  assert.match(note, /\nformat: comedy\ntags: \[youtube, ia\]/);
  assert.match(note, /## Key ideas\n- One\./);
});

test('buildNote: without a format, no format line', () => {
  const note = buildNote(
    {
      title: 'T',
      url: 'u',
      channel: 'C',
      duration: '1:00',
      published: '2026-01-02',
      captured: '2026-08-26',
    },
    { tldr: 'Thesis.', idees: ['One.'], tags: ['ia'] },
  );
  assert.doesNotMatch(note, /format:/);
  assert.match(note, /## Key ideas/); // English fallback when the caller passes no labels
});

test('buildNote: filled checks become frontmatter lines', () => {
  const note = buildNote(
    {
      title: 'T',
      url: 'u',
      channel: 'C',
      duration: '1:00',
      published: '2026-01-02',
      captured: '2026-08-26',
      checks: {
        promise: 'stretched',
        sources: 'none',
        sponsor: 'MSI "Gaming"',
        paid: true,
        why: 'peu importe',
      },
    },
    { tldr: 'Thesis.', idees: ['One.'], tags: ['ia'] },
    'essay',
  );
  assert.match(
    note,
    /\nformat: essay\npromise: stretched\nsources: none\nsponsor: "MSI \\"Gaming\\""\npaid: true\ntags: \[youtube, ia\]/,
  );
  assert.doesNotMatch(note, /why:/); // the justification is a sentence, it has no place in YAML
});

test('buildNote: a record from before checks keeps its shape', () => {
  const note = buildNote(
    {
      title: 'T',
      url: 'u',
      channel: 'C',
      duration: '1:00',
      published: '2026-01-02',
      captured: '2026-08-26',
    },
    { tldr: 'Thesis.', idees: ['One.'], tags: ['ia'] },
  );
  assert.match(note, /captured: 2026-08-26\ntags: \[youtube, ia\]/);
});

test('buildNote: absent sponsor -> no sponsor or paid line', () => {
  const note = buildNote(
    {
      title: 'T',
      url: 'u',
      channel: 'C',
      duration: '1:00',
      published: '2026-01-02',
      captured: '2026-08-26',
      checks: { promise: 'kept', sources: 'cited', sponsor: '', paid: false },
    },
    { tldr: 'Thesis.', idees: ['One.'], tags: ['ia'] },
  );
  assert.match(note, /promise: kept\nsources: cited\ntags:/);
  assert.doesNotMatch(note, /sponsor:|paid:/);
});
