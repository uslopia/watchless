import { getQueue } from '../lib/storage.ts';
import { fetchTranscript } from '../lib/transcript.ts';
import {
  done,
  enqueue,
  ensureAlarms,
  next,
  openRunner,
  POLL_ALARM,
  poll,
  TICK_ALARM,
} from './queue.ts';
import {
  acceptSummarize,
  downloadModel,
  ensureModel,
  modelAvailability,
  prewarm,
  tryEnableModel,
} from './summarize.ts';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse): boolean | undefined => {
  if (msg.type === 'openOptions') {
    chrome.action
      .openPopup()
      .catch(() =>
        chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html#settings') }),
      );
    return;
  }
  // The content script cannot open the tab itself: window.open after an await has lost the
  // user gesture and gets blocked.
  if (msg.type === 'openTab') {
    chrome.tabs.create({ url: msg.url });
    return;
  }
  // A runner tab reporting in. Closing it here rather than from the page: a tab cannot close
  // itself when it was not opened by script. done() also starts the next video.
  if (msg.type === 'jobDone' || msg.type === 'jobFailed') {
    console.info('[watchless]', msg.type, msg.v, msg.reason ?? '');
    void done(sender.tab?.id);
    return;
  }
  // The popup's backfill. Fire and forget: it counts what it sent, nothing waits for the run.
  if (msg.type === 'enqueue') {
    void enqueue(msg.ids);
    return;
  }
  // The debug button: poll and step now rather than at the next alarm. Answers with the queue
  // depth left behind, so the popup can say something truthful about what the poll found.
  if (msg.type === 'pollNow') {
    poll()
      .then(next)
      .then(getQueue)
      .then((queue) => sendResponse({ queued: queue.length }))
      .catch(() => sendResponse({ queued: 0 }));
    return true;
  }
  // Hand crank, queue bypassed: chrome.runtime.sendMessage({type:'runNow', v:'<videoId>'}) from
  // the worker console.
  if (msg.type === 'runNow') {
    void openRunner(msg.v);
    return;
  }
  // The headless transcript, asked here and not from the page on purpose: a fetch from the worker
  // is cross-origin, so it carries no youtube.com cookie. That anonymity is the point — the
  // InnerTube route works because the call is not the signed-in WEB client.
  if (msg.type === 'transcript') {
    fetchTranscript(msg.v, (url, init) => fetch(url, init))
      .then((res) => sendResponse(res.text))
      .catch(() => sendResponse(null));
    return true;
  }
  // Fire and forget: the page asks on arrival, nothing waits for the answer.
  if (msg.type === 'prewarm') {
    prewarm();
    return;
  }
  const respond = (promise: Promise<Availability>) => {
    promise
      .then((availability) => sendResponse({ availability }))
      .catch(() => sendResponse({ availability: 'unavailable' }));
    return true; // async response
  };
  if (msg.type === 'modelStatus') return respond(modelAvailability());
  if (msg.type === 'modelDownload') return respond(downloadModel().then(announce));
  if (msg.type === 'modelEnableAnyway') return respond(tryEnableModel().then(announce));
});

// The open 'model' ports of every /watch tab. The popup's "Download" and "Enable anyway" can
// make the model appear after those ports already answered 'unavailable' — without this, their
// button only shows up on the next navigation. addButton() is idempotent, so a repeat is free.
const modelPorts = new Set<chrome.runtime.Port>();

const announce = (availability: Availability): Availability => {
  if (availability === 'available')
    for (const p of modelPorts) p.postMessage({ state: 'available' });
  return availability;
};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'model') {
    modelPorts.add(port);
    port.onDisconnect.addListener(() => modelPorts.delete(port));
    ensureModel().then((state) => port.postMessage({ state }));
  }
  if (port.name === 'summarize') acceptSummarize(port);
});

// --- Passive watch -----------------------------------------------------------
// Alarms survive the worker's death; the worker is woken to handle them. They do not always
// survive an extension update, hence the re-arm on both lifecycle events.
chrome.runtime.onStartup.addListener(() => void ensureAlarms());
chrome.runtime.onInstalled.addListener(() => void ensureAlarms());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void poll();
  if (alarm.name === TICK_ALARM) void next();
});

// The poll interval lives in the settings, and an alarm keeps whatever period it was created with:
// without this, changing it in the popup would only take effect at the next browser start.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.pollMinutes) void ensureAlarms();
});
