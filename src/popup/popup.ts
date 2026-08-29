import { $, el } from '../lib/dom.ts';
import {
  channelFromPath,
  channelUrl,
  feedUrl,
  parseFeed,
  parseSubscriptions,
} from '../lib/feed.ts';
import { weakReasons } from '../lib/hardware.ts';
import {
  formatClock,
  formatDuration,
  readingSeconds,
  recordKey,
  searchRecords,
  sortRecords,
  totalSaved,
} from '../lib/history.ts';
import { t } from '../lib/i18n.ts';
import { getAllRecords, getFollows, getSettings, getTraces, setFollows } from '../lib/storage.ts';
import { PRESETS } from '../lib/summarize.ts';
import { channelMeta, ownerHandle, videoMeta } from '../lib/transcript.ts';
import type { Follow, Rec, Settings, Trace } from '../lib/types.ts';

const UNITS = { h: t('unit_h'), min: t('unit_min'), s: t('unit_s') };

for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]'))
  node.textContent = t(node.dataset.i18n ?? '');
for (const node of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
  node.placeholder = t(node.dataset.i18nPlaceholder ?? '');
}

let records: Rec[] = [];

// --- Tabs --------------------------------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(tab: Element): void {
  for (const other of tabs) {
    const on = other === tab;
    other.setAttribute('aria-selected', String(on));
    $(other.getAttribute('aria-controls') ?? '').hidden = !on;
  }
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => selectTab(tab));
});
// The worker opens popup.html#settings when an export hits an unconfigured vault.
if (location.hash === '#settings') selectTab($('tab-settings'));

// --- Counter -----------------------------------------------------------------

const timecode = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

// The total rolls up on open: the time comes back, it does not display. The only motion in the
// popup — everything else stays still.
function renderCounter() {
  const total = totalSaved(records);
  const out = $('total');
  // "04:22:36" reads as digits to a screen reader: it gets the duration spelled out.
  out.setAttribute('aria-label', formatDuration(total, UNITS));
  out.title = formatDuration(total, UNITS);
  $('count').textContent =
    records.length === 1 ? t('counter_count_one') : t('counter_count', records.length);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !total) {
    out.textContent = timecode(total);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / 700);
    out.textContent = timecode(total * (1 - (1 - p) ** 3)); // ease-out cubic
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// --- List --------------------------------------------------------------------

function renderList() {
  const query = $<HTMLInputElement>('search').value;
  const shown = searchRecords(records, query);
  const list = $('list');
  list.textContent = '';
  for (const record of shown) list.appendChild(row(record));

  // Nothing to search in an empty history: the field only shows from the first summary.
  const search = document.querySelector<HTMLElement>('.search');
  if (search) search.hidden = records.length === 0;

  const empty = $('empty');
  empty.hidden = shown.length > 0;
  empty.textContent = '';
  if (shown.length) return;
  if (records.length) {
    empty.textContent = t('empty_search', query.trim());
  } else {
    const title = document.createElement('strong');
    title.textContent = t('empty_title');
    empty.append(title, t('empty_body'));
  }
}

// A row is a link to the note: a full summary does not fit in 480 px. <a target="_blank"> rather
// than chrome.tabs.create — the native element also gives middle-click and cmd-click for free.
function row(record: Rec): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';

  const link = document.createElement('a');
  link.className = 'row';
  link.href = `../summary/summary.html?id=${encodeURIComponent(record.id)}`;
  link.target = '_blank';

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = record.title;

  // The real duration struck through, then the reading time: the extension's promise, quantified,
  // on one line. Without a known duration (text source) no arrow is invented.
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.append(record.author);
  if (record.seconds) {
    const struck = document.createElement('s');
    struck.textContent = formatClock(record.seconds);
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '\u2192';
    meta.append(' \u00b7 ', struck, arrow, formatClock(readingSeconds(record.summary)));
  }
  const out = document.createElement('span');
  out.className = 'out';
  out.textContent = '\u2197';
  meta.append(out);

  link.append(title, meta);

  // Outside the link: a <button> inside an <a> is invalid, and purging must not navigate.
  const forget = document.createElement('button');
  forget.className = 'forget';
  forget.textContent = '\u00d7';
  forget.title = t('row_forget');
  forget.setAttribute('aria-label', t('row_forget'));
  forget.addEventListener('click', () => remove(record, li));

  li.append(link, forget);
  return li;
}

