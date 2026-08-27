import type {
  Badge,
  Checks,
  Format,
  FormatDef,
  Meta,
  Preset,
  PresetDef,
  Summary,
} from './types.ts';

export function splitTranscript(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf('. ', maxChars);
    if (cut < maxChars * 0.5)
      cut = maxChars; // no sentence boundary in range: hard cut
    else cut += 1;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// Prompts stay in English (the model is stronger there); the target language is named inside.
// Intl.DisplayNames avoids maintaining a language table: any BCP-47 tag becomes an English name.
export function languageName(tag: string | null | undefined): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(String(tag).split('-')[0] ?? 'en') ||
      'English'
    );
  } catch {
    return 'English';
  }
}

// --- Context ----------------------------------------------------------------
// Without these metadata the model only has the transcript: a sketches video reads as a string
// of claims and gets summarized like a report.

const CONTEXT_FIELDS: [string, (m: Partial<Meta>) => string | null | undefined][] = [
  ['Title', (m) => m.title],
  ['Channel', (m) => m.channel],
  // Filled by the channel for SEO: says what it is usually about, which one transcript does not.
  // ~250 chars paid per chunk (the system prompt is cloned): cut these two fields first if the
  // model's context window tightens.
  ['Channel keywords', (m) => m.channelKeywords?.join(', ')],
  ['Channel description', (m) => oneLine(m.channelDescription, 200)],
  ['YouTube category', (m) => m.category],
  ['Duration', (m) => m.duration],
  ['Keywords', (m) => m.keywords?.join(', ')],
  ['Description', (m) => oneLine(m.description, 400)],
];

function oneLine(s: string | null | undefined, max: number): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function contextBlock(meta: Partial<Meta> | null | undefined): string {
  if (!meta) return '';
  const lines = CONTEXT_FIELDS.map(([label, get]) => [label, get(meta)])
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  if (!lines.length) return '';
  return `About this video (YouTube metadata, NOT what is said in it):\n${lines.join('\n')}`;
}

// --- Formats -----------------------------------------------------------------

export const FORMATS = {
  essay: {
    chunk: 'List the claims, figures, names and dates it contains.',
    final: 'It argues or explains a point.',
  },
  comedy: {
    chunk:
      'This excerpt is PERFORMED, not reported. List the sketches, characters, running gags and punchlines. Never write them as facts.',
    final:
      'It is comedy or fiction. "tldr" says what the video IS — its format, what it parodies, its tone — not what it "claims". Each "idees" entry describes one sketch, bit or running gag. Never present anything said in it as a fact about the real world.',
  },
  tutorial: {
    chunk:
      'List the steps, prerequisites and pitfalls. Keep commands, settings and values exactly as spoken.',
    final:
      'It teaches how to do something. The "idees" are the steps in order, with their exact values.',
  },
  interview: {
    chunk: 'Attribute every statement to whoever makes it.',
    final: 'It is a conversation between several people. Each "idees" entry names who asserts it.',
  },
  news: {
    chunk:
      'List the facts, dates and sources. Keep what is established separate from what is speculated.',
    final:
      'It reports events. "tldr" is what happened; mark in the "idees" what is presented as uncertain.',
  },
  vlog: {
    chunk: 'List what happens, the decisions taken and how they turn out.',
    final:
      'It is a personal account. Report what happens — do not manufacture a thesis out of a story.',
  },
};

const format = (name: Format | null | undefined): FormatDef =>
  (name && FORMATS[name]) || FORMATS.essay;

// --- Presets -----------------------------------------------------------------
// A second axis, user-chosen: the format says what the video IS, the preset what to take from
// it. Both compose in the same prompts. `fields` carries the full definition of "tldr" and
// "idees" rather than an addendum: two conflicting length rules leave the model to arbitrate.

export const PRESETS = {
  default: {
    fields: `- "tldr": what the video is about, in 3 to 5 lines. Not a table of contents.
- "idees": 8 to 20 entries, one per idea. A single sentence of 25 words maximum per entry. Never several ideas in one entry: one more idea = one more entry.`,
  },
  triage: {
    final: 'The reader has not watched it and is deciding whether to.',
    fields: `- "tldr": a verdict in 3 lines — watch it in full, skim it, or skip it, and why. Judge what it delivers, not the subject it announces.
- "idees": 3 to 6 entries, one per thing the video actually delivers. These are what the verdict rests on.`,
  },
  action: {
    chunk: 'Keep the steps, tools, settings, commands and values exactly as spoken.',
    final: 'The reader wants what can be acted on, and nothing else.',
    fields: `- "tldr": what the reader will be able to do, in 2 to 4 lines. Say plainly that the video gives nothing to act on when it gives nothing — never invent steps to fill the list.
- "idees": 3 to 20 entries, one per step, tool, setting or recommendation, in the order given, with its exact value. Drop context, anecdotes and opinions.`,
  },
  quotes: {
    chunk:
      'Copy out the sentences worth quoting, word for word in the language spoken. Never paraphrase them.',
    final: 'The reader wants its own words, not a rewrite of them.',
    // Translating a quote is no longer quoting: this preset lifts the language rule, but for the
    // "idees" only — "tldr" and "tags" stay in the requested language.
    verbatim: true,
    fields: `- "tldr": what the video is about, in 3 to 5 lines.
- "idees": 3 to 20 entries, one sentence per entry, copied from the video word for word in the language spoken — never paraphrased, never translated. Pick the ones carrying a claim, a formula or a turn of phrase worth keeping.`,
  },
  figures: {
    chunk:
      'List every figure, date, study, document and named person, with what it is presented as proving.',
    final: 'The reader wants what the video puts forward as evidence.',
    fields: `- "tldr": what the video claims and what it leans on to claim it, in 3 to 5 lines. Say plainly that the video cites nothing when it cites nothing — never invent figures to fill the list.
- "idees": 3 to 20 entries, one per figure, date, study, document or named source, with what the video presents it as proving. No figure and no named source in an entry, no entry.`,
  },
};

