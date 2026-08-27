import {
  acceptSummarize,
  downloadModel,
  ensureModel,
  modelAvailability,
  prewarm,
  tryEnableModel,
} from './summarize.ts';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse): boolean | undefined => {
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