async function remove(record: Rec, li: HTMLElement): Promise<void> {
  await chrome.storage.local.remove(recordKey(record.id));
  records = records.filter((r) => r.id !== record.id);
  li.remove();
  renderCounter();
  // Redraw only when the list must change state (empty, or search with nothing left).
  if (!records.length || !searchRecords(records, $<HTMLInputElement>('search').value).length)
    renderList();
}

$('search').addEventListener('input', renderList);

// --- Settings ----------------------------------------------------------------

// No language labels to maintain: Intl renders each language in its own. This list bounds the
// choice; 'auto' (Chrome's language) stays the default.
const TAGS = [
  'en',
  'fr',
  'es',
  'de',
  'it',
  'pt',
  'pt-BR',
  'nl',
  'pl',
  'sv',
  'uk',
  'ru',
  'tr',
  'ar',
  'hi',
  'id',
  'vi',
  'th',
  'ja',
  'ko',
  'zh-CN',
  'zh-TW',
];

const nativeName = (tag: string): string => {
  try {
    return new Intl.DisplayNames([tag], { type: 'language' }).of(tag) || tag;
  } catch {
    return tag;
  }
};

$('lang').append(
  new Option(t('settings_lang_auto'), 'auto'),
  ...TAGS.map((tag) => new Option(nativeName(tag), tag)),
);

// The checkboxes are excluded: this map drives the generic "read .value / write .value" loop.
const SETTINGS: Omit<Settings, 'debug' | 'prewarm'> = {
  lang: 'auto',
  preset: 'default',
  vault: '',
  folder: 'Youtube',
  autoExport: 'off',
  concurrency: 'auto',
  pollMinutes: '60',
};

$('preset').append(...Object.keys(PRESETS).map((name) => new Option(t(`preset_${name}`), name)));

let flashTimer: ReturnType<typeof setTimeout>;
function flash(message: string): void {
  clearTimeout(flashTimer);
  $('saved').textContent = message;
  flashTimer = setTimeout(() => ($('saved').textContent = ''), 1800);
}

// Save as you type, not on 'change': a popup closes as soon as it loses focus, before a text
// field ever emits 'change' — the input would be lost.
const timers: Record<string, ReturnType<typeof setTimeout>> = {};
for (const id of Object.keys(SETTINGS)) {
  $(id).addEventListener('input', () => {
    clearTimeout(timers[id]);
    timers[id] = setTimeout(async () => {
      await chrome.storage.sync.set({ [id]: $<HTMLInputElement>(id).value.trim() });
      flash(t('settings_saved'));
    }, 300);
  });
}

// --- Followed channels -------------------------------------------------------
// The channel page is fetched straight from here: the popup is an extension page, and the
// manifest now holds the youtube.com host permission, so no round trip through the worker.

let follows: Follow[] = [];

function renderFollows(): void {
  const list = $('follows');
  list.replaceChildren();
  $('follows-empty').hidden = follows.length > 0;
  for (const follow of follows) {
    const li = el('li', 'item');
    li.append(el('span', 'title', follow.name));

    const back = el('button', 'forget replay', '\u21ba') as HTMLButtonElement;
    back.type = 'button';
    back.title = t('follows_backfill', follow.name);
    back.setAttribute('aria-label', t('follows_backfill', follow.name));
    back.addEventListener('click', () => void backfill(follow, back));
    li.append(back);

    const forget = el('button', 'forget', '\u00d7');
    forget.setAttribute('type', 'button');
    forget.title = t('follows_remove', follow.name);
    forget.setAttribute('aria-label', t('follows_remove', follow.name));
    forget.addEventListener('click', async () => {
      follows = follows.filter((f) => f.id !== follow.id);
      await setFollows(follows);
      renderFollows();
    });
    li.append(forget);
    list.append(li);
  }
}

