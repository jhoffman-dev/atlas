import { PILL_HUES } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { readStylesheet } from './styles.test-support.ts';

/**
 * The pill hues (#413): the muted pastels an option that is not a status, a
 * linked note and a tag are drawn in, so the eye finds them again. Each ink
 * has to read on its own fill at AA — 4.5:1 — in light, in the dark the app
 * chose and in the dark the system asked for, and each fill has to stay a
 * pastel: a fill loud enough to shout would undo the calm the hues are for.
 * The list of hues is the domain's, so a hue added there without its colours
 * fails here.
 */

const css = readStylesheet().replace(/\/\*[\s\S]*?\*\//g, '');

/** A theme's tokens: the declarations of the first block that opens with `opening`. */
function paletteOf(opening: string): Map<string, string> {
  const start = css.indexOf(opening);
  if (start < 0) throw new Error(`no palette ${opening}`);
  const open = css.indexOf('{', start + opening.length - 1);
  const body = css.slice(open + 1, css.indexOf('}', open));
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]),
  );
}

const THEMES = {
  light: paletteOf(":root,\n[data-theme='light'] {"),
  'chosen dark': paletteOf("[data-theme='dark'] {"),
  'system dark': paletteOf(":root:not([data-theme='light']) {"),
} as const;

function hexOf(theme: Map<string, string>, token: string): string {
  const value = theme.get(token);
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${token} is not a hex colour (${String(value)})`);
  }
  return value;
}

const channel = (hex: string, at: number) => {
  const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** How far a colour is from grey: the spread of its channels, 0–255. */
function chroma(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
}

const cases = Object.entries(THEMES).flatMap(([theme, tokens]) =>
  PILL_HUES.map((hue) => ({ theme, tokens, hue })),
);

describe('the pill hues', () => {
  it('are nine, as the domain lists them', () => {
    expect(PILL_HUES).toHaveLength(9);
  });

  it.each(cases)('$hue reads at AA on its own fill in $theme', ({ tokens, hue }) => {
    const ratio = contrast(hexOf(tokens, `--hue-${hue}-ink`), hexOf(tokens, `--hue-${hue}-bg`));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('$hue keeps a muted fill in $theme', ({ tokens, hue }) => {
    // A pastel: near the surface in lightness, low in chroma. Notion's own
    // light fills sit near 30; a saturated chip would be well past 60.
    expect(chroma(hexOf(tokens, `--hue-${hue}-bg`))).toBeLessThanOrEqual(45);
  });

  it.each(cases)(
    '$hue fill stays a quiet ground, not a block of colour, in $theme',
    ({ theme, tokens, hue }) => {
      const surface = hexOf(tokens, '--surface');
      const fill = hexOf(tokens, `--hue-${hue}-bg`);
      // Close enough to the surface to read as a tint; the ink carries the words.
      expect(contrast(fill, surface), `${theme} ${hue}`).toBeLessThan(1.6);
    },
  );

  it.each(PILL_HUES)('paints a %s pill from its own tokens', (hue) => {
    const rule = new RegExp(
      String.raw`\[data-hue='${hue}'\]\s*\{[^}]*--pill:\s*var\(--hue-${hue}-bg\);[^}]*--pill-ink:\s*var\(--hue-${hue}-ink\);`,
    );
    expect(css).toMatch(rule);
  });
});