const preset = (name: Preset | null | undefined): PresetDef =>
  (name && PRESETS[name]) || PRESETS.default;

// The same rule goes to the system and the final prompts: both must say the same thing, or the
// model follows whichever it reads last.
const languageRule = (lang: string | null | undefined, p: PresetDef): string =>
  p.verbatim
    ? `- Write in ${languageName(lang)}, except sentences copied from the video, which stay in the language spoken.`
    : `- Write every value in ${languageName(lang)}.`;

export const FORMAT_SCHEMA = {
  type: 'object',
  required: ['format'],
  additionalProperties: false,
  properties: { format: { type: 'string', enum: Object.keys(FORMATS) } },
};

// --- Prompts -----------------------------------------------------------------

export function systemPrompt(
  lang: string | null | undefined,
  meta: Partial<Meta> | null | undefined,
  presetName?: Preset | null,
): string {
  return [
    `You summarize YouTube video transcripts. Strict rules:
${languageRule(lang, preset(presetName))}
- Add nothing the video does not say: no outside knowledge, no conclusion its author does not draw.
- State each idea as an assertion, not as a topic.
- Keep figures, proper nouns, dates and examples.
- Drop what is purely oral: filler, repetitions, subscribe pleas.`,
    contextBlock(meta),
  ]
    .filter(Boolean)
    .join('\n\n');
}

// The context block is already in the session's system prompt: classification only needs the
// transcript opening.
export function formatPrompt(sample: string): string {
  return `Classify this video from its metadata above and the transcript opening below. Pick exactly one:
- comedy: sketches, parody, fiction, stand-up — what is said is performed, not asserted
- tutorial: teaches how to do something, steps, demo
- interview: two or more people, questions and answers, podcast
- news: reports events, facts, current affairs
- vlog: personal account, day in the life, travel, unboxing
- essay: argues or explains a point — use this when nothing else clearly fits

Transcript opening:
${sample}`;
}

export function chunkPrompt(
  chunk: string,
  formatName?: Format | null,
  presetName?: Preset | null,
): string {
  const extra = preset(presetName).chunk;
  return `Below is an excerpt from a video transcript. ${format(formatName).chunk}${extra ? ` ${extra}` : ''} One short sentence per entry, no paragraphs. Keep the most important ones.

${chunk}`;
}

export function finalPrompt(
  material: string,
  formatName: Format | null | undefined,
  presetName: Preset | null | undefined,
  lang?: string,
): string {
  const p = preset(presetName);
  return `Below is the material of a video (transcript or intermediate notes). ${format(formatName).final}${p.final ? ` ${p.final}` : ''}

Produce the final summary as JSON:
${p.fields}
- Cover all the material, from start to finish — the last notes count as much as the first.
- "tags": 2 to 4 topics, lowercase.
${languageRule(lang, p)}

${material}`;
}

export const SUMMARY_SCHEMA = {
  type: 'object',
  required: ['tldr', 'idees', 'tags'],
  additionalProperties: false,
  properties: {
    tldr: { type: 'string' },
    // A low maxItems makes the model cram the rest of the material into the last string instead
    // of opening a new entry; maxLength caps the block if it starts again.
    idees: { type: 'array', items: { type: 'string', maxLength: 240 }, minItems: 3, maxItems: 20 },
    tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
  },
};

// Constrained decoding degenerates at the array ceiling: maxItems reached, the model cannot open
// a new entry, so it keeps decoding inside the string it is already in until maxLength cuts it —
// the entry ends on a run of quotes and commas. maxLength bounds the damage; this removes it.
// A legitimate ending is one or two punctuation marks, never eight in a row.
// The captured group keeps the sentence's own full stop, which the run would otherwise swallow.
// Two shapes, because the run sometimes carries the schema back out with it
// (`.',  , 26, 240],  , 240],`): digits only count as text when nothing already ended the
// sentence, otherwise a figure at the very end of an entry would be read as noise.
const DEGENERATE = [/([.!?…])[^\p{L}]{8,}$/u, /([.!?…]?)[^\p{L}\p{N}]{8,}$/u];

const clean = (s: string): string => DEGENERATE.reduce((t, re) => t.replace(re, '$1'), s).trim();