async function addFollow(): Promise<void> {
  const input = $<HTMLInputElement>('follow');
  const url = channelUrl(input.value);
  const msg = $('follow-msg');
  if (!url) {
    msg.textContent = t('follows_bad');
    return;
  }
  msg.textContent = t('follows_looking');
  const meta = await fetch(url)
    .then((r) => (r.ok ? r.text() : ''))
    .then(channelMeta)
    .catch(() => null);
  const id = meta?.channelExternalId;
  if (!id) {
    msg.textContent = t('follows_notfound');
    return;
  }
  if (follows.some((f) => f.id === id)) {
    msg.textContent = t('follows_already');
    return;
  }
  // `seen` is now, never the feed's oldest entry: following a channel must not summarize its
  // whole back catalogue.
  follows = [...follows, { id, name: meta.channelTitle ?? id, seen: new Date().toISOString() }];
  await setFollows(follows);
  input.value = '';
  msg.textContent = t('follows_added');
  renderFollows();
}

$('follow-add').addEventListener('click', () => void addFollow());
$('follow').addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') void addFollow();
});

// Backfill: the feed's own entries, minus what is already summarized. The watermark is left
// alone — it tracks what the poll has taken going forward, and catching up looks backwards.
// The feed caps itself at 15 entries, so there is no other bound to enforce.
async function backfill(follow: Follow, btn: HTMLButtonElement): Promise<void> {
  const msg = $('follow-msg');
  btn.disabled = true;
  msg.textContent = t('follows_looking');
  const entries = await fetch(feedUrl(follow.id))
    .then((r) => (r.ok ? r.text() : ''))
    .then(parseFeed)
    .catch(() => []);
  btn.disabled = false;
  const known = new Set(records.map((r) => r.id));
  const ids = entries.map((e) => e.v).filter((v) => !known.has(`yt:${v}`));
  if (!ids.length) {
    msg.textContent = t('follows_backfill_none');
    return;
  }
  // The worker owns the queue: it is the only context that survives this popup closing.
  chrome.runtime.sendMessage({ type: 'enqueue', ids });
  msg.textContent = t('follows_backfill_queued', ids.length);
}

// --- Subscriptions import ----------------------------------------------------
// No API and no OAuth: the subscriptions page carries them, and the popup's fetch goes out with
// the user's YouTube cookies (an extension request under a host permission is exempt from
// SameSite). Signed out, the page comes back without a single channel — hence the distinct
// message rather than a silent empty list.

let picked: { id: string; name: string }[] = [];

async function importSubs(): Promise<void> {
  const msg = $('follow-msg');
  msg.textContent = t('follows_import_looking');
  const html = await fetch('https://www.youtube.com/feed/channels', { credentials: 'include' })
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  const all = parseSubscriptions(html);
  const known = new Set(follows.map((f) => f.id));
  picked = all.filter((c) => !known.has(c.id));

  const list = $('subs');
  list.replaceChildren();
  list.hidden = picked.length === 0;
  $('subs-add').hidden = picked.length === 0;
  if (!picked.length) {
    msg.textContent = all.length ? t('follows_import_all') : t('follows_import_none');
    return;
  }
  msg.textContent = '';
  for (const channel of picked) {
    const li = el('li', 'item');
    const label = el('label', 'check');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.value = channel.id;
    label.append(box, el('span', null, channel.name));
    li.append(label);
    list.append(li);
  }
}

