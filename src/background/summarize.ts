import type { Checks, Format, Meta, Phase, Preset, ToWorker } from '../lib/types.ts';

interface Perf {
  chunkMs: number[];
  chunkCount: number;
  passes: number;
}

import { defaultLanes } from '../lib/hardware.ts';
import { phasePct } from '../lib/perf.ts';
import { pool } from '../lib/pool.ts';
import { getSettings } from '../lib/storage.ts';
import {
  CHECK_SCHEMA,
  checkPrompt,
  chunkPrompt,
  cleanSummary,
  FORMAT_SCHEMA,
  finalPrompt,
  foldToFit,
  formatPrompt,
  notesSchema,
  SUMMARY_SCHEMA,
  systemPrompt,
} from '../lib/summarize.ts';

// Measured: Nano does overlap prompts, sublinearly. The user can override the hardware default
// from the settings — the ceiling is theirs to find, not ours to guess.
const lanes = async (): Promise<number> => {
  const { concurrency } = await getSettings({ concurrency: 'auto' as const });
  return concurrency === 'auto' ? defaultLanes(navigator) : Number(concurrency);
};

const t = (key: string, ...args: unknown[]): string =>
  chrome.i18n.getMessage(key, args.map(String));

// --- Model availability ------------------------------------------------------
// The button is only injected once this promise resolves to 'available': the download (several
// GB) happens in the background, off the summarize path. Memoized so that N YouTube tabs
// trigger one download.

let ready: Promise<'available' | 'unavailable'> | null = null;

export function ensureModel() {
  ready ??= (async () => {
    const availability = await LanguageModel.availability();
    // Thrown, not returned: the catch below clears the memo. "Download" or "Enable anyway" can
    // make the model appear, and the next connect has to see it rather than a frozen verdict.
    if (availability === 'unavailable') throw new Error('unavailable');
    if (availability !== 'available') {
      const session = await LanguageModel.create(); // triggers the download
      session.destroy(); // the downloaded model stays on disk
    }
    return 'available' as const;
  })().catch(() => {
    ready = null;
    return 'unavailable' as const;
  });
  return ready;
}

// `prepare` is ~30% of a run and does no work: it waits for Chrome to page the weights in. They
// stay in memory as long as a session is alive, so this one holds nothing but that residency —
// a run still creates its own session, with its own system prompt, it just no longer waits for
// the load. Idle memory is the price, hence the setting that turns it off.
// The promise itself is what keeps the session referenced — dropping the handle would let it be
// collected, and the weights with it.
let anchor: Promise<LanguageModel | null> | null = null;

export function prewarm(): Promise<unknown> {
  anchor ??= (async () => {
    if ((await ensureModel()) === 'unavailable') return null;
    return LanguageModel.create();
  })().catch(() => {
    anchor = null;
    return null;
  });
  return anchor;
}

// Read-only availability for the popup's status card: querying must not trigger a download.
export function modelAvailability(): Promise<Availability> {
  if (typeof LanguageModel === 'undefined') return Promise.resolve('unavailable');
  return LanguageModel.availability();
}

export async function downloadModel(): Promise<Availability> {
  const session = await LanguageModel.create();
  session.destroy();
  return 'available';
}

// "Enable anyway": the machine may be below the recommendation, or Chrome's availability check
// conservative — attempt a real session and report the outcome.
export async function tryEnableModel(): Promise<Availability> {
  const availability = await modelAvailability();
  if (availability === 'available') return availability;
  try {
    const session = await LanguageModel.create();
    session.destroy();
    return 'available';
  } catch {
    return availability;
  }
}

// --- Summarize ---------------------------------------------------------------

