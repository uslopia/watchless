import assert from 'node:assert/strict';
import test from 'node:test';
import { agentUri, noteFilename, obsidianUri } from '../src/lib/export.ts';

const fileOf = (uri: string) => decodeURIComponent(new URL(uri).searchParams.get('file') ?? '');

test('obsidianUri: vault, folder and title', () => {
  const uri = obsidianUri('MonVault', 'Youtube', 'Le cerveau', '# note');
  assert.match(uri, /^obsidian:\/\/new\?/);
  assert.equal(new URL(uri).searchParams.get('vault'), 'MonVault');
  assert.equal(fileOf(uri), 'Youtube/Le cerveau');
  assert.equal(new URL(uri).searchParams.get('content'), '# note');
});

test('obsidianUri: folder slashes normalized', () => {
  for (const folder of ['Youtube/', '/Youtube', '/Youtube/']) {
    assert.equal(fileOf(obsidianUri('V', folder, 'T', '')), 'Youtube/T');
  }
});

test('obsidianUri: subfolder preserved', () => {
  assert.equal(fileOf(obsidianUri('V', 'Inbox/Youtube', 'T', '')), 'Inbox/Youtube/T');
});

test('obsidianUri: empty folder -> vault root', () => {
  assert.equal(fileOf(obsidianUri('V', '', 'T', '')), 'T');
  assert.equal(fileOf(obsidianUri('V', '   ', 'T', '')), 'T');
});

test('obsidianUri: a / in a title does not create a phantom folder', () => {
  assert.equal(fileOf(obsidianUri('V', 'Youtube', 'AC/DC en live', '')), 'Youtube/AC-DC en live');
});

test('obsidianUri: everything is percent-encoded', () => {
  const uri = obsidianUri('Mon Vault', 'Youtube', 'Café & thé', 'a=1&b=2');
  assert.equal(uri.includes(' '), false);
  assert.equal(new URL(uri).searchParams.get('vault'), 'Mon Vault');
  assert.equal(new URL(uri).searchParams.get('content'), 'a=1&b=2');
  assert.equal(fileOf(uri), 'Youtube/Café & thé');
});

test('noteFilename: sanitized title and extension', () => {
  assert.equal(noteFilename('AC/DC en live'), 'AC-DC en live.md');
});

test('agentUri: the whole note goes in the query string', () => {
  const note = '# Titre\n\n## TL;DR\nUn resume & des "guillemets".\n';
  const url = new URL(agentUri('claude', note));
  assert.equal(url.origin + url.pathname, 'https://claude.ai/new');
  assert.match(url.searchParams.get('q') ?? '', /Below are my notes/);
  assert.ok((url.searchParams.get('q') ?? '').endsWith(note));
  assert.equal(new URL(agentUri('chatgpt', note)).hostname, 'chatgpt.com');
});