async function addSubs(): Promise<void> {
  const chosen = new Set(
    [...$('subs').querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value),
  );
  // Same rule as addFollow(): `seen` is now, so importing 40 channels does not queue 600 videos.
  const seen = new Date().toISOString();
  const added = picked.filter((c) => chosen.has(c.id)).map((c) => ({ ...c, seen }));
  follows = [...follows, ...added];
  await setFollows(follows);
  $('subs').replaceChildren();
  $('subs').hidden = true;
  $('subs-add').hidden = true;
  $('follow-msg').textContent = t('follows_import_done', added.length);
  renderFollows();
}

$('subs-import').addEventListener('click', () => void importSubs());
$('subs-add').addEventListener('click', () => void addSubs());

// The tab the popup opened over. A channel page names its channel in the path; a /watch page does
// not, and only the video's own HTML says whose it is. Prefilled, never followed: the user still
// has to click Follow.
async function prefillFollow(): Promise<void> {
  const input = $<HTMLInputElement>('follow');
  // tab.url is only populated because the manifest holds the youtube.com host permission; no
  // "tabs" permission, and nothing to read on any other site.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? '';
  const fromPath = channelFromPath(url);
  if (fromPath) {
    input.value = fromPath;
    return;
  }
  const v = /^https:\/\/(?:www\.)?youtube\.com\/watch\?.*\bv=([\w-]{11})/.exec(url)?.[1];
  if (!v) return;
  const html = await fetch(url)
    .then((r) => (r.ok ? r.text() : ''))
    .catch(() => '');
  // The handle when the page gives one, the UC id otherwise: channelUrl() takes both.
  const owner = ownerHandle(html) ?? videoMeta(html, v)?.channelId;
  if (owner && !input.value) input.value = owner; // the user may have typed during the fetch
}

$('clear').addEventListener('click', async () => {
  if (!records.length) return;
  if (!confirm(t('settings_clear_confirm', records.length))) return;
  await chrome.storage.local.remove(records.map((r) => recordKey(r.id)));
  records = [];
  renderCounter();
  renderList();
  flash(t('settings_saved'));
});

// --- Model status ------------------------------------------------------------

const line = (text: string, className?: string): HTMLElement => {
  const p = document.createElement('p');
  if (className) p.className = className;
  p.textContent = text;
  return p;
};

const statusButton = (label: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};

async function renderModelStatus() {
  const box = $('model');
  box.textContent = '';
  const reasons = weakReasons(navigator);
  const { availability } = (await chrome.runtime
    .sendMessage({ type: 'modelStatus' })
    .catch(() => ({}))) as { availability?: Availability };

  if (availability === 'available') {
    if (reasons.length) {
      const detail = reasons
        .map((r) =>
          r === 'memory'
            ? t('model_weak_memory', navigator.deviceMemory)
            : t('model_weak_cores', navigator.hardwareConcurrency),
        )
        .join(', ');
      box.append(
        line(t('model_weak', detail)),
        statusButton(t('model_enable_anyway'), () => enableModel('modelEnableAnyway')),
      );
    } else {
      box.append(line(t('model_ok'), 'status-ok'));
    }
    box.append(statusButton(t('model_recheck'), () => renderModelStatus()));
    return;
  }
  if (availability === 'downloadable' || availability === 'downloading') {
    box.append(line(t('model_not_ready'), 'status-warn'), line(t('model_downloadable')));
    const download = statusButton(t('model_download'), () => enableModel('modelDownload'));
    if (availability === 'downloading') download.disabled = true;
    box.append(
      download,
      statusButton(t('model_recheck'), () => renderModelStatus()),
    );
    return;
  }
  box.append(line(t('model_unavailable_body'), 'status-warn'), line(t('model_reco')));
  box.append(statusButton(t('model_enable_anyway'), () => enableModel('modelEnableAnyway')));
  box.append(statusButton(t('model_recheck'), () => renderModelStatus()));
}

async function enableModel(type: string): Promise<void> {
  await chrome.runtime.sendMessage({ type });
  renderModelStatus();
}

// --- Debug traces ------------------------------------------------------------