export function acceptSummarize(port: chrome.runtime.Port): void {
  // Assigned synchronously inside the executor, before any listener can fire.
  let sendTranscript!: (t: string) => void;
  const transcript = new Promise<string>((resolve) => {
    sendTranscript = resolve;
  });
  const live = { ok: true };
  // A run lasts minutes and Chrome kills an idle service worker after 30 s. The ping has to come
  // from here: the same timer in the content script is throttled to once a minute once the tab has
  // been hidden for five — which is exactly when a long run dies. Any extension API call resets
  // the idle timer.
  const keepalive = setInterval(() => chrome.runtime.getPlatformInfo(), 20_000);
  port.onDisconnect.addListener(() => {
    live.ok = false;
    clearInterval(keepalive);
  });
  port.onMessage.addListener((msg: ToWorker) => {
    if (msg.type === 'warm') {
      summarize(msg.lang, msg.preset, msg.meta, transcript, port, live).catch(
        (e: unknown) =>
          live.ok &&
          port.postMessage({
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          }),
      );
    }
    if (msg.type === 'transcript') sendTranscript(msg.transcript);
  });
}

async function summarize(
  lang: string,
  preset: Preset,
  meta: Meta | null,
  transcriptPromise: Promise<string>,
  port: chrome.runtime.Port,
  live: { ok: boolean },
): Promise<void> {
  if ((await ensureModel()) === 'unavailable') {
    port.postMessage({ type: 'error', message: t('error_model_unavailable') });
    return;
  }
  // ensureModel() guarantees the model is on disk: what follows loads a session, it downloads
  // nothing. The monitor only covers the case where the service worker was killed mid-download
  // and restarted here.
  port.postMessage({ type: 'progress', step: t('step_prepare'), pct: phasePct('prepare') });
  const perf: Perf = { chunkMs: [], chunkCount: 0, passes: 0 };
  const wall: Partial<Record<Phase, number>> = {};
  const t0 = performance.now();
  let mark = t0;
  const checkpoint = (name: Phase) => {
    const now = performance.now();
    wall[name] = Math.round(now - mark);
    mark = now;
  };
  // Phases that no longer end where the next one starts need their own clock.
  const timed = async <T>(name: Phase, run: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await run();
    } finally {
      wall[name] = Math.round(performance.now() - start);
    }
  };
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: systemPrompt(lang, meta, preset) }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) =>
        port.postMessage({ type: 'download', loaded: e.loaded }),
      );
    },
  });
  checkpoint('prepare');
  try {
    const transcript = await transcriptPromise;
    if (!live.ok) return; // transcript failed or a navigation closed the port

    port.postMessage({ type: 'progress', step: t('step_frame'), pct: phasePct('frame') });
    const format = await detectFormat(session, transcript);
    checkpoint('frame');

    const size = await chunkSize(session, transcript, format, preset, lang);
    const width = await lanes();
    const material = await foldToFit(transcript, size, (parts) =>
      mapChunks(session, parts, port, format, preset, perf, width),
    );
    checkpoint('analyze');

    port.postMessage({ type: 'progress', step: t('step_synthesis'), pct: phasePct('synthesis') });
    const finalSession = await session.clone();
    try {
      // The checks do not read the summary: two clones over the same material, so they run
      // together instead of one after the other.
      const synthesis = timed('synthesis', () =>
        finalSession.prompt(finalPrompt(material, format, preset, lang), {
          responseConstraint: SUMMARY_SCHEMA,
        }),
      ).then((json) => {
        // The checks are still running: the gauge moves on as soon as the summary is out.
        if (live.ok)
          port.postMessage({ type: 'progress', step: t('step_check'), pct: phasePct('check') });
        return json;
      });
      const [json, checks] = await Promise.all([
        synthesis,
        timed('check', () => runChecks(session, material, lang)),
      ]);
      if (live.ok)
        port.postMessage({
          type: 'done',
          summary: cleanSummary(JSON.parse(json)),
          format,
          checks,
          timings: {
            ...wall,
            chunkMs: perf.chunkMs,
            chunkCount: perf.chunkCount,
            passes: perf.passes,
            workerMs: Math.round(performance.now() - t0),
          },
        });
    } finally {
      finalSession.destroy();
    }
  } finally {
    session.destroy();
  }
}

