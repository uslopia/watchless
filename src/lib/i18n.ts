// The single chrome.i18n adapter. All extension contexts share it instead of redefining t().
import type { Badge, Preset } from './types.ts';

export const t = (key: string, ...args: unknown[]): string =>
  chrome.i18n.getMessage(key, args.map(String));

// Section titles follow the preset when it defines one, else fall back to the generic title.
export const sectionTitle = (name: string, preset: Preset | null | undefined): string =>
  t(`section_${name}_${preset}`) || t(`section_${name}`);

// Translates a badge list from checkBadges() into display text.
export const badgeText = (badges: Badge[]): string[] =>
  badges.map((b) => (b.arg ? t(b.key, b.arg) : t(b.key)));
