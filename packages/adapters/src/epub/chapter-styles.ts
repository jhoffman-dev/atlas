import { bookReference } from '@dfai/domain';
import {
  declarationsIn,
  importsIn,
  namesAddress,
  namesStringOrAddress,
  valueMade,
  type AddressMade,
  type Declaration,
} from './css-references.ts';

/*
 * A book's stylesheets, made to load only from the book (#505, ADR-0045 §5).
 * The CSS is read by the browser's own parser, into a constructed stylesheet
 * that is never adopted: it fetches nothing and ignores every `@import`.
 * Each rule is walked, into `@media`, `@supports`, `@layer`, `@keyframes`
 * and nested rules, and each declaration's addresses (`css-references.ts`)
 * are read against the file the CSS is written in: one of the book's files
 * becomes the address the frame loads it from, its `#place` kept; one
 * written in (`data:`) or a place in the chapter (`#id`) stays; and a
 * declaration naming anything else is dropped. A rule of another kind that
 * names an address it cannot keep as written is dropped whole. The sheet is
 * written out again as the parser serialises it, so what the frame is given
 * is what a browser read, not the book's spelling of it.
 *
 * The parser drops `@import`, so the book's own imports are found in its
 * text first (`importsIn`) and put before its rules, made the same way. Only
 * the book's own files are followed: a spelling the scan misses is an import
 * the parser drops. Each is inlined at most once, within a budget, so a book
 * that imports itself over and over costs no more than one that does not.
 * The frame's policy still stands behind this.
 */

/** How the frame loads a file of the book: its address, or null when the book has no such file. */
export type FileAddress = (path: string) => Promise<string | null>;

/** How deep `@import`s are followed. */
const MOST_IMPORT_DEPTH = 4;
/** The most stylesheets one sheet's `@import`s may read, however deep: a book has a handful. */
export const MOST_IMPORTS = 64;
/** The most one sheet may be, in characters; a longer one is dropped whole, before it is read. */
export const MOST_SHEET_LENGTH = 2 * 1024 * 1024;
/** The most all of one sheet's imported sheets may be together, in characters. */
export const MOST_IMPORTED_LENGTH = 4 * 1024 * 1024;

/** What one sheet's `@import`s have read so far: each sheet is inlined at most once. */
interface ImportBudget {
  readonly seen: Set<string>;
  imports: number;
  length: number;
}

/**
 * `css`, written in the book's file at `from`, with every reference made
 * the book's own or dropped. `stylesheet` reads one of the book's
 * stylesheets for an `@import`.
 */
export async function bookCss({
  css,
  from,
  address,
  stylesheet,
}: {
  css: string;
  from: string;
  address: FileAddress;
  stylesheet: (path: string) => Promise<string | null>;
}): Promise<string> {
  const budget: ImportBudget = { seen: new Set([from]), imports: 0, length: 0 };
  return sheetMade({ css, from, address, stylesheet, depth: 0, budget });
}

async function sheetMade({
  css,
  from,
  address,
  stylesheet,
  depth,
  budget,
}: {
  css: string;
  from: string;
  address: FileAddress;
  stylesheet: (path: string) => Promise<string | null>;
  depth: number;
  budget: ImportBudget;
}): Promise<string> {
  if (css.length > MOST_SHEET_LENGTH) return '';
  const imports: string[] = [];
  if (depth < MOST_IMPORT_DEPTH) {
    for (const ref of importsIn(css)) {
      const target = bookReference({ from, ref });
      if (target.kind !== 'inside' || budget.seen.has(target.path)) continue;
      if (budget.imports >= MOST_IMPORTS) break;
      budget.seen.add(target.path);
      budget.imports += 1;
      const text = await stylesheet(target.path);
      if (text === null || text.length > MOST_SHEET_LENGTH) continue;
      if (budget.length + text.length > MOST_IMPORTED_LENGTH) continue;
      budget.length += text.length;
      imports.push(
        await sheetMade({
          css: text,
          from: target.path,
          address,
          stylesheet,
          depth: depth + 1,
          budget,
        }),
      );
    }
  }
  const sheet = parsed(css);
  await rulesMade(sheet, addressMade({ from, address }));
  const own = Array.from(sheet.cssRules, (rule) => rule.cssText);
  return [...imports, ...own].join('\n');
}

/** `style`, a `style=` written in the book's file at `from`, its declarations made the same way. */
export async function bookDeclarations({
  style,
  from,
  address,
}: {
  style: string;
  from: string;
  address: FileAddress;
}): Promise<string> {
  // A rule around the declarations, read as a style attribute is; anything after a `}` that
  // closes it early is another rule, and is left out.
  const first = parsed(`*{${style}\n}`).cssRules[0];
  if (!(first instanceof CSSStyleRule)) return '';
  await declarationsMade(first.style, addressMade({ from, address }));
  return first.style.cssText;
}

