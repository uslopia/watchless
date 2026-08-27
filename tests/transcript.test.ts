import assert from 'node:assert/strict';
import test from 'node:test';
import type { FetchFn } from '../src/lib/transcript.ts';
import {
  captionUrl,
  channelMeta,
  fetchTranscript,
  isFor,
  json3ToText,
  transcriptFromHtml,
  videoMeta,
} from '../src/lib/transcript.ts';

const html = (videoId: string) =>
  `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${videoId}"},` +
  `"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":` +
  `[{"baseUrl":"https://www.youtube.com/api/timedtext?v=${videoId}&lang=fr","languageCode":"fr"},` +
  `{"baseUrl":"https://www.youtube.com/api/timedtext?v=${videoId}&lang=en","languageCode":"en"}]}}};</script>`;

test('extracts the baseUrl of the first track', () => {
  assert.equal(
    captionUrl(html('dQw4w9WgXcQ'), 'dQw4w9WgXcQ'),
    'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=fr',
  );
});

test('null when the HTML is another video (stale inline script after an SPA navigation)', () => {
  assert.equal(captionUrl(html('dQw4w9WgXcQ'), 'aBcDeFgHiJk'), null);
});

test('null without captionTracks', () => {
  assert.equal(
    captionUrl('<script>var x = {"videoId":"dQw4w9WgXcQ"};</script>', 'dQw4w9WgXcQ'),
    null,
  );
});

test('null when the HTML has no videoId', () => {
  assert.equal(captionUrl('<html></html>', 'dQw4w9WgXcQ'), null);
});

test('json3: stitches the segs and normalizes whitespace', () => {
  const json = {
    events: [
      { segs: [{ utf8: 'Bonjour' }, { utf8: '\n' }, { utf8: 'tout' }] },
      { segs: [{ utf8: '  le   monde' }] },
      { aAppend: 1 },
    ],
  };
  assert.equal(json3ToText(json), 'Bonjour tout le monde');
});

test('json3: empty response -> empty string', () => {
  assert.equal(json3ToText({}), '');
});

const metaHtml = (videoId: string) =>
  `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"${videoId}",` +
  `"shortDescription":"Une \\"blague\\"\\nsur deux lignes","keywords":["flics","humour","sketch"]},` +
  `"microformat":{"playerMicroformatRenderer":{"externalChannelId":"UCabc","category":"Comedy",` +
  `"publishDate":"2026-08-12T09:00:00-07:00"}}};</script>`;

test('videoMeta: description, category, keywords, date and channel', () => {
  assert.deepEqual(videoMeta(metaHtml('dQw4w9WgXcQ'), 'dQw4w9WgXcQ'), {
    description: 'Une "blague"\nsur deux lignes',
    category: 'Comedy',
    keywords: ['flics', 'humour', 'sketch'],
    published: '2026-08-12',
    channelId: 'UCabc',
    paid: false,
  });
});

test('videoMeta: paid follows YouTube disclosure, not the renderer name', () => {
  const disclosed = metaHtml('dQw4w9WgXcQ').replace(
    '"microformat"',
    '"paidContentOverlay":{"paidContentOverlayRenderer":{}},"microformat"',
  );
  assert.equal(videoMeta(disclosed, 'dQw4w9WgXcQ')!.paid, true);
  // the renderer name alone appears in any video's responseContext inventory
  const inventory = metaHtml('dQw4w9WgXcQ').replace(
    '"microformat"',
    '"hasDecorated":["paidContentOverlayRenderer"],"microformat"',
  );
  assert.equal(videoMeta(inventory, 'dQw4w9WgXcQ')!.paid, false);
});

test('videoMeta: null when the HTML is another video', () => {
  assert.equal(videoMeta(metaHtml('dQw4w9WgXcQ'), 'aBcDeFgHiJk'), null);
});

test('videoMeta: missing fields -> null, never an exception', () => {
  assert.deepEqual(videoMeta('<script>{"videoId":"dQw4w9WgXcQ"}</script>', 'dQw4w9WgXcQ'), {
    description: null,
    category: null,
    keywords: null,
    published: null,
    channelId: null,
    paid: false,
  });
});

