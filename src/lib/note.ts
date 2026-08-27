import type { Checks, NoteMeta, Summary } from './types.ts';

export function sanitizeTitle(title: string): string {
  return title.replaceAll('/', '-');
}

// Backslash first, or the escapes get escaped. Titles carry them more often than they look
// (kaomoji, Windows paths), and one stray \d makes Obsidian drop the whole frontmatter block.
function yamlEscape(s: string): string {
  return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

// Section labels come from the caller (chrome.i18n on the content script side): the lib stays
// pure and testable outside Chrome.
const DEFAULT_LABELS = { tldr: 'TL;DR', ideas: 'Key ideas' };

// One line per filled check: the frontmatter stays greppable in Obsidian (`sources: none`), and
// a note from before checks keeps exactly the shape it had.
function checkLines(checks: Partial<Checks> | null | undefined): string {
  if (!checks) return '';
  return [
    checks.promise && `promise: ${checks.promise}`,
    checks.sources && `sources: ${checks.sources}`,
    checks.sponsor && `sponsor: "${yamlEscape(checks.sponsor)}"`,
    checks.paid && 'paid: true',
  ]
    .filter(Boolean)
    .map((line) => `${line}\n`)
    .join('');
}

export function buildNote(
  meta: NoteMeta,
  summary: Summary,
  format?: string | null,
  labels?: { tldr?: string; ideas?: string },
): string {
  const { tldr, ideas } = { ...DEFAULT_LABELS, ...labels };
  const tags = ['youtube', ...summary.tags].join(', ');
  return `---
title: "${yamlEscape(meta.title)}"
source: "${meta.url}"
channel: "${yamlEscape(meta.channel)}"
duration: "${meta.duration}"
published: ${meta.published}
captured: ${meta.captured}
${format ? `format: ${format}\n` : ''}${checkLines(meta.checks)}tags: [${tags}]
---

# ${meta.title}

## ${tldr}
${summary.tldr}

## ${ideas}
${summary.idees.map((i: string) => `- ${i}`).join('\n')}
`;
}
