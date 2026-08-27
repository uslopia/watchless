import { t } from '../lib/i18n.ts';

export function waitFor<T>(fn: () => T | null | undefined, timeout: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      const v = fn();
      if (v) {
        clearInterval(id);
        resolve(v);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(id);
        reject(new Error(t('error_element_not_found')));
      }
    };
    const id: ReturnType<typeof setInterval> = setInterval(tick, 100);
    tick(); // the element is usually already there: skip a wasted tick
  });
}

export const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

export const videoId = () => new URLSearchParams(location.search).get('v');
