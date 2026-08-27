// The single typed boundary over chrome.storage. @types/chrome declares get() as
// Promise<{ [key: string]: any }>, so every read is `any` until it passes through here — which
// would leave the whole persistence layer untyped while tsc reported success.
//
// Separate from history.ts on purpose: that file is pure logic with no chrome.* dependency, and
// the tests import it under bare Node.
import { recordsFrom } from './history.ts';
import type { Rec, Settings, Trace } from './types.ts';

export const getSettings = async <K extends keyof Settings>(
  defaults: Pick<Settings, K>,
): Promise<Pick<Settings, K>> => (await chrome.storage.sync.get(defaults)) as Pick<Settings, K>;

export const getRecord = async (key: string): Promise<Rec | undefined> =>
  (await chrome.storage.local.get(key))[key] as Rec | undefined;

// Reads the whole store: see the comment on save() in content/index.ts.
export const getAllRecords = async (): Promise<Rec[]> =>
  recordsFrom(await chrome.storage.local.get(null));

export const getTraces = async (): Promise<Trace[]> =>
  ((await chrome.storage.local.get('debugLog')) as { debugLog?: Trace[] }).debugLog ?? [];
