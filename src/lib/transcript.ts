type Json3 = { events?: { segs?: { utf8?: string }[] }[] };

export type FetchFn = (url: string) => Promise<{
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<Json3>;
}>;

interface VideoExtra {
  description: string | null;
  category: string | null;
  keywords: string[] | null;
  published: string | null;
  channelId: string | null;
  paid: boolean;
}

export interface ChannelExtra {
  channelDescription: string | null;
  channelKeywords: string[] | null;
}

interface TranscriptResult {
  text: string | null;
  blocked: boolean;
}

// The inline script is not replaced on SPA navigations: without this check we would summarize the
// previous video. The caller also uses it to decide whether to refetch the page.
export const isFor = (html: string, videoId: string | null): boolean =>
  html.match(/"videoId":"([\w-]{11})"/)?.[1] === videoId;

export function captionUrl(html: string, videoId: string | null): string | null {
  if (!isFor(html, videoId)) return null;
  const m = html.match(/"captionTracks":(\[.*?\}\])/);
  if (!m) return null;
  try {
    return JSON.parse(m[1] ?? '[]')[0]?.baseUrl ?? null;
  } catch {
    return null;
  }
}

export function json3ToText(json: Json3): string {
  return (json.events ?? [])
    .flatMap((e) => e.segs ?? [])
    .map((s) => s.utf8 ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// The same blob carries what frames the summary: without description or category, a sketches
// video reads as a report. One regex per field rather than JSON.parse of the whole blob (several
// MB, end of object not reliably delimited): the capture includes the quotes, so JSON.parse
// handles the \" and \uXXXX escapes alone.
const JSON_STRING = '"(?:[^"\\\\]|\\\\.)*"';

function field(html: string, key: string, pattern: string): any {
  const m = html.match(new RegExp(`"${key}":(${pattern})`));
  if (!m) return null;
  try {
    return JSON.parse(m[1] ?? 'null');
  } catch {
    return null;
  }
}

export function videoMeta(html: string, videoId: string | null): VideoExtra | null {
  if (!isFor(html, videoId)) return null;
  return {
    description: field(html, 'shortDescription', JSON_STRING),
    category: field(html, 'category', JSON_STRING),
    keywords: field(html, 'keywords', `\\[(?:${JSON_STRING},?)*\\]`)?.slice(0, 8) ?? null,
    published: field(html, 'publishDate', JSON_STRING)?.slice(0, 10) ?? null,
    // `externalChannelId` and not `channelId`: the latter also appears in responseContext,
    // upstream of the blob, and the first match would win.
    channelId: field(html, 'externalChannelId', JSON_STRING),
    // YouTube's own disclosure, not a heuristic: the key only exists on videos declared to
    // include paid promotion. Key presence rather than field(): the translated value teaches
    // nothing. The renderer name alone also appears in the responseContext inventory, hence the
    // full path.
    paid: html.includes('"paidContentOverlay":{'),
  };
}

// Channel metadata, from its page's HTML (separate fetch). The search is scoped to the object:
// `description` and `keywords` are too common for a global match.
export function channelMeta(html: string): ChannelExtra | null {
  const i = html.indexOf('"channelMetadataRenderer":{');
  if (i < 0) return null;
  const seg = html.slice(i, i + 4000); // title, description, rssUrl, externalId, keywords
  const raw = field(seg, 'keywords', JSON_STRING);
  return {
    channelDescription: field(seg, 'description', JSON_STRING),
    // A single string with quoted expressions, not a JSON array:
    //   Official Rick Astley "rick astley" "rick roll" meme
    channelKeywords:
      raw
        ?.match(/"[^"]+"|\S+/g)
        ?.map((s: string) => s.replaceAll('"', ''))
        .slice(0, 10) ?? null,
  };
}

// Three distinct outcomes, hence an object rather than an ambiguous null:
//   { text }            transcript recovered
//   { text: null }      the video has no captions
//   { blocked: true }   YouTube refuses timedtext without a provenance token (200 + empty body):
//                       a profile problem, not a video one — the caller stops trying.
export async function transcriptFromHtml(
  html: string,
  videoId: string | null,
  fetchFn: FetchFn,
): Promise<TranscriptResult> {
  const url = captionUrl(html, videoId);
  if (!url) return { text: null, blocked: false };
  const res = await fetchFn(`${url}&fmt=json3`);
  const text = res.ok ? json3ToText(await res.json().catch(() => ({}))) : '';
  if (text.length < 200) return { text: null, blocked: true };
  return { text, blocked: false };
}

export async function fetchTranscript(
  videoId: string | null,
  fetchFn: FetchFn,
): Promise<TranscriptResult> {
  const html = await fetchFn(`https://www.youtube.com/watch?v=${videoId}`).then((r) => r.text());
  return transcriptFromHtml(html, videoId, fetchFn);
}
