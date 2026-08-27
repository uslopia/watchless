import { downloadMarkdown, obsidianUri } from '../lib/export.ts';
import { prune, recordKey, toNoteMeta } from '../lib/history.ts';
import { sectionTitle, t } from '../lib/i18n.ts';
import { buildNote } from '../lib/note.ts';
import { appendTrace, phasePct } from '../lib/perf.ts';
import { getAllRecords, getRecord, getSettings } from '../lib/storage.ts';
import type { FromWorker, Handlers, Meta, Rec, Summary, Trace } from '../lib/types.ts';
import {
  fail,
  addButton as mountButton,
  render,
  renderActions,
  restoreVideo,
  setBtn,
} from './panel.ts';
import { fetchTranscript, getMeta, resetPage, scrapeTranscript } from './scrape.ts';
import { reset, state } from './state.ts';
import { videoId } from './util.ts';

document.addEventListener('yt-navigate-finish', init);
init();

function init() {
  reset(); // a running summary was aimed at the previous video
  document.getElementById('watchless-btn')?.remove();
  restoreVideo();
  resetPage(); // releases the retained HTML (~1.5 MB)

  // Extension reloaded or updated: this script is orphaned and every chrome.* call throws
  // "Extension context invalidated". The teardown above already removed the button and the
  // panel, so unhooking here leaves nothing behind — the new script only reaches this tab
  // after a page reload.
  if (!chrome.runtime?.id) {
    document.removeEventListener('yt-navigate-finish', init);
    return;
  }
  if (!location.pathname.startsWith('/watch')) return;

  // No button until the model is there. The port stays open: if a download is in progress, the
  // button appears when it finishes, without reloading.
  const modelPort = chrome.runtime.connect({ name: 'model' });
  state.modelPort = modelPort;
  modelPort.onMessage.addListener((msg) => {
    if (msg.state !== 'available') return;
    addButton();
    // Loading the weights is a third of a run and starts here rather than on the click. Costs
    // idle memory on every /watch page: the setting exists for machines that would rather not.
    getSettings({ prewarm: true }).then(
      ({ prewarm }) => prewarm && chrome.runtime.sendMessage({ type: 'prewarm' }),
    );
  });
  loadCached(videoId());
}

async function loadCached(v: string | null): Promise<void> {
  const record = await getRecord(recordKey(`yt:${v}`));
  if (!record || videoId() !== v) return; // navigation during the storage read
  state.record = record;
  state.summary = record.summary;
  state.format = record.format;
  state.checks = record.checks ?? null; // records predating checks have none
  setBtn('ready'); // no-op if the model has not rendered the button yet; addButton picks up the state
}

function addButton() {
  mountButton(() => (state.summary ? showSummary() : run()));
}

// Everything before the port is opened can still throw: chrome.storage on an orphaned context,
// runtime.connect on a reloaded extension, waitFor on a page that never renders. Without this the
// button stays disabled at "Transcript…" with nothing shown and the rejection goes unhandled.
async function run() {
  const v = videoId();
  try {
    await start(v);
  } catch (e) {
    if (videoId() !== v) return; // the failure belongs to a video the user has left
    state.port?.disconnect();
    state.port = null;
    fail(e instanceof Error ? e.message : String(e));
  }
}

async function start(v: string | null) {
  const { debug } = await getSettings({ debug: false });
  const t0 = performance.now();
  setBtn('busy', t('step_transcript'), phasePct('transcript', 1, 1));
  const meta = await getMeta(); // seconds: it refetches the page HTML
  // 'auto' = Chrome's language. Any BCP-47 tag passes: the prompt names the language.
  const { lang, preset } = await getSettings({ lang: 'auto', preset: 'default' });
  // A navigation in between already ran reset(); writing state here would resurrect this run on
  // the next video, and state.port being set after the reset means nothing would cancel it.
  if (videoId() !== v) return;
  const outputLang = lang === 'auto' ? chrome.i18n.getUILanguage() : lang;
  state.meta = meta;
  state.lang = outputLang;
  state.preset = preset;

  // Open the port first: the model load runs while the transcript is fetched.
  const port = chrome.runtime.connect({ name: 'summarize' });
  state.port = port;
  // The worker only closes the port after 'done', where we disconnect first — so a disconnect
  // reaching us means it died (service worker killed mid-run). Without this the button spins on
  // its last percentage forever, indistinguishable from a slow chunk.
  let step = 'transcript';
  port.onDisconnect.addListener(() => {
    if (state.port !== port) return;
    state.port = null;
    fail(t('error_interrupted'));
    if (debug) diagnose(step, Math.round(performance.now() - t0));
  });
  port.onMessage.addListener((msg: FromWorker) => {
    // Chrome emits downloadprogress at loaded:0 on every create() — showing it as a percentage
    // would look like a download that is not happening.
    if (msg.type === 'download' && msg.loaded > 0)
      setBtn('busy', t('step_download', Math.round(msg.loaded * 100)));
    if (msg.type === 'progress') {
      step = msg.step;
      setBtn('busy', msg.step, msg.pct);
    }
    if (msg.type === 'error') fail(msg.message);
    if (msg.type === 'done') {
      state.summary = msg.summary;
      state.format = msg.format;
      state.checks = msg.checks;
      const record = buildRecord(); // before render(): the panel's actions export from it
      state.record = record;
      port.disconnect();
      state.port = null;
      showSummary();
      // Passed by argument, not via state: these calls resume after an await, and a navigation
      // in between would have reset state.record to null.
      save(record); // background: a slow storage must not delay the display
      autoExport(record);
      if (debug)
        traceRun(msg, record, transcript, transcriptMs, Math.round(performance.now() - t0));
    }
  });
  port.postMessage({ type: 'warm', lang: outputLang, preset, meta: state.meta });

  const transcriptStart = performance.now();
  const transcript = (await fetchTranscript()) ?? (await scrapeTranscript());
  const transcriptMs = performance.now() - transcriptStart;
  port.postMessage({ type: 'transcript', transcript });
}