// Phase headers reuse the step labels: one translation for the button and the table.
function runDetails(run: Trace): HTMLElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.append(
    el('span', 'dbg-title', run.title),
    ' · ',
    el('span', 'dbg-when', new Date(run.at).toLocaleString()),
  );
  details.append(summary);
  const table = document.createElement('table');
  const rows = [
    [t('step_transcript'), run.transcriptMs],
    [t('step_prepare'), run.prepare],
    [t('step_frame'), run.frame],
    [t('step_analyze'), run.analyze, run.chunkCount != null ? `×${run.chunkCount}` : ''],
    [t('step_synthesis'), run.synthesis],
    [t('step_check'), run.check],
    [t('debug_endtoend'), run.endToEndMs],
  ];
  for (const [label, ms, extra] of rows) {
    const tr = document.createElement('tr');
    tr.append(
      el('td', null, String(label)),
      el('td', null, `${ms ?? '—'} ms${extra ? ` (${extra})` : ''}`),
    );
    table.append(tr);
  }
  if (run.duration) {
    const tr = document.createElement('tr');
    tr.append(el('td', null, t('debug_video')), el('td', null, formatClock(run.duration)));
    table.append(tr);
  }
  // How full the synthesis session was when it decoded: a window at its ceiling cuts the output
  // for a reason that has nothing to do with sampling.
  if (run.quota) {
    const tr = document.createElement('tr');
    tr.append(el('td', null, t('debug_quota')), el('td', null, `${run.usage} / ${run.quota}`));
    table.append(tr);
  }
  details.append(table);
  if (run.raw) details.append(rawOutput(run.raw));
  return details;
}

// The synthesis output before cleanSummary(). A summary ending mid-sentence is either the model
// closing the JSON string early, or DEGENERATE stripping a degenerate tail — this is the only
// place the two look different. textContent, never innerHTML: the model wrote this.
function rawOutput(raw: string): HTMLElement {
  const box = document.createElement('details');
  box.className = 'dbg-raw';
  box.append(el('summary', null, t('debug_raw')), el('pre', null, raw));
  return box;
}

async function clearDebug() {
  await chrome.storage.local.remove('debugLog');
  renderDebug();
}

async function renderDebug() {
  const box = $('debug-log');
  box.hidden = !$<HTMLInputElement>('debug').checked;
  if (box.hidden) return;
  box.textContent = '';
  const debugLog = await getTraces();
  if (!debugLog.length) {
    box.append(line(t('debug_empty'), 'status-warn'));
    return;
  }
  for (const run of debugLog.slice().reverse()) box.append(runDetails(run));
  box.append(statusButton(t('debug_clear'), clearDebug));
}

$('debug').addEventListener('change', async () => {
  await chrome.storage.sync.set({ debug: $<HTMLInputElement>('debug').checked });
  flash(t('settings_saved'));
  renderDebug();
});

// Hand crank for the poller: runs a poll and a queue step now instead of at the next alarm.
// The worker answers with what is left waiting, which is the only observable a poll has.
$('fire').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'pollNow' }, (res: { queued?: number } | undefined) => {
    flash(t('debug_fire_done', res?.queued ?? 0));
  });
});

$('prewarm').addEventListener('change', async () => {
  await chrome.storage.sync.set({ prewarm: $<HTMLInputElement>('prewarm').checked });
  flash(t('settings_saved'));
});

// --- Boot --------------------------------------------------------------------

const settings = await getSettings(SETTINGS);
for (const [id, value] of Object.entries(settings)) $<HTMLInputElement>(id).value = value;
const { debug, prewarm } = await getSettings({ debug: false, prewarm: true });
$<HTMLInputElement>('debug').checked = debug;
$<HTMLInputElement>('prewarm').checked = prewarm;

records = sortRecords(await getAllRecords());
renderCounter();
renderList();
renderModelStatus();
renderDebug();

follows = await getFollows();
renderFollows();
prefillFollow();
