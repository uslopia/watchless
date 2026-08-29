// Passive watch: the poller. Every `pollMinutes`, each followed channel's Atom feed is read and
// the entries newer than its watermark become work.
//
// The queue below consumes that work one video at a time; poll() advances the watermark exactly
// once per taken entry, so nothing is summarized twice.

import type { FeedEntry } from '../lib/feed.ts';
import { feedUrl, freshEntries, parseFeed } from '../lib/feed.ts';
import { pool } from '../lib/pool.ts';
import {
  getFollows,
  getGroup,
  getQueue,
  getRun,
  getSettings,
  setFollows,
  setGroup,
  setQueue,
  setRun,
} from '../lib/storage.ts';
import type { Follow } from '../lib/types.ts';

export const POLL_ALARM = 'wl:poll';
// Separate from the poll alarm and far shorter: this one restarts a queue the worker died in the
// middle of, and is the only thing that can unwedge a run whose tab never reported back.
export const TICK_ALARM = 'wl:tick';
const TICK_MINUTES = 5;

// The transcript cannot be fetched headlessly: every caption URL now carries `exp=xpe` and
// /api/timedtext answers 200 with an empty body unless the request also carries a `pot` token,
// which only YouTube's own player can mint. So a real tab loads the page and the existing content
// script does the work — the fragment is what tells it to run silently.
//
// active:false and no "tabs" permission: chrome.tabs.create/remove do not need it, and asking for
// it would add the "Read your browsing history" warning for nothing.
const RUNNER_HASH = '#watchless';

// Runner tabs no run points at any more: the worker dying between tabs.create() and the setRun()
// that records the id orphans one, and nothing downstream can close what it cannot name. They all
// live in the one group, so the group is the sweep.
//
// Called only from step(), and only once nothing of ours is in flight: at that point every tab
// left in the group is by definition an orphan. openRunner() must not sweep on its own — the
// 'runNow' crank goes through it too, and would close the tab of the run it interrupts.
async function sweep(): Promise<void> {
  const groupId = await getGroup();
  if (groupId == null) return;
  try {
    const stale = await chrome.tabs.query({ groupId });
    await Promise.all(stale.flatMap((tab) => (tab.id == null ? [] : [chrome.tabs.remove(tab.id)])));
  } catch {
    // The group is gone, which is the state we wanted anyway.
  }
}

export async function openRunner(v: string): Promise<number | null> {
  try {
    const tab = await chrome.tabs.create({
      url: `https://www.youtube.com/watch?v=${v}${RUNNER_HASH}`,
      active: false,
    });
    if (tab.id != null) await stow(tab.id);
    return tab.id ?? null;
  } catch {
    // Real on macOS, where Chrome can run with no window at all.
    return null;
  }
}

// A named, collapsed group rather than a loose tab: a stray youtube.com tab appearing on its own
// reads as a bug, a "Watchless" chip reads as the extension working. Collapsed, it costs one chip
// of tab strip instead of a full tab.
//
// Best effort on purpose — chrome.tabs.group() needs no permission, but chrome.tabGroups does
// ("View and manage your tab groups"), and a user who declines it should still get their summary.
async function stow(tabId: number): Promise<void> {
  try {
    const groupId = await chrome.tabs.group({ tabIds: tabId });
    // Remembered before the collapse: the id is what lets the next run sweep this tab if the
    // worker dies before it can be closed the normal way.
    await setGroup(groupId);
    // Collapsing works because the tab was created inactive: Chrome refuses to collapse a group
    // holding the active tab.
    await chrome.tabGroups.update(groupId, {
      title: 'Watchless',
      color: 'yellow',
      collapsed: true,
    });
  } catch {
    // No tabGroups permission, or the group vanished under us. The run does not depend on this.
  }
}

const closeRunner = (tabId: number | undefined): void => {
  if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
};

// Per channel and overall. A channel that drops five videos at once, or a hundred followed
// channels, must not outrun the one-run-at-a-time capacity downstream. Nothing is lost: the
// watermark only moves to the newest entry actually taken, so the rest come back next poll.
const MAX_PER_POLL = 3;
const MAX_ENQUEUE = 5;

