# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm run build      # esbuild -> dist/ (minified)
npm run watch      # esbuild in watch mode + static file recopy
npm run typecheck  # tsc --noEmit (esbuild does not type-check)
npm test           # node --test (tests run on the .ts sources, no transpile step)
npm run check      # biome check + typecheck — run before calling anything done
npm run knip       # dead code / unused exports
```

Single file: `node --test tests/summarize.test.ts`. Single case: `node --test --test-name-pattern '<name>'`.

Load the extension: `chrome://extensions` → developer mode → "load unpacked" → `dist/`.
After `npm run watch`, the extension still has to be reloaded by hand.

Comments, identifiers and the README are in English.

## Architecture

Chrome MV3 extension: summarizes a YouTube video **on-device** through Gemini Nano
(`LanguageModel`, Prompt API). No network call outside youtube.com.

**Three contexts, one port per run.**

- `src/content/` — the YouTube page. `index.ts` drives the lifecycle
  (`yt-navigate-finish` → `init()`), `scrape.ts` reads the DOM/HTML, `panel.ts`
  writes the UI (a centred fixed sheet over the page, the video paused), `state.ts` holds the
  session state.
- `src/background/` — service worker. `index.ts` routes messages and ports,
  `summarize.ts` drives the Nano sessions.
- `src/lib/` — pure logic, tested under Node, no `chrome.*` dependency
  (except `i18n.ts` and `storage.ts`, the two deliberate adapters).
- `src/popup/`, `src/summary/` — HTML pages (history + settings; full-screen sheet).

**Port protocol** (`ToWorker`/`FromWorker` in `lib/types.ts`) — the one cross-file
contract with no test behind it, hence its explicit typing:

- port `model`: the worker answers `available` once the model is on disk.
  **No button is injected into the page until it does.**
- port `summarize`: the content script sends `warm` (language, preset, meta) *before*
  it has the transcript — the Nano session loads while the fetch runs — then
  `transcript`. The worker replies `download` / `progress` / `error` / `done`.
  A disconnect before `done` means the worker died, not a normal end.

**The summary pipeline** (`background/summarize.ts`) is a five-phase map-reduce, each
phase on a `session.clone()` (clean context, system prompt kept):
`prepare` → `frame` (format detection) → `analyze` (map over chunks, `CONCURRENCY = 2`)
→ `synthesis` (reduce, `responseConstraint`) → `check` (the checks).
The progress weight of each phase lives in `lib/perf.ts` (`PHASES`).
Chunk size is **measured** (`measureInputUsage`), not estimated, and reserves
`OUTPUT_SHARE` of the quota for the output.

**Two prompt axes, composed** (`lib/summarize.ts`): `FORMATS` (what the video *is* —
detected by the model) × `PRESETS` (what to take from it — chosen by the user).
Prompts stay in English, the target language is named inside them.
`Format`/`Preset`/`Phase` are derived from those const objects: adding an entry
updates the type, never the other way round.

**Storage**: one record per `wl:<id>` key in `storage.local` (not one array — two
concurrent writers cannot clobber each other), settings in `storage.sync`.
Every read goes through `lib/storage.ts`, the only place typed above
`chrome.storage`'s `any`. Records are deliberately source-agnostic
(`source: 'youtube'`, `author`, `words`) so non-video content fits without a migration.

## Non-obvious constraints

- **The build exists for one reason**: an MV3 content script is a classic script, so it
  needs IIFE. The other three entry points come out as ESM. `build.mjs` mirrors the
  `src/` tree into `dist/`, so the manifest paths and the pages' relative `<link>`s
  stay untouched.
- **`tsconfig` is strict + `erasableSyntaxOnly` + `allowImportingTsExtensions`**:
  imports carry the `.ts` extension, and nothing non-erasable (enum, namespace,
  parameter property) is allowed — that is what lets `node --test` read the sources
  directly.
- **No hard-coded string in the UI**: everything goes through `chrome.i18n` / `data-i18n`.
  `tests/i18n.test.ts` checks that every locale has exactly the keys of `en` and that
  composed keys (`section_<x>_<preset>`, `check_promise_<value>`, `format_<x>`) exist
  for every real value. Adding a format, a preset or a check breaks that test until
  `_locales/{en,fr}` follow.
- Biome: `useHeadingContent` and `noLabelWithoutControl` are off — HTML labels are
  injected at runtime, the source is empty on purpose.
- The content `state` is reset on every navigation: any code resuming after an `await`
  must carry its data as an argument, never re-read `state`.
