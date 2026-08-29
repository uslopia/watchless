// The single typed boundary over chrome.storage. @types/chrome declares get() as
// Promise<{ [key: string]: any }>, so every read is `any` until it passes through here — which
// would leave the whole persistence layer untyped while tsc reported success.
//
// Separate from history.ts on purpose: that file is pure logic with no chrome.* dependency, and
// the tests import it under bare Node.
import { recordsFrom } from './history.ts';
import type { Follow, Rec, Run, Settings, Trace } from './types.ts';

export const getSettings = async <K extends keyof Settings>(
  defaults: Pick<Settings, K>,
): Promise<Pick<Settings, K>> => (await chrome.storage.sync.get(defaults)) as Pick<Settings, K>;

export const getRecord = async (key: string): Promise<Rec | undefined> =>
  (await chrome.storage.local.get(key))[key] as Rec | undefined;

// Reads the whole store: see the comment on save() in content/index.ts.
export const getAllRecords = async (): Promise<Rec[]> =>
  recordsFrom(await chrome.storage.local.get(null));

// local, not sync: sync caps an item at 8 KB, and the queue this feeds is local anyway — half of
// the passive-watch state syncing and half not would be worse than neither.
const FOLLOWS_KEY = 'wl:follows';

export const getFollows = async (): Promise<Follow[]> =>
  ((await chrome.storage.local.get(FOLLOWS_KEY)) as { [FOLLOWS_KEY]?: Follow[] })[FOLLOWS_KEY] ??
  [];

export const setFollows = (follows: Follow[]): Promise<void> =>
  chrome.storage.local.set({ [FOLLOWS_KEY]: follows });

// The passive-watch queue. Video ids, head first, plus the run currently in flight — both in
// storage and not in a worker variable: the service worker dies between two videos, and a queue
// living in memory would be a queue that stops at the first idle minute.
const QUEUE_KEY = 'wl:queue';
const RUN_KEY = 'wl:run';

export const getQueue = async (): Promise<string[]> =>
  ((await chrome.storage.local.get(QUEUE_KEY)) as { [QUEUE_KEY]?: string[] })[QUEUE_KEY] ?? [];

export const setQueue = (queue: string[]): Promise<void> =>
  chrome.storage.local.set({ [QUEUE_KEY]: queue });

export const getRun = async (): Promise<Run | null> =>
  ((await chrome.storage.local.get(RUN_KEY)) as { [RUN_KEY]?: Run })[RUN_KEY] ?? null;

export const setRun = (run: Run | null): Promise<void> =>
  run ? chrome.storage.local.set({ [RUN_KEY]: run }) : chrome.storage.local.remove(RUN_KEY);

// The Watchless tab group. Kept in storage and not in the worker: its whole job is to survive a
// worker death, which is exactly what leaves a runner tab behind with no run pointing at it.
const GROUP_KEY = 'wl:group';

export const getGroup = async (): Promise<number | null> =>
  ((await chrome.storage.local.get(GROUP_KEY)) as { [GROUP_KEY]?: number })[GROUP_KEY] ?? null;

export const setGroup = (id: number): Promise<void> =>
  chrome.storage.local.set({ [GROUP_KEY]: id });

export const getTraces = async (): Promise<Trace[]> =>
  ((await chrome.storage.local.get('debugLog')) as { debugLog?: Trace[] }).debugLog ?? [];