// Two at a time, not fifty: the fan-out is over youtube.com and politeness is the point.
const FEED_LANES = 2;

export async function ensureAlarms(): Promise<void> {
  const { pollMinutes } = await getSettings({ pollMinutes: '60' as const });
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: Number(pollMinutes) });
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_MINUTES });
}

// --- The queue ---------------------------------------------------------------
// One video at a time, deliberately: the model is a single on-device session, so a second runner
// would only wait its turn inside the worker while holding a tab and a decoded page open.

// How long a run may stay in flight before it is written off. A summary is minutes, not hours;
// past this the tab was closed by hand, crashed, or the extension was reloaded mid-run.
const STUCK_MS = 12 * 60_000;

export async function enqueue(ids: string[]): Promise<void> {
  const [queue, run] = await Promise.all([getQueue(), getRun()]);
  const fresh = ids.filter((v) => v !== run?.v && !queue.includes(v));
  if (fresh.length) await setQueue([...queue, ...fresh]);
  await next();
}

// One step at a time inside a worker generation: an alarm and a jobDone can land in the same
// tick, and two interleaved dequeues would open two tabs for two videos. A worker restart resets
// the flag, which is right — nothing survives in flight across one.
let stepping = false;

export async function next(): Promise<void> {
  if (stepping) return;
  stepping = true;
  try {
    await step();
  } finally {
    stepping = false;
  }
}

async function step(): Promise<void> {
  const run = await getRun();
  if (run) {
    if (Date.now() - run.at < STUCK_MS) return; // still working
    closeRunner(run.tabId ?? undefined);
  }
  await sweep();
  const [v, ...rest] = await getQueue();
  if (!v) {
    await setRun(null);
    return;
  }
  await setQueue(rest);
  // Written before the tab exists: openRunner() awaits, and a worker dying in that window would
  // otherwise leave a tab nobody owns.
  await setRun({ v, tabId: null, at: Date.now() });
  const tabId = await openRunner(v);
  if (tabId == null) {
    // No window to open a tab in. Put it back rather than drop it — TICK_ALARM retries. Re-read
    // rather than reuse `rest`: an enqueue may have landed while openRunner was awaiting.
    await setQueue([v, ...(await getQueue())]);
    await setRun(null);
    return;
  }
  await setRun({ v, tabId, at: Date.now() });
}

// A runner reported in, whatever the outcome: a video that failed is a video that is done as far
// as the queue is concerned — retrying it would wedge the queue on the one video it cannot do.
export async function done(tabId: number | undefined): Promise<void> {
  const run = await getRun();
  closeRunner(tabId ?? run?.tabId ?? undefined);
  await setRun(null);
  await next();
}

async function fetchFeed(follow: Follow): Promise<FeedEntry[] | null> {
  try {
    const res = await fetch(feedUrl(follow.id));
    return res.ok ? parseFeed(await res.text()) : null;
  } catch {
    // Offline, or the channel is gone. Leave the watermark alone and try again next poll.
    return null;
  }
}

export async function poll(): Promise<void> {
  const follows = await getFollows();
  if (!follows.length) return;

  const feeds = await pool(follows, FEED_LANES, fetchFeed);
  let budget = MAX_ENQUEUE;
  const taken: FeedEntry[] = [];

  const updated = follows.map((follow, i) => {
    const entries = feeds[i];
    if (!entries) return follow;
    // Entries come oldest first, so the head of the list is the oldest unseen: take those, and the
    // watermark lands on the newest one actually taken.
    const fresh = freshEntries(entries, follow.seen, Math.min(MAX_PER_POLL, budget));
    if (!fresh.length) return follow;
    budget -= fresh.length;
    taken.push(...fresh);
    return { ...follow, seen: fresh.at(-1)?.published ?? follow.seen };
  });

  if (!taken.length) return;
  // The watermark first: a crash between the two lines must not re-take entries already queued.
  await setFollows(updated);
  await enqueue(taken.map((e) => e.v));
}
