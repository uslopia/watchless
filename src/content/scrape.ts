// Everything the page is READ from: transcript (fast path and panel fallback), video and channel
// metadata. DOM and HTML only — no state, no UI.

import { formatClock } from '../lib/history.ts';
import { t } from '../lib/i18n.ts';
import type { ChannelExtra } from '../lib/transcript.ts';
import { channelMeta, isFor, transcriptFromHtml, videoMeta } from '../lib/transcript.ts';
import { videoId, waitFor } from './util.ts';

// Fast path: the caption URL lives in the page's ytInitialPlayerResponse blob, which avoids
// opening and scraping the transcript panel. YouTube sometimes demands a provenance token on
// timedtext and replies 200 with an empty body; at the first such failure we drop to the panel
// for the rest of the tab session.
let fastPath = true;

export async function fetchTranscript() {
  if (!fastPath) return null;
  try {
    return await captionTranscript();
  } catch {
    return null; // network, broken JSON, markup change: fall back to scraping
  }
}

function inlineBlob() {
  for (const s of document.scripts) {
    if (s.textContent.includes('ytInitialPlayerResponse')) return s.textContent;
  }
  return '';
}

// The inline script is not re-executed on SPA navigations, so it then holds the previous video:
// refetch the HTML (same origin, cookies included). Memoized per video — the transcript and the
// metadata both read it — as a promise so two concurrent callers fetch once.
let page: { id: string | null; html: Promise<string> | null } = { id: null, html: null };

async function pageHtml() {
  const v = videoId();
  if (page.id !== v) {
    const inline = inlineBlob();
    page = {
      id: v,
      // A failed refetch degrades rather than throws: the metadata loses `extra`, the transcript
      // falls back to the panel. A rejection here would be memoized for the whole video.
      html: isFor(inline, v)
        ? Promise.resolve(inline)
        : fetch(location.href)
            .then((r) => r.text())
            .catch(() => ''),
    };
  }
  return page.html;
}

async function captionTranscript() {
  const get = (u: string) => fetch(u); // unbound fetch throws Illegal invocation
  const out = await transcriptFromHtml((await pageHtml()) ?? '', videoId(), get);
  // `blocked` = YouTube refused timedtext for lack of a provenance token. A profile problem, not
  // a video one: stop retrying it for this tab session.
  if (out.blocked) fastPath = false;
  return out.text;
}

// Channel keywords and description: one extra fetch, memoized per channel, not per video. A
// failure yields {} — the summary just goes without this context.
const channels = new Map<string, Promise<ChannelExtra | null>>();

async function channelExtra(channelId: string | null | undefined) {
  if (!channelId) return {};
  if (!channels.has(channelId)) {
    channels.set(
      channelId,
      fetch(`https://www.youtube.com/channel/${channelId}`)
        .then((r) => r.text())
        .then(channelMeta)
        .catch(() => null),
    );
  }
  return (await channels.get(channelId)) ?? {};
}

// YouTube A/B tests several transcript panels (legacy and the modern "In this video") with
// incompatible markup: target the open panel with the most text, not an element name.
function transcriptPanel() {
  return (
    [...document.querySelectorAll<HTMLElement>('ytd-engagement-panel-section-list-renderer')]
      .filter((p) => p.offsetHeight > 200 && (p.textContent ?? '').trim().length > 200)
      .sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length)[0] ?? null
  );
}

export async function scrapeTranscript() {
  document.querySelector<HTMLElement>('#description #expand')?.click(); // the button lives in the collapsed description
  const openers = [
    ...document.querySelectorAll<HTMLElement>(
      'ytd-video-description-transcript-section-renderer button',
    ),
  ];
  const opener = openers.find((b) => b.offsetHeight > 0) ?? openers[0];
  if (!opener) throw new Error(t('error_no_transcript'));
  opener.click();

  let panel: HTMLElement;
  try {
    panel = await waitFor(transcriptPanel, 10000);
  } catch {
    throw new Error(t('error_panel_not_loaded'));
  }

  // textContent, not innerText: the latter depends on layout and triggers a sync reflow per node.
  const text = [...(panel.querySelector('#content') ?? panel).querySelectorAll('*')]
    .filter((el) => !el.children.length && el.textContent?.trim())
    .filter((el) => !el.closest('#header, button, input, [role="tab"], tp-yt-paper-tab'))
    .map((el) => (el.textContent ?? '').trim())
    .filter((line) => !/^\d{1,2}:\d{2}(:\d{2})?$/.test(line)) // timestamps
    .join(' ')
    .replace(/\s+/g, ' ');
  panel.querySelector<HTMLElement>('#visibility-button button')?.click();
  // A just-opened panel may have rendered only its header: better a clear error than a summary
  // built from three lines.
  if (text.length < 200) throw new Error(t('error_transcript_too_short'));
  return text;
}

export async function getMeta() {
  const title =
    document.querySelector<HTMLElement>('h1.ytd-watch-metadata')?.innerText.trim() ??
    document.title.replace(/ - YouTube$/, '');
  const channel =
    document.querySelector<HTMLAnchorElement>('#owner #channel-name a')?.innerText.trim() ?? '';
  const url = `https://www.youtube.com/watch?v=${videoId()}`;
  // NaN while the player metadata is not loaded yet -> null, not 0: "unknown duration" and
  // "0-second video" are not the same thing.
  const seconds = Math.round(document.querySelector('video')?.duration || 0) || null;
  const duration = formatClock(seconds);
  const captured = new Date().toISOString().slice(0, 10);
  const extra = videoMeta((await pageHtml()) ?? '', videoId());
  const channelInfo = await channelExtra(extra?.channelId);
  // The DOM <meta> lives in the initial load's <head>: fallback only.
  const published =
    extra?.published ??
    document
      .querySelector<HTMLMetaElement>('meta[itemprop="datePublished"]')
      ?.content.slice(0, 10) ??
    '';
  return {
    id: `yt:${videoId()}`,
    title,
    channel,
    url,
    seconds,
    duration,
    captured,
    ...extra,
    ...channelInfo,
    published, // after the spread: extra.published is null when the blob carries no publishDate
  };
}

export function resetPage() {
  page = { id: null, html: null };
}
