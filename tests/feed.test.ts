import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelFromPath,
  feedUrl,
  freshEntries,
  parseFeed,
  parseSubscriptions,
} from '../src/lib/feed.ts';

// Trimmed from a real feed: one Short, two normal videos, newest first as YouTube serves them.
const entry = (v: string, title: string, published: string, kind: 'watch' | 'shorts') =>
  `<entry>
  <id>yt:video:${v}</id>
  <yt:videoId>${v}</yt:videoId>
  <yt:channelId>UCuAXFkgsw1L7xaCfnd5JJOw</yt:channelId>
  <title>${title}</title>
  <link rel="alternate" href="https://www.youtube.com/${kind}/${v}"/>
  <author><name>Rick Astley</name></author>
  <published>${published}</published>
  <updated>2026-08-06T11:50:30+00:00</updated>
  <media:group><media:title>${title}</media:title></media:group>
 </entry>`;

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>Rick Astley</title>
 ${entry('bbbbbbbbbbb', 'Le plus recent', '2026-08-05T16:19:00+00:00', 'watch')}
 ${entry('ccccccccccc', 'Un short', '2026-08-04T10:00:00+00:00', 'shorts')}
 ${entry('aaaaaaaaaaa', 'Le plus ancien', '2026-08-01T09:00:00+00:00', 'watch')}
</feed>`;

test('parseFeed: oldest first, whatever the feed order', () => {
  assert.deepEqual(
    parseFeed(feed).map((e) => e.v),
    ['aaaaaaaaaaa', 'bbbbbbbbbbb'],
  );
});

// 11 of 15 entries on the sampled channel were Shorts: without this the queue fills with clips
// that have nothing to summarize.
test('parseFeed: drops the Shorts', () => {
  assert.equal(
    parseFeed(feed).some((e) => e.v === 'ccccccccccc'),
    false,
  );
});

test('parseFeed: keeps the videoId, title and publication date', () => {
  const [oldest] = parseFeed(feed);
  assert.deepEqual(oldest, {
    v: 'aaaaaaaaaaa',
    title: 'Le plus ancien',
    published: '2026-08-01T09:00:00+00:00',
  });
});

test('parseFeed: decodes the XML entities in the title', () => {
  const xml = feed.replace('Le plus ancien', 'Rock &amp; roll &#39;89 &quot;live&quot; &lt;3');
  const [oldest] = parseFeed(xml);
  assert.equal(oldest?.title, `Rock & roll '89 "live" <3`);
});

// A double decode would turn "&amp;lt;" into "<" and silently corrupt a title.
test('parseFeed: decodes entities once, not twice', () => {
  const xml = feed.replace('Le plus ancien', 'a &amp;lt; b');
  assert.equal(parseFeed(xml)[0]?.title, 'a &lt; b');
});

test('parseFeed: an entry without id or date is skipped, not thrown on', () => {
  const xml = feed.replace('<yt:videoId>aaaaaaaaaaa</yt:videoId>', '');
  assert.deepEqual(
    parseFeed(xml).map((e) => e.v),
    ['bbbbbbbbbbb'],
  );
});

test('parseFeed: empty or junk input -> no entry', () => {
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed('<html>nope</html>'), []);
});

test('feedUrl: builds the channel feed URL', () => {
  assert.equal(
    feedUrl('UCuAXFkgsw1L7xaCfnd5JJOw'),
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCuAXFkgsw1L7xaCfnd5JJOw',
  );
});

// --- Watermark ---------------------------------------------------------------

const entries = [
  { v: 'aaaaaaaaaaa', title: 'un', published: '2026-08-01T09:00:00+00:00' },
  { v: 'bbbbbbbbbbb', title: 'deux', published: '2026-08-05T16:19:00+00:00' },
  { v: 'ccccccccccc', title: 'trois', published: '2026-08-09T10:00:00+00:00' },
];

test('freshEntries: only what is newer than the watermark', () => {
  assert.deepEqual(
    freshEntries(entries, '2026-08-05T16:19:00Z', 10).map((e) => e.v),
    ['ccccccccccc'],
  );
});

// The feed carries a +00:00 offset and the watermark is written as Z: a lexical compare puts
// "2026-08-05T16:19:00+00:00" *before* "2026-08-05T16:19:00Z" and would re-take the same video
// on every poll, forever.
test('freshEntries: compares instants, not strings', () => {
  assert.deepEqual(freshEntries(entries.slice(0, 2), '2026-08-05T16:19:00Z', 10), []);
});

test('freshEntries: takes the oldest first, capped', () => {
  assert.deepEqual(
    freshEntries(entries, '2026-01-01T00:00:00Z', 2).map((e) => e.v),
    ['aaaaaaaaaaa', 'bbbbbbbbbbb'],
  );
});

// The global budget can reach zero mid-poll; a negative cap must take nothing, not everything.
test('freshEntries: a cap of zero or less takes nothing', () => {
  assert.deepEqual(freshEntries(entries, '2026-01-01T00:00:00Z', 0), []);
  assert.deepEqual(freshEntries(entries, '2026-01-01T00:00:00Z', -1), []);
});

test('freshEntries: an unparseable watermark takes everything, not nothing', () => {
  assert.equal(freshEntries(entries, '', 10).length, 3);
});

test('channelFromPath: the forms that name a channel without a fetch', () => {
  const cases: [string, string | null][] = [
    ['https://www.youtube.com/@MisterV', '@MisterV'],
    ['https://www.youtube.com/@MisterV/videos?x=1', '@MisterV'],
    ['https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw', 'UCuAXFkgsw1L7xaCfnd5JJOw'],
    ['https://www.youtube.com/c/RickAstley', 'https://www.youtube.com/c/RickAstley'],
    ['https://www.youtube.com/user/RickAstley', 'https://www.youtube.com/user/RickAstley'],
    // A watch page names its channel nowhere in the URL: the caller has to read the page.
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', null],
    ['https://www.youtube.com/feed/subscriptions', null],
    ['https://example.com/@MisterV', null],
  ];
  for (const [url, expected] of cases) assert.equal(channelFromPath(url), expected, url);
});

// Trimmed from /feed/channels: two channels, the first repeated further down the page as YouTube
// does, and an escaped ampersand in a title.
const channels = `{"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"items":[
 {"channelRenderer":{"channelId":"UCuAXFkgsw1L7xaCfnd5JJOw","title":{"simpleText":"Rick Astley"},
  "subscriberCountText":{"simpleText":"4.5M subscribers"}}},
 {"channelRenderer":{"channelId":"UCabcdefghijklmnopqrstuv","title":{"simpleText":"Salt \\u0026 Pepper"}}},
 {"channelRenderer":{"channelId":"UCuAXFkgsw1L7xaCfnd5JJOw","title":{"simpleText":"Rick Astley"}}}
]}]}}}`;

test('parseSubscriptions: one entry per channel, unescaped, deduped', () => {
  assert.deepEqual(parseSubscriptions(channels), [
    { id: 'UCuAXFkgsw1L7xaCfnd5JJOw', name: 'Rick Astley' },
    { id: 'UCabcdefghijklmnopqrstuv', name: 'Salt & Pepper' },
  ]);
});

// Signed out, the page has no channelRenderer at all: an empty list is the answer, not a throw.
test('parseSubscriptions: nothing to find', () => {
  assert.deepEqual(parseSubscriptions('<html>sign in</html>'), []);
});
