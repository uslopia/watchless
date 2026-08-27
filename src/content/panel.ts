// Everything the page is WRITTEN to: the button, the panel, the summary and the action bar.
import { presetsOf } from '../lib/history.ts';
import { badgeText, sectionTitle, t } from '../lib/i18n.ts';
import { checkBadges, PRESETS } from '../lib/summarize.ts';
import type { Badge, Checks, Handlers, Preset, Summary } from '../lib/types.ts';
import { state } from './state.ts';
import { esc, waitFor } from './util.ts';

const LABEL: Partial<Record<BtnState, () => string>> = {
  idle: () => t('app_name'),
  ready: () => t('btn_view_summary'),
};

type BtnState = 'idle' | 'ready' | 'busy';

let shownPct = 0;

export function addButton(onSummarize: () => void): void {
  // Same flex row as Like/Dislike/Share: any other parent aligns the pill on its own baseline,
  // which puts us ~2px above the native buttons.
  waitFor(() => document.querySelector('ytd-watch-metadata #top-level-buttons-computed'), 10000)
    .then((row) => {
      if (!location.pathname.startsWith('/watch')) return; // a previous page's waitFor resolved late
      if (document.getElementById('watchless-btn')) return; // concurrent inits
      const btn = document.createElement('button');
      btn.id = 'watchless-btn';
      btn.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <path d="M3 5h14M3 10h9M3 15h5" fill="none" stroke="currentColor"
                stroke-width="2.2" stroke-linecap="round"/>
        </svg><span id="watchless-label"></span>`;
      btn.addEventListener('click', onSummarize);
      row.insertBefore(btn, row.firstChild);
      setBtn(state.summary ? 'ready' : 'idle'); // the cache may have answered before injection
    })
    .catch(() => {});
}

export function setBtn(stateName: BtnState, label?: string, pct?: number): void {
  // Not the shared $(): the button legitimately may not be injected yet.
  const btn = document.getElementById('watchless-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.dataset.state = stateName;
  btn.disabled = stateName === 'busy';
  // The global gauge never moves backward: foldToFit can re-enter the analyze step at a lower
  // percentage, and clamping the display keeps the button monotone.
  if (stateName !== 'busy') shownPct = 0;
  if (pct != null) {
    shownPct = Math.max(shownPct, pct);
    label = `${shownPct}% ${label}`;
  }
  // one span per letter: hover makes them ripple in cascade (--i = rank)
  const target = btn.querySelector<HTMLElement>('#watchless-label');
  if (!target) return;
  target.textContent = '';
  [...(label ?? LABEL[stateName]?.() ?? '')].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.setProperty('--i', String(i));
    target.appendChild(s);
  });
}

// A native <dialog> opened modally: the backdrop, Esc and the focus trap come for free, and the
// top layer clears YouTube's masthead without a z-index.
function panel(): HTMLElement {
  const known = document.getElementById('watchless-panel');
  if (known) return known;
  const el = document.createElement('dialog');
  el.id = 'watchless-panel';
  el.innerHTML = `<div id="watchless-head"><div id="watchless-actions"></div>
      <button id="watchless-close" title="${esc(t('close_title'))}">×</button></div>
    <div id="watchless-body"></div>`;
  document.body.append(el);
  el.querySelector('#watchless-close')?.addEventListener('click', restoreVideo);
  el.addEventListener('cancel', restoreVideo); // Esc: close() alone would leave the node behind
  // The sheet's own padding lives on its children, so only a backdrop click targets the dialog.
  el.addEventListener('click', (e) => {
    if (e.target === el) restoreVideo();
  });
  el.showModal();
  document.querySelector('video')?.pause();
  return el;
}

export function restoreVideo(): void {
  document.getElementById('watchless-panel')?.remove();
}

function setBody(html: string): void {
  const body = panel().querySelector<HTMLElement>('#watchless-body');
  if (body) body.innerHTML = html;
}

export function fail(message: string): void {
  setBtn('idle');
  setBody(`<p class="watchless-error">${esc(message)}</p>`); // too long for the button
}

export function render(): void {
  // render() is only reached with a summary present: index.ts gates every call on state.summary.
  const { tldr, idees, tags } = state.summary as Summary;
  // raw slug as a fallback: an untranslated format beats an empty pill
  const label = state.format && (t(`format_${state.format}`) || state.format);
  const format = label ? `<span class="watchless-format">${esc(label)}</span>` : '';
  setBody(`
    <h3>${esc(sectionTitle('tldr', state.preset))}</h3><p>${esc(tldr)}</p>
    <h3>${esc(sectionTitle('ideas', state.preset))}</h3><ul>${idees.map((i: string) => `<li>${esc(i)}</li>`).join('')}</ul>
    <p class="watchless-tags">${format}${tags.map(esc).join(' · ')}</p>
    ${checksHtml(checkBadges(state.checks, state.format))}`);
  setBtn('ready');
}

function checksHtml(badges: Badge[]): string {
  if (!badges.length) return '';
  const pills = badgeText(badges)
    .map((s) => `<span>${esc(s)}</span>`)
    .join('');
  // checkBadges() returns [] when checks is null, and the early return above caught that.
  const checks = state.checks as Checks;
  const why = checks.promise !== 'kept' && checks.why;
  return `<p class="watchless-checks">${pills}</p>${why ? `<p class="watchless-why">${esc(why)}</p>` : ''}`;
}

export function renderActions(handlers: Handlers): void {
  const actions = panel().querySelector<HTMLElement>('#watchless-actions');
  if (!actions) return;
  actions.innerHTML = '';
  // No record until a run has been saved: before that there is nothing to switch between.
  const known = state.record ? presetsOf(state.record) : [];
  actions.append(
    actionButton(t('btn_note'), ICONS.note, handlers.onNote),
    ...notePicker(known, handlers),
    ...presetPicker(known, handlers),
  );
}

// The styles already generated for this video are one record read away; the others cost a run.
// Two pickers rather than one, so switching and generating do not look like the same click.
function notePicker(known: Preset[], handlers: Handlers): HTMLSelectElement[] {
  if (known.length < 2) return [];
  const select = document.createElement('select');
  select.setAttribute('aria-label', t('settings_preset'));
  for (const name of known) select.append(new Option(t(`preset_${name}`), name));
  select.value = state.preset ?? 'default';
  select.addEventListener('change', () => handlers.onPreset(select.value as Preset));
  return [select];
}

// Redoing the same summary produces the same summary: the model does not get smarter on a second
// pass. The only useful variation is another reading angle, hence a picker over the other presets.
function presetPicker(known: Preset[], handlers: Handlers): HTMLSelectElement[] {
  const others = (Object.keys(PRESETS) as Preset[]).filter(
    (p) => p !== state.preset && !known.includes(p),
  );
  if (!others.length) return [];
  const select = document.createElement('select');
  // The label is the first option: with no visible <label>, it doubles as the accessible name.
  select.setAttribute('aria-label', t('btn_regenerate'));
  select.append(new Option(t('btn_regenerate')));
  for (const name of others) select.append(new Option(t(`preset_${name}`), name));
  select.addEventListener('change', () => {
    const picked = others[select.selectedIndex - 1];
    // Back to the label: picking a style is an action, not a state to display.
    select.selectedIndex = 0;
    if (picked) handlers.onPreset(picked);
  });
  return [select];
}

// Stroked 20x20 paths, drawn in currentColor: one icon set for the two panel actions.
const ICONS = {
  note: '<path d="M4.5 3h6l5 5v9a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M10.5 3v5h5"/><path d="M7 11.5h6M7 14.5h4"/>',
};

function actionButton(
  label: string,
  icon: string,
  onClick: (btn: HTMLButtonElement) => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.innerHTML = `<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
      stroke-linejoin="round">${icon}</svg><span>${esc(label)}</span>`;
  b.addEventListener('click', () => onClick(b));
  return b;
}
