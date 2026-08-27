// Bundles the extension into dist/, mirroring the src/ layout so manifest.json, the pages'
// relative <link href="../styles/theme.css"> and getURL('src/popup/popup.html') keep working
// with zero path edits.
//   node build.mjs [--watch] [--minify]
import { watch } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const dev = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');

const common = {
  bundle: true,
  outbase: '.', // src/background/index.ts -> dist/src/background/index.js
  outdir: 'dist',
  target: 'chrome138', // manifest.minimum_chrome_version
  minify,
  sourcemap: !minify,
  logLevel: 'info',
};

// Content scripts are classic scripts, hence IIFE — that is the whole reason for the build step.
// The other three are real ES modules (summary has a top-level await).
const builds = [
  {
    ...common,
    format: 'esm',
    entryPoints: ['src/background/index.ts', 'src/popup/popup.ts', 'src/summary/summary.ts'],
  },
  { ...common, format: 'iife', entryPoints: ['src/content/index.ts'] },
];

// Only what Chrome reads verbatim. Sources are bundled, never copied: the extension-relative
// paths below are the ones the manifest and the HTML pages point at.
const copyStatic = () =>
  Promise.all([
    cp('manifest.json', 'dist/manifest.json'),
    cp('_locales', 'dist/_locales', { recursive: true }),
    cp('icons', 'dist/icons', { recursive: true }),
    cp('src', 'dist/src', { recursive: true, filter: (p) => !/\.[jt]s$/.test(p) }),
  ]);

await rm('dist', { recursive: true, force: true });
await copyStatic();

if (dev) {
  for (const options of builds) await (await esbuild.context(options)).watch();
  // Unthrottled recopy — 6 files, a save burst costs nothing.
  watch('src', { recursive: true }, (_e, f) => {
    if (f && !/\.[jt]s$/.test(f)) copyStatic();
  });
} else {
  await Promise.all(builds.map((o) => esbuild.build(o)));
}