// A dead port looks the same from here whatever killed it. Asking the worker afterwards tells
// the three apart: an answer means it restarted (killed or crashed mid-run), a thrown
// "Extension context invalidated" means the extension was reloaded under the page.
async function diagnose(step: string, ms: number): Promise<void> {
  let worker: unknown;
  try {
    worker = await chrome.runtime.sendMessage({ type: 'modelStatus' });
  } catch (e) {
    worker = e instanceof Error ? e.message : String(e);
  }
  console.warn('[watchless] interrupted', { step, ms, worker });
}

function traceRun(
  done: Extract<FromWorker, { type: 'done' }>,
  record: Rec,
  transcript: string,
  transcriptMs: number,
  endToEndMs: number,
): Promise<unknown> {
  const trace: Trace = {
    at: Date.now(),
    title: record.title,
    duration: record.seconds,
    lang: record.lang,
    preset: record.preset ?? null,
    format: done.format,
    chars: transcript.length,
    transcriptMs: Math.round(transcriptMs),
    ...done.timings,
    endToEndMs,
  };
  console.log('[watchless]', trace);
  return appendTrace(trace).catch(() => {});
}

function showSummary() {
  render();
  renderActions(handlersFor(state.record as Rec));
}

function buildRecord(): Rec {
  // run() assigns state.meta before opening the port; the 'done' message cannot precede it.
  const { id, url, title, channel, seconds, published, keywords, paid } = state.meta as Meta;
  return {
    id,
    source: 'youtube',
    url,
    title,
    author: channel,
    seconds,
    words: null,
    published,
    keywords: keywords ?? null,
    capturedAt: Date.now(),
    lang: state.lang as string,
    format: state.format,
    preset: state.preset,
    summary: state.summary as Summary,
    checks: state.checks ? { ...state.checks, ...(paid == null ? {} : { paid }) } : null,
  };
}

async function save(record: Rec): Promise<void> {
  await chrome.storage.local.set({ [recordKey(record.id)]: record });

  // Read the whole store on every write. 500 records of ~2 KB, once per summary (about once a
  // minute at worst) — switch to an index if it ever becomes measurable.
  const dead = prune(await getAllRecords());
  if (dead.length) await chrome.storage.local.remove(dead.map(recordKey));
}

// From the record, not state.meta: a summary from the cache never scraped the page.
function note(record: Rec): string {
  return buildNote(toNoteMeta(record), record.summary, record.format, {
    tldr: sectionTitle('tldr', record.preset),
    ideas: sectionTitle('ideas', record.preset),
  });
}

async function exportToObsidian(record: Rec): Promise<void> {
  const { vault, folder } = await getSettings({ vault: '', folder: 'Youtube' });
  if (!vault) {
    chrome.runtime.sendMessage({ type: 'openOptions' });
    return;
  }
  location.href = obsidianUri(vault, folder, record.title, note(record));
}

function downloadNote(record: Rec): void {
  downloadMarkdown(record.title, note(record));
}

// After the display, never before. 'obsidian' triggers the browser's "Open Obsidian?" dialog on
// every summary — hence the 'off' default.
async function autoExport(record: Rec): Promise<void> {
  const { autoExport: target } = await getSettings({ autoExport: 'off' as const });
  if (target === 'obsidian') exportToObsidian(record);
  if (target === 'download') downloadNote(record);
}

function handlersFor(record: Rec): Handlers {
  return {
    // The full note lives in summary.html — exports, deletion and the link back to the video are
    // there. The panel only links to it, rather than mirroring every button.
    onNote: () =>
      chrome.runtime.sendMessage({
        type: 'openTab',
        url: chrome.runtime.getURL(`src/summary/summary.html?id=${encodeURIComponent(record.id)}`),
      }),
    onRedo: () => {
      state.summary = null;
      state.record = null;
      state.format = null;
      state.checks = null;
      state.preset = null;
      restoreVideo();
      run();
    },
  };
}
