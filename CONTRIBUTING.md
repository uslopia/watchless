# Contributing to Watchless

Thanks for taking the time. Watchless is a small, deliberately minimal
extension: the best contributions here usually remove more than they add.

## Before you write code

- **Bug?** Open an issue with the Chrome version, the OS, and the video URL if
  it is reproducible on a specific one. Nano failures depend on hardware, so
  the requirements table in the README is the first thing to check.
- **Feature?** Open an issue first. Watchless summarizes on-device and sends
  nothing anywhere; anything that needs a server, an API key, or a shared
  database is out of scope by design.
- Small fixes (typo, broken locale key, dead code) need no issue — send the PR.

## Setup

```
npm install
npm run watch      # esbuild in watch mode -> dist/
```

Load the extension: `chrome://extensions` → developer mode → "Load unpacked" →
select `dist/`. After a rebuild, the extension still has to be reloaded by hand.

Node 22.18+ is required: the tests run directly on the `.ts` sources through
Node's native type stripping, with no transpile step.

## The loop

```
npm test           # node --test, pure logic in src/lib/
npm run check      # Biome + tsc --noEmit — must pass before a PR
npm run knip       # dead code / unused exports
npm run build      # minified build, what CI checks
```

Single file: `node --test tests/summarize.test.ts`.
Single case: `node --test --test-name-pattern '<name>'`.

## Constraints that bite

These are the four things a PR most often trips on. All of them are enforced by
tests or the type checker, so you will find out — this is just the shortcut.

- **No hard-coded UI string.** Everything goes through `chrome.i18n` /
  `data-i18n`. `tests/i18n.test.ts` checks that every locale has exactly the
  keys of `en`, and that composed keys (`section_<x>_<preset>`,
  `check_promise_<value>`, `format_<x>`) exist for every real value. Adding a
  format, a preset or a check breaks that test until `_locales/{en,fr}` follow.
- **No non-erasable TypeScript.** `tsconfig` runs `erasableSyntaxOnly`: no
  `enum`, no `namespace`, no parameter properties. Imports carry the `.ts`
  extension. That is what lets `node --test` read the sources directly.
- **`src/lib/` stays free of `chrome.*`** (`i18n.ts` and `storage.ts` are the
  two deliberate adapters). It is the only part that is unit-testable under
  Node, so keep logic there and keep the DOM out of it.
- **The content `state` resets on every navigation.** Any code resuming after
  an `await` must carry its data as an argument, never re-read `state`.

New logic in `src/lib/` ships with a test. UI and `chrome.*` glue does not —
there is no browser harness here, and adding one is not worth it.

Comments, identifiers, commit messages and docs are in English. UI strings live
in `_locales/` and are translated to `en` and `fr`.

## Pull requests

- One concern per PR. A refactor bundled with a fix gets asked to split.
- Match the surrounding style; Biome settles the rest (`npm run format`).
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Fill in the PR template: what changed, why, and how you checked it.
- CI runs `check`, `test`, `knip` and `build` on every PR. Green before review.

By contributing you agree that your work is licensed under the
[MIT License](LICENSE), and you are expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