test('videoMeta: at most 8 keywords', () => {
  const many = `{"videoId":"dQw4w9WgXcQ","keywords":[${[...Array(12)].map((_, i) => `"k${i}"`).join(',')}]}`;
  assert.equal(videoMeta(many, 'dQw4w9WgXcQ')!.keywords!.length, 8);
});

test('isFor: compares the blob videoId to the requested one', () => {
  assert.equal(isFor(metaHtml('dQw4w9WgXcQ'), 'dQw4w9WgXcQ'), true);
  assert.equal(isFor(metaHtml('dQw4w9WgXcQ'), 'aBcDeFgHiJk'), false);
  assert.equal(isFor('<html></html>', 'dQw4w9WgXcQ'), false);
});

// The channel page carries other renderers with the same keys: the description that precedes it
// must not be captured in place of the channel's.
const channelHtml =
  `<script>var ytInitialData = {"header":{"pageHeaderRenderer":{"description":"un autre renderer"}},` +
  `"metadata":{"channelMetadataRenderer":{"title":"Mister V","description":"Sketches et musique",` +
  `"rssUrl":"https://x/y","externalId":"UCabc",` +
  `"keywords":"humour \\"mister v\\" \\"la police\\" sketch"}}};</script>`;

test('channelMeta: channel description and quoted keywords', () => {
  assert.deepEqual(channelMeta(channelHtml), {
    channelDescription: 'Sketches et musique',
    channelKeywords: ['humour', 'mister v', 'la police', 'sketch'],
  });
});

test('channelMeta: at most 10 keywords', () => {
  const many = `{"channelMetadataRenderer":{"keywords":"${[...Array(14)].map((_, i) => `k${i}`).join(' ')}"}}`;
  assert.equal(channelMeta(many)!.channelKeywords!.length, 10);
});

test('channelMeta: null without channelMetadataRenderer', () => {
  assert.equal(channelMeta('<html>{"keywords":"perdu"}</html>'), null);
});

// --- orchestration (v3 seam: usable from the worker, without a DOM) ------------

const captions = (n: number) => ({ events: [{ segs: [{ utf8: 'mot '.repeat(n) }] }] });
const okResponse = (json: unknown) => ({ ok: true, json: async () => json });

// The mocks answer only what the function under test actually calls — the cast says so, rather
// than making the production response type optional to accommodate a fixture.
const asFetch = (fn: unknown) => fn as FetchFn;

test('transcriptFromHtml: recovers the text via the baseUrl', async () => {
  const fetchFn = asFetch(async (url: string) => {
    assert.match(url, /timedtext.*fmt=json3/);
    return okResponse(captions(100));
  });
  const { text, blocked } = await transcriptFromHtml(html('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', fetchFn);
  assert.equal(blocked, false);
  assert.equal((text ?? '').length > 200, true);
});

test('transcriptFromHtml: no captions -> neither text nor block', async () => {
  const never = () => assert.fail('must not fetch without a baseUrl');
  assert.deepEqual(await transcriptFromHtml('<html></html>', 'dQw4w9WgXcQ', never), {
    text: null,
    blocked: false,
  });
});

test('transcriptFromHtml: empty body (provenance token refused) -> blocked', async () => {
  const fetchFn = asFetch(async () => okResponse({ events: [] }));
  assert.deepEqual(await transcriptFromHtml(html('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', fetchFn), {
    text: null,
    blocked: true,
  });
});

test('transcriptFromHtml: HTTP error response -> blocked', async () => {
  const fetchFn = asFetch(async () => ({ ok: false, json: async () => ({}) }));
  assert.deepEqual(await transcriptFromHtml(html('dQw4w9WgXcQ'), 'dQw4w9WgXcQ', fetchFn), {
    text: null,
    blocked: true,
  });
});

test('fetchTranscript: loads the /watch page then the captions', async () => {
  const seen: string[] = [];
  const fetchFn = asFetch(async (url: string) => {
    seen.push(url);
    if (url.includes('/watch')) return { text: async () => html('dQw4w9WgXcQ') };
    return okResponse(captions(100));
  });
  const { text } = await fetchTranscript('dQw4w9WgXcQ', fetchFn);
  assert.equal(seen[0], 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal((text ?? '').length > 200, true);
});