/** `css` read by the browser's parser, into a sheet no document adopts: it loads nothing. */
function parsed(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  return sheet;
}

/** What each address becomes, read against `from`: kept, the book's file's address, or null to drop it. */
function addressMade({ from, address }: { from: string; address: FileAddress }): AddressMade {
  return async (ref) => {
    // A place in the chapter itself (`#id`), or a file written in, loads nothing.
    if (ref.trim().startsWith('#')) return 'keep';
    const target = bookReference({ from, ref });
    if (target.kind === 'data') return 'keep';
    if (target.kind === 'outside') return null;
    const found = await address(target.path);
    if (found === null) return null;
    return target.fragment === null ? found : `${found}#${encodeURIComponent(target.fragment)}`;
  };
}

/** A rule list the parser gave, and how one of its rules is taken out. */
interface RuleList {
  readonly cssRules: CSSRuleList;
  deleteRule?(index: number): void;
}

/** Every rule in `list`, and the rules inside each, made the book's own; a rule that cannot be is taken out. */
async function rulesMade(list: RuleList, made: AddressMade): Promise<void> {
  for (let at = list.cssRules.length - 1; at >= 0; at -= 1) {
    const rule = list.cssRules[at];
    if (rule === undefined || rule instanceof CSSNamespaceRule) continue;
    if (rule instanceof CSSImportRule) {
      takeOut(list, at);
      continue;
    }
    const style = 'style' in rule ? (rule.style as CSSStyleDeclaration) : null;
    const inner = 'cssRules' in rule ? (rule as unknown as RuleList) : null;
    if (style !== null) await declarationsMade(style, made);
    if (inner !== null) await rulesMade(withDelete(inner), made);
    if (style === null && inner === null && (await namesAddress(rule.cssText, made))) {
      // An `@property`, an `@counter-style`: it holds no declarations to drop one of.
      takeOut(list, at);
    }
  }
}

function takeOut(list: RuleList, at: number): void {
  // Never left in when it cannot be taken out: the rule names what may not stay.
  if (list.deleteRule === undefined) throw new Error('a rule of the book could not be taken out');
  list.deleteRule(at);
}

/**
 * `list`, taking a rule out by its place. A `@keyframes` takes one out by
 * its key instead, and holds only keyframes, whose declarations are made in
 * place; none is ever taken out of it.
 */
function withDelete(list: RuleList): RuleList {
  return list instanceof CSSKeyframesRule ? { cssRules: list.cssRules } : list;
}

/** Each declaration in `style` with its addresses made; one naming an address that may not stay is dropped. */
async function declarationsMade(style: CSSStyleDeclaration, made: AddressMade): Promise<void> {
  // The addresses given here are the book's own files: read again below, they stay.
  const given = new Set<string>();
  const giving: AddressMade = async (ref) => {
    const next = await made(ref);
    if (next !== null && next !== 'keep') given.add(next);
    return next;
  };
  await longhandsMade(style, giving);
  await writtenOutMade(style, async (ref) => (given.has(ref) ? 'keep' : made(ref)));
}

/** Each declaration `style` lists, longhand by longhand, its addresses made. */
async function longhandsMade(style: CSSStyleDeclaration, made: AddressMade): Promise<void> {
  const names = Array.from({ length: style.length }, (_, at) => style.item(at));
  for (const name of names) {
    const value = style.getPropertyValue(name);
    const next = await valueMade(value, made);
    if (next === value) continue;
    if (next !== null) {
      style.setProperty(name, next, style.getPropertyPriority(name));
      // A value the parser refuses leaves the old one: that one may not stay either.
      if (style.getPropertyValue(name) !== value) continue;
    }
    style.removeProperty(name);
  }
}

/**
 * Each declaration as `style` writes it out, shorthands and all, read
 * again: WebKit writes a shorthand built with `var()` out as the book spelled
 * it, every longhand of it empty, so reading longhand by longhand never saw
 * what is inside it. One that may not stay is dropped; if the parser keeps
 * any such one, none of the declarations stay.
 */
async function writtenOutMade(style: CSSStyleDeclaration, made: AddressMade): Promise<void> {
  const written = declarationsIn(style.cssText);
  const kept: string[] = [];
  for (const declaration of written) {
    if (!(await mayNotStay(declaration, made))) kept.push(declaration.text);
  }
  if (kept.length === written.length) return;
  style.cssText = kept.join(' ');
  for (const declaration of declarationsIn(style.cssText)) {
    if (await mayNotStay(declaration, made)) {
      style.cssText = '';
      return;
    }
  }
}

/**
 * Whether `declaration` names an address that may not stay, builds one from
 * `var()`, `env()` or `attr()`, or is a custom property that could give a
 * `var()` an address: a string, a `url()` or an address function.
 */
async function mayNotStay({ name, value }: Declaration, made: AddressMade): Promise<boolean> {
  if (name.startsWith('--') && namesStringOrAddress(value)) return true;
  return namesAddress(value, made);
}
