// Note outputs: Obsidian and a local file. No network output — that is the extension's promise,
// not an implementation detail.
import { sanitizeTitle } from './note.ts';

type Agent = keyof typeof AGENTS;

const trimSlashes = (s: string): string => s.trim().replace(/^\/+|\/+$/g, '');

export function obsidianUri(
  vault: string,
  folder: string | null | undefined,
  title: string,
  note: string,
): string {
  const dir = trimSlashes(folder ?? '');
  const file = (dir ? `${dir}/` : '') + sanitizeTitle(title);
  return (
    `obsidian://new?vault=${encodeURIComponent(vault)}` +
    `&file=${encodeURIComponent(file)}` +
    `&content=${encodeURIComponent(note)}`
  );
}

export const noteFilename = (title: string): string => `${sanitizeTitle(title)}.md`;

// Blob + <a download> rather than chrome.downloads: works identically from the popup and from
// the content script, and avoids asking for an extra permission.
export function downloadMarkdown(title: string, note: string): void {
  const url = URL.createObjectURL(new Blob([note], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = noteFilename(title);
  a.click();
  // Deferred: click() only queues the download, and revoking before it reads the blob is the
  // classic "Failed - Network error".
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Send to a chat: the link carries the whole note (~2 KB once encoded, a query string handles it
// comfortably). The transcript would not fit — it is the summary that gets deepened, not the raw
// material.
const AGENTS = {
  claude: 'https://claude.ai/new?q=',
  chatgpt: 'https://chatgpt.com/?q=',
};

// English whatever the note's language: frontier models are more reliable there, and they answer
// in the language of the content that follows.
const PROMPT =
  'Below are my notes on a YouTube video, summarized by a small on-device model. ' +
  'Go deeper: challenge the claims, fill in the context it missed, and flag anything it got ' +
  'wrong or too thin.';

export const agentUri = (agent: Agent, note: string): string =>
  AGENTS[agent] + encodeURIComponent(`${PROMPT}\n\n${note}`);
