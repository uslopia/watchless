import { $, el } from '../lib/dom.ts';
import { agentUri, downloadMarkdown, obsidianUri } from '../lib/export.ts';
import { formatClock, readingSeconds, recordKey, toNoteMeta } from '../lib/history.ts';
import { badgeText, t } from '../lib/i18n.ts';
import { buildNote } from '../lib/note.ts';
import { getRecord, getSettings } from '../lib/storage.ts';
import { checkBadges } from '../lib/summarize.ts';
import type { Checks, Rec } from '../lib/types.ts';

// Export feedback lives in the sticky action bar, not in the flow: on a note with twenty ideas
// a message left in the document would be off-screen when the button is clicked.
let feedback!: HTMLElement; // `status` would shadow window.status

// --- Render ------------------------------------------------------------------

function render(record: Rec): void {
  // The tab must stay identifiable in a crowded bar: the video's title, not "Watchless".
  document.title = record.title;

  const content = $('content');
  content.textContent = '';
  feedback = el('p', 'status');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  content.append(el('h1', null, record.title), metaLine(record), actions(record));

  content.append(el('h2', null, t('section_tldr')), el('p', 'tldr', record.summary.tldr));
  content.append(el('h2', null, t('section_ideas')));
  const ideas = el('ul', 'ideas');
  for (const idea of record.summary.idees) ideas.append(el('li', null, idea));
  content.append(ideas, el('p', 'tags', record.summary.tags.join(' · ')));
  content.append(...checkLine(record));
}

function checkLine(record: Rec): HTMLElement[] {
  const badges = checkBadges(record.checks, record.format);
  if (!badges.length) return [];
  const row = el('p', 'checks');
  for (const text of badgeText(badges)) row.append(el('span', null, text));
  // checkBadges() returns [] when checks is null, and the early return above caught that.
  const checks = record.checks as Checks;
  const why = checks.promise !== 'kept' && checks.why;
  return why ? [row, el('p', 'why', why)] : [row];
}

function metaLine(record: Rec): HTMLElement {
  const meta = el('p', 'meta');
  meta.append(record.author);
  if (record.seconds) {
    meta.append(
      el('span', 'sep', '·'),
      el('s', null, formatClock(record.seconds)),
      el('span', 'arrow', '→'),
      formatClock(readingSeconds(record.summary)),
    );
  }
  meta.append(
    el('span', 'sep', '·'),
    t('summary_captured', new Date(record.capturedAt).toLocaleDateString()),
  );
  // raw slug as a fallback: an untranslated format beats an empty pill
  const format = record.format && (t(`format_${record.format}`) || record.format);
  if (format) meta.append(el('span', 'sep', '·'), format);
  return meta;
}

function actions(record: Rec): HTMLElement {
  const bar = el('div', 'actions');
  const inner = el('div', 'inner');
  const left = el('div', 'group');
  left.append(
    button(t('btn_copy'), ICONS.copy, (label) => {
      void navigator.clipboard.writeText(note(record)).then(() => {
        label.textContent = t('btn_copied');
      });
    }),
    button(t('btn_download'), ICONS.download, () => downloadMarkdown(record.title, note(record))),
    button(t('row_open'), ICONS.open, () => {
      location.href = record.url;
    }),
  );

  // A summary cannot be rebuilt from this page: the redo button sends the reader back to the
  // video, where the transcript is reachable.
  const redo = button(t('btn_redo'), ICONS.redo, () => {
    location.href = record.url;
  });
  redo.title = t('redo_unavailable');
  left.append(redo, exportPicker(record));

  const right = el('div', 'group');
  const remove = button(t('btn_delete'), ICONS.delete, async () => {
    await chrome.storage.local.remove(recordKey(record.id));
    // No window.close(): a tab the script did not open does not close reliably. Show the state
    // rather than attempt and fail silently.
    gone(t('summary_deleted'));
  });
  remove.classList.add('danger');
  right.append(remove);

  inner.append(left, right);
  bar.append(feedback, inner);
  return bar;
}

// One select rather than three buttons: the action row stays readable at a glance.
function exportPicker(record: Rec): HTMLElement {
  const targets: [string, () => void][] = [
    [t('btn_obsidian'), () => void toObsidian(record)],
    [t('btn_claude'), () => window.open(agentUri('claude', note(record)), '_blank')],
    [t('btn_chatgpt'), () => window.open(agentUri('chatgpt', note(record)), '_blank')],
  ];
  const select = el('select', 'export') as HTMLSelectElement;
  // The label is the first option: with no visible <label>, it doubles as the accessible name.
  select.setAttribute('aria-label', t('export_to'));
  select.append(el('option', null, t('export_to')));
  for (const [label] of targets) select.append(el('option', null, label));
  select.addEventListener('change', () => {
    const run = targets[select.selectedIndex - 1]?.[1];
    // Back to the label: exporting is an action, not a state to display.
    select.selectedIndex = 0;
    run?.();
  });
  return select;
}

// Stroked 20x20 paths, drawn in currentColor -- same set as the panel's.
const ICONS = {
  copy: '<path d="M7.5 6.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M13 4.5a1 1 0 0 0-1-1H4.5a1 1 0 0 0-1 1V12"/>',
  download: '<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 16.5h12"/>',
  open: '<path d="M11.5 3.5H16.5V8.5"/><path d="M16.5 3.5 9 11"/><path d="M14.5 11.5v5h-11v-11h5"/>',
  redo: '<path d="M16.5 10a6.5 6.5 0 1 1-2-4.7"/><path d="M16.5 2.5V7h-4.5"/>',
  delete:
    '<path d="M4 6h12"/><path d="M8 6V3.5h4V6"/><path d="M5.8 6l.8 10.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14.2 6"/>',
};

// The label lives in its own <span>: the copy button rewrites it without wiping the icon.
function button(label: string, icon: string, onClick: (label: HTMLElement) => void): HTMLElement {
  const b = el('button', 'btn');
  b.innerHTML = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none"
      stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
      stroke-linejoin="round">${icon}</svg>`;
  const text = el('span', null, label);
  b.append(text);
  b.addEventListener('click', () => onClick(text));
  return b;
}

function gone(message: string): void {
  document.title = t('app_name');
  $('content').textContent = '';
  const box = el('p', 'gone');
  box.append(el('strong', null, message), t('summary_gone_hint'));
  $('content').append(box);
}

// --- Export ------------------------------------------------------------------

const note = (record: Rec): string =>
  buildNote(toNoteMeta(record), record.summary, record.format, {
    tldr: t('section_tldr'),
    ideas: t('section_ideas'),
  });

async function toObsidian(record: Rec): Promise<void> {
  const { vault, folder } = await getSettings({ vault: '', folder: 'Youtube' });
  if (!vault) {
    // Settings live in the popup, which a page cannot open: open the same page as a tab, like
    // the worker already does.
    const link = el('a', null, t('settings_open')) as HTMLAnchorElement;
    link.href = '../popup/popup.html#settings';
    link.target = '_blank';
    feedback.textContent = `${t('vault_missing')} `;
    feedback.append(link);
    return;
  }
  location.href = obsidianUri(vault, folder, record.title, note(record));
}

// --- Entry -------------------------------------------------------------------

// Last in the file, after every const it reaches: the top-level await above would otherwise run
// render() while ICONS is still uninitialised.
const record = await getRecord(recordKey(new URLSearchParams(location.search).get('id') ?? ''));
if (record) render(record);
else gone(t('summary_not_found'));