// The frame decides everything else: without it a sketches video is summarized like a report and
// fiction comes out as facts. A failed classification must not cost the summary — fall back to
// 'essay', the previous behavior.
async function detectFormat(session: LanguageModel, transcript: string): Promise<Format> {
  const s = await session.clone();
  try {
    const json = await s.prompt(formatPrompt(transcript.slice(0, 1500)), {
      responseConstraint: FORMAT_SCHEMA,
    });
    return JSON.parse(json).format as Format;
  } catch {
    return 'essay';
  } finally {
    s.destroy();
  }
}

// The checks are a bonus: they run after the summary, on the already-folded material (a bounded
// input), and a failure returns null — the summary itself is already computed.
async function runChecks(
  session: LanguageModel,
  material: string,
  lang: string,
): Promise<Checks | null> {
  const s = await session.clone();
  try {
    const json = await s.prompt(checkPrompt(material, lang), { responseConstraint: CHECK_SCHEMA });
    return JSON.parse(json) as Checks;
  } catch {
    return null;
  } finally {
    s.destroy();
  }
}

async function mapChunks(
  session: LanguageModel,
  chunks: string[],
  port: chrome.runtime.Port,
  format: Format,
  preset: Preset,
  perf: Perf,
  width: number,
): Promise<string[]> {
  perf.passes += 1;
  // Depends on the chunk count, not on the chunk: built once for the whole pass. On a refold the
  // parts are few, notesPerChunk rises, and the material compresses instead of holding steady.
  const constraint = notesSchema(chunks.length);
  let done = 0;
  return pool(chunks, width, async (chunk) => {
    const s = await session.clone(); // clean context per chunk, keeps the system prompt
    const c0 = performance.now();
    try {
      const json = await s.prompt(chunkPrompt(chunk, format, preset), {
        responseConstraint: constraint,
      });
      return (JSON.parse(json).notes as string[]).map((n) => `- ${n}`).join('\n');
    } finally {
      s.destroy();
      perf.chunkMs.push(Math.round(performance.now() - c0));
      perf.chunkCount += 1;
      port.postMessage({
        type: 'progress',
        step: t('step_analyze', ++done, chunks.length),
        pct: phasePct('analyze', done, chunks.length),
      });
    }
  });
}

// The model must hold the input AND its answer in the same window: a chunk sized to the quota
// makes prompt() fail on "response size exceeded". OUTPUT_SHARE of the quota is reserved for the
// output (chunk notes, or the final JSON bounded to ~1500 tokens by the schema).
const OUTPUT_SHARE = 0.4;

// The chunk count dominates the total time: measure it rather than estimating 4 chars/token with
// a safety margin that doubles the passes.
async function chunkSize(
  session: LanguageModel,
  transcript: string,
  format: Format,
  preset: Preset,
  lang: string,
): Promise<number> {
  const quota = session.inputQuota - (session.inputUsage ?? 0); // the system prompt already eats into it
  // Clamped: a large context block against a small quota drives this negative, and a chunk size
  // <= 0 makes splitTranscript loop forever.
  if (!session.measureInputUsage)
    return Math.max(1, Math.floor(quota * 4 * 0.5 * (1 - OUTPUT_SHARE)));
  const sample = transcript.slice(0, 2000);
  const perChar = (await session.measureInputUsage(sample)) / sample.length;
  // The material passes through both prompts: size on the greedier of the two.
  const overhead = Math.max(
    await session.measureInputUsage(chunkPrompt('', format, preset)),
    await session.measureInputUsage(finalPrompt('', format, preset, lang)),
  );
  return Math.max(1, Math.floor(((quota - overhead - 128) / perChar) * (1 - OUTPUT_SHARE)));
}
