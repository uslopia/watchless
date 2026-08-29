// A channel's Atom feed: the whole discovery mechanism. No key, no quota, no API — the last 15
// entries of https://www.youtube.com/feeds/videos.xml?channel_id=UC...
//
// Regex and not DOMParser: the parser has to run in the service worker, where DOMParser does not
// exist. Same reason and same house style as the HTML regexes in transcript.ts.

export interface FeedEntry {
  v: string; // videoId
  title: string;
  published: string; // ISO 8601, as the feed gives it
}

// `published`, never `updated`: `updated` bumps when the uploader edits a title or a description,
// and a watermark keyed on it would re-summarize videos that never changed.
const VIDEO_ID = /<yt:videoId>([\w-]{11})<\/yt:videoId>/;
const TITLE = /<title>([\s\S]*?)<\/title>/;
const PUBLISHED = /<published>([^<]+)<\/published>/;
const SHORT = /<link rel="alternate" href="https:\/\/www\.youtube\.com\/shorts\//;

const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

// &amp; resolves last by construction — the map is applied in one pass, so &amp;lt; stays "&lt;"
// rather than decoding twice into "<".
const decode = (s: string): string =>
  s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

// Oldest first, which is the order they have to be summarized in: a poll takes the N oldest unseen
// entries and moves the watermark to the last one it took, so the rest survive to the next poll.
//
// Shorts are dropped here rather than by the caller: on a sampled channel 11 of the 15 entries were
// Shorts, and a 30-second clip has nothing to summarize. The feed marks them in the link, so it
// costs no extra fetch to know.
export function parseFeed(xml: string): FeedEntry[] {
  return xml
    .split('<entry>')
    .slice(1)
    .map((block) => block.split('</entry>')[0] ?? '')
    .filter((block) => !SHORT.test(block))
    .flatMap((block) => {
      const v = block.match(VIDEO_ID)?.[1];
      const published = block.match(PUBLISHED)?.[1];
      if (!v || !published) return [];
      return [{ v, title: decode(block.match(TITLE)?.[1] ?? '').trim(), published }];
    })
    .sort((a, b) => Date.parse(a.published) - Date.parse(b.published));
}

// The entries a poll should take from one channel: newer than the watermark, oldest first, at
// most `max`. Dates are compared as instants, not strings — the feed carries a UTC offset and the
// watermark is written as Z, so a lexical compare would be wrong the moment YouTube changes either.
export const freshEntries = (entries: FeedEntry[], seen: string, max: number): FeedEntry[] => {
  const since = Date.parse(seen) || 0;
  return entries.filter((e) => Date.parse(e.published) > since).slice(0, Math.max(0, max));
};

export const feedUrl = (channelId: string): string =>
  `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;

// What a user pastes to follow a channel: an @handle, a full URL, or the raw UC id. Anything else
// returns null rather than being guessed at — a wrong URL would 404 into a silent no-op.
export function channelUrl(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/^https:\/\/(www\.)?youtube\.com\//.test(s)) return s;
  if (/^UC[\w-]{22}$/.test(s)) return `https://www.youtube.com/channel/${s}`;
  const handle = s.startsWith('@') ? s : `@${s}`;
  return /^@[\w.-]{3,30}$/.test(handle) ? `https://www.youtube.com/${handle}` : null;
}

// The channel a youtube.com URL names without a fetch: /@handle, /channel/UC..., and the two
// legacy forms all carry it in the path. /watch does not — the video page has to be read for
// that — so this returns null and the caller decides whether to pay for a fetch.
//
// The three shapes it can return are exactly the three channelUrl() accepts: nothing downstream
// has to learn a fourth.
export function channelFromPath(url: string): string | null {
  const path =
    /^https:\/\/(?:www\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|(?:c|user)\/[\w.-]+)(?:[/?#]|$)/.exec(
      url,
    )?.[1];
  if (!path) return null;
  if (path.startsWith('@')) return path;
  if (path.startsWith('channel/')) return path.slice('channel/'.length);
  return `https://www.youtube.com/${path}`;
}

// The subscriptions of youtube.com/feed/channels, from its ytInitialData. One `channelRenderer`
// per subscription, and the title sits a few dozen characters after the id — hence the bounded
// gap: unbounded, a renderer with no title of its own would borrow the next one's.
const SUBSCRIPTION =
  /"channelId":"(UC[\w-]{22})"[\s\S]{0,400}?"title":\{"(?:simpleText|text)":"((?:[^"\\]|\\.)*)"/g;

export function parseSubscriptions(html: string): { id: string; name: string }[] {
  const out = new Map<string, string>();
  for (const [, id, name] of html.matchAll(SUBSCRIPTION)) {
    // The page repeats a channel across its sections; the first hit wins.
    if (id && !out.has(id)) out.set(id, unquote(name ?? '') || id);
  }
  return [...out].map(([id, name]) => ({ id, name }));
}

// The capture comes from a JSON string minus its quotes: putting them back lets JSON.parse
// handle & and \" alone, the same trick as transcript.ts's field().
const unquote = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
};