export function cleanSummary(summary: Summary): Summary {
  return {
    tldr: clean(summary.tldr),
    idees: summary.idees.map(clean).filter(Boolean),
    tags: summary.tags.map(clean).filter(Boolean),
  };
}

// --- Chunk notes -------------------------------------------------------------
// Nano's decoding is what costs time; reading is comparatively free. Unbounded chunk notes
// therefore make a run grow with the video's length — for material the synthesis throws away: it
// keeps 8 to 20 ideas whatever the duration. One total budget split across the chunks keeps the
// analyze phase roughly constant, from a 10-minute video to a 3-hour one.
export const NOTE_BUDGET = 60;

// Ceiling and floor: a short video must not get a bloated note per chunk, a very long one must
// still say something per chunk. NOTE_BUDGET is the knob — raise it if the end of long videos
// comes out thinner than their start.
export const notesPerChunk = (chunks: number): number =>
  Math.min(12, Math.max(3, Math.round(NOTE_BUDGET / Math.max(1, chunks))));

// maxItems is what actually bounds the decoding: the API injects the constraint into the prompt,
// so the model reads the count from here — no number to keep in sync in chunkPrompt.
export const notesSchema = (chunks: number) => ({
  type: 'object',
  required: ['notes'],
  additionalProperties: false,
  properties: {
    notes: {
      type: 'array',
      items: { type: 'string', maxLength: 200 },
      minItems: 1,
      maxItems: notesPerChunk(chunks),
    },
  },
});

// --- Checks ------------------------------------------------------------------
// A separate pass, like format classification: a failed check must not cost the summary, and
// the final prompt is already at the edge of what Nano holds.
//
// No score out of 100: a single number from a small model is unverifiable noise. Three discrete
// checks and their justification can be challenged at a glance — which matters, since the
// subject is someone else's reliability.

export const CHECKS = {
  promise: ['kept', 'stretched', 'unrelated'],
  sources: ['cited', 'vague', 'none'],
};

export const CHECK_SCHEMA = {
  type: 'object',
  required: ['promise', 'sources', 'sponsor', 'why'],
  additionalProperties: false,
  properties: {
    promise: { type: 'string', enum: CHECKS.promise },
    sources: { type: 'string', enum: CHECKS.sources },
    // Empty string rather than a nullable enum, which the schema negotiates poorly.
    sponsor: { type: 'string', maxLength: 60 },
    why: { type: 'string', maxLength: 160 },
  },
};

// The title and description are in the session's system prompt: the check pass is cloned from it
// and refers to them, like formatPrompt.
export function checkPrompt(material: string, lang: string | null | undefined): string {
  return `Below is the material of the video described above (transcript or intermediate notes).
Judge the material, never its author. Report as JSON:

- "promise": does the material deliver what the Title above announces?
  kept — it delivers what the title announces
  stretched — it delivers less, later or narrower than the title announces
  unrelated — the title announces something the material never covers
- "sources": how does the material back its factual claims?
  cited — it names studies, documents, figures with an origin, or the people it quotes
  vague — it appeals to unnamed authority: "studies show", "experts say", "everybody knows"
  none — it asserts without any backing, or makes no factual claim at all
- "sponsor": the brand paying for this video, when the material or the Description above names
  one ("sponsored by", "thanks to X for supporting"). Empty string when none is named. The
  channel's own shop, its patrons and its long-standing partners are not this video's sponsor.
- "why": one sentence in ${languageName(lang)} justifying "promise" — what the title announces,
  and what the material actually delivers.

${material}`;
}

// Sourcing is meaningless for sketches and vlogs: what claims nothing has nothing to source.
const UNSOURCEABLE = new Set(['comedy', 'vlog']);

// One badge per notable check, as an i18n key: the lib stays pure, the caller translates.
// Nothing to flag is a result — without the neutral badge, "checked and clean" is
// indistinguishable from "not checked".
export function checkBadges(
  checks: Partial<Checks> | null | undefined,
  format?: Format | null,
): Badge[] {
  if (!checks) return [];
  const badges: Badge[] = [];
  if (checks.promise && checks.promise !== 'kept')
    badges.push({ key: `check_promise_${checks.promise}` });
  if (checks.sources && checks.sources !== 'cited' && !UNSOURCEABLE.has(format as string)) {
    badges.push({ key: `check_sources_${checks.sources}` });
  }
  // A named sponsor says everything the disclosure would, more precisely: one badge only.
  if (checks.sponsor) badges.push({ key: 'check_sponsor', arg: checks.sponsor });
  else if (checks.paid) badges.push({ key: 'check_paid' });
  return badges.length ? badges : [{ key: 'check_clean' }];
}

// The accumulated notes of a long video outgrow the model's window again and the final prompt
// fails on "response size exceeded": refold the material until it fits; if the model stops
// compressing, truncate rather than loop.
export async function foldToFit(
  material: string,
  size: number,
  map: (parts: string[]) => string[] | Promise<string[]>,
): Promise<string> {
  for (let i = 0; material.length > size && i < 4; i++) {
    material = (await map(splitTranscript(material, size))).join('\n');
  }
  return material.slice(0, size);
}
