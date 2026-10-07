import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const css = read('./styles.css');
/** The gallery's own sheet, loaded beside the app's and held to the same palette rule. */
const galleryCss = read('./gallery/gallery.css');

/**
 * A stylesheet with its comments taken out.
 *
 * Rules are found by looking at what sits between braces, and a comment before
 * a rule hides that rule from a scan that expects a brace or the start of the
 * file in front of every selector. The first version of this file had exactly
 * that hole, and it made the last check below pass over the bug it exists for.
 */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const withoutComments = stripComments(css);

/** Every rule, as its selector and the declarations inside it. */
function rulesOf(source: string) {
  return [...stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => ({
    selector: (rule[1] ?? '').trim(),
    body: rule[2] ?? '',
  }));
}
const rules = rulesOf(css);

/**
 * Every `--name:` the stylesheet declares, wherever it declares it.
 *
 * Read from the commentless source for the same reason the rules are: a
 * declaration that has been commented out is not a declaration, and counting
 * it would let this file pass over the very bug it exists to catch.
 */
const declared = new Set(
  [...withoutComments.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1] ?? ''),
);

/** Every `var(--name)` it reads, with the fallback (if any) alongside. */
const used = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)].map((match) => ({
  name: match[1] ?? '',
  hasFallback: match[2] === ',',
}));

/** A hex colour, or one written as a function — what a token should hold. */
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

/**
 * Whether a rule only declares the palette: every selector in it is `:root`,
 * a `[data-theme=…]` block, or `:root` with or without one — nothing that
 * reaches an element. `[data-theme='dark'] .card` styles a card, not a theme.
 */
const THEME_SELECTOR = /^(?::root)?(?::not\(\[data-theme='[a-z]+'\]\)|\[data-theme='[a-z]+'\])?$/;
function isTokenBlock(selector: string): boolean {
  return selector
    .split(',')
    .map((part) => part.trim())
    .every((part) => part !== '' && THEME_SELECTOR.test(part));
}

/**
 * Raw colours written anywhere but a token's declaration inside a palette block.
 * Even there, only `--*:` lines may hold one: `:root { background: #fff }` is a
 * component colour that happens to sit on the root.
 */
function rawColourOffenders(source: string): string[] {
  return rulesOf(source).flatMap(({ selector, body }) =>
    body
      .split(';')
      .filter((declaration) => !(isTokenBlock(selector) && declaration.trim().startsWith('--')))
      .flatMap((declaration) =>
        [...declaration.matchAll(RAW_COLOUR)].map((match) => `${selector} -> ${match[0]}`),
      ),
  );
}

describe('the stylesheet', () => {
  /**
   * A token that is read but never declared resolves to nothing, which CSS
   * swallows in silence. This has cost us twice: `--border-strong` was trimmed
   * while two donut slices still referenced it, so both fell back to the same
   * near-invisible grey and the chart lost two of its slices.
   */
  it('declares every token it reads', () => {
    const missing = [
      ...new Set(used.filter((token) => !declared.has(token.name)).map((t) => t.name)),
    ];
    expect(missing).toEqual([]);
  });

  /**
   * A fallback on a token that does exist is dead weight that hides the failure
   * above — the fallback answers, so nobody notices the token went away.
   */
  it('does not paper over a token it declares with a fallback', () => {
    const papered = [
      ...new Set(
        used.filter((token) => token.hasFallback && declared.has(token.name)).map((t) => t.name),
      ),
    ];
    expect(papered).toEqual([]);
  });

  /**
   * Colours are roles: a component reads `var(--ink-2)`, never `#4e577a`, so a
   * theme is one block to change and dark cannot drift from light one rule at
   * a time. A raw colour belongs only in a rule that declares tokens — `:root`
   * or a `[data-theme]` block — and this fails the moment one is written
   * anywhere else.
   */
  it.each([
    ['styles.css', css],
    ['gallery.css', galleryCss],
  ])('%s writes raw colours only where tokens are declared', (_name, source) => {
    expect(rawColourOffenders(source)).toEqual([]);
  });

  it.each([
    ["[data-theme='dark'] .card { background: #123 }", ["[data-theme='dark'] .card -> #123"]],
    [':root { background: #fff; --ink: #000 }', [':root -> #fff']],
    [".card, [data-theme='dark'] { --edge: rgb(0, 0, 0) }", [".card, [data-theme='dark'] -> rgb("]],
  ])('finds the raw colour in %s', (source, found) => {
    expect(rawColourOffenders(source)).toEqual(found);
  });

  it.each([
    ':root { --ink: #000 }',
    "[data-theme='dark'] { --ink: #fff }",
    ":root:not([data-theme='light']) { --ink: #fff }",
    ":root, [data-theme='light'], [data-theme='dark'] { --edge: rgba(0, 0, 0, 0.1) }",
  ])('lets a palette block declare a token as a raw colour: %s', (source) => {
    expect(rawColourOffenders(source)).toEqual([]);
  });

  /**
   * A `color-mix` resolves where it is written. Declared on `:root` it is
   * computed once against the root's theme and then inherited as a fixed
   * colour, so a subtree carrying its own `data-theme` keeps the wrong one —
   * which is how a selected row in the gallery's dark panel came out lavender.
   *
   * A mix inside an ordinary component rule is fine: it resolves at that
   * element, against whatever theme the element is under. Only the root-level
   * ones have to name every theme they are meant to serve.
   */
  it('gives a root-level colour mix a value for every theme', () => {
    const offenders: string[] = [];

    for (const { selector, body } of rules) {
      if (!selector.includes(':root')) continue;

      const mixes = [...body.matchAll(/(--[a-z0-9-]+)\s*:[^;]*color-mix/g)].map(
        (match) => match[1] ?? '',
      );
      if (mixes.length === 0) continue;

      // Either this very rule serves the dark theme too, or another rule must.
      const servesDark =
        selector.includes("[data-theme='dark']") ||
        mixes.every((name) =>
          rules.some(
            (other) =>
              other.selector.includes("[data-theme='dark']") &&
              new RegExp(`${name}\\s*:`).test(other.body),
          ),
        );

      if (!servesDark) offenders.push(`${selector} -> ${mixes.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });
});
