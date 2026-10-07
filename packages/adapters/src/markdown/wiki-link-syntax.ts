import { WikiLinkReader } from '@atlas/domain';
import type { Code, Construct, Extension, State, TokenizeContext } from 'micromark-util-types';
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token,
} from 'mdast-util-from-markdown';
import type { Processor } from 'unified';
import './mdast-custom-nodes.ts';

/**
 * `[[Note]]` as one token of markdown, read before emphasis, code and HTML
 * can claim its characters: without it, `[[_draft_]]` reads as a link around
 * italics, and `\[\[x]]` — brackets the note escaped — as a link once remark
 * has taken the escapes off (A21-03).
 *
 * The grammar is the domain's (`WikiLinkReader`), fed code by code: the one
 * the index, a rename, tags and plain text read the raw text by
 * (`wikiLinkSpans`), so none of them can find a link the editor does not show
 * (A21-04, ADR-0004). This file only translates micromark's codes for it, and
 * looks past the link for a backtick that would close a code span opened in
 * it — which, as in CommonMark, wins over the link.
 */

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikiLink: 'wikiLink';
  }
}

const EXCLAMATION = 33;
const LEFT_BRACKET = 91;
const GRAVE_ACCENT = 96;

/**
 * A code as the character it stands for. Micromark splits a tab into a tab
 * code (-2) and virtual spaces (-1), and writes any line ending as one code
 * below -2; the reader needs only to know each for whitespace or a break.
 */
function characterOf(code: Code): string | null {
  if (code === null) return null;
  if (code === -2) return '\t';
  if (code === -1) return ' ';
  if (code < -2) return '\n';
  return String.fromCharCode(code);
}

function tokenizeWikiLink(
  this: TokenizeContext,
  effects: Parameters<Construct['tokenize']>[0],
  ok: State,
  nok: State,
): State {
  const reader = new WikiLinkReader();

  const start: State = (code) => {
    effects.enter('wikiLink');
    return inside(code);
  };

  const inside: State = (code) => {
    const step = reader.read(characterOf(code));
    if (step === 'reject') return nok(code);
    effects.consume(code);
    if (step === 'more') return inside;
    effects.exit('wikiLink');
    const { openers } = reader;
    if (openers.length === 0) return ok;
    // A backtick run in the link that a later run closes is a code span, not a link.
    return (next: Code) => effects.check(closerAhead(openers), nok, ok)(next);
  };

  return start;
}

/**
 * Succeeds when a run of exactly one of `lengths` backticks follows before the
 * text ends: the paragraph's, heading's or table cell's end, as micromark hands
 * it over.
 */
function closerAhead(lengths: readonly number[]): Construct {
  return {
    partial: true,
    tokenize(effects, ok, nok) {
      let run = 0;
      const scan: State = (code) => {
        if (code === GRAVE_ACCENT) {
          run += 1;
          return consumed(code);
        }
        if (run > 0 && lengths.includes(run)) return ok(code);
        run = 0;
        if (code === null) return nok(code);
        return consumed(code);
      };
      const consumed = (code: Code): State | undefined => {
        const type = code !== null && code < -2 ? 'lineEnding' : 'data';
        effects.enter(type);
        effects.consume(code);
        effects.exit(type);
        return scan;
      };
      return scan;
    },
  };
}

const wikiLinkConstruct: Construct = { name: 'wikiLink', tokenize: tokenizeWikiLink };

/** The micromark side: the construct, tried at `[` and `!` before anything else there. */
export const wikiLinkSyntax: Extension = {
  text: { [LEFT_BRACKET]: wikiLinkConstruct, [EXCLAMATION]: wikiLinkConstruct },
};

/** The mdast side: a `wikiLink` node whose value is the link as written. */
export const wikiLinkFromMarkdown: FromMarkdownExtension = {
  enter: {
    wikiLink(this: CompileContext, token: Token) {
      this.enter({ type: 'wikiLink', value: '' }, token);
    },
  },
  exit: {
    wikiLink(this: CompileContext, token: Token) {
      const node = this.stack.at(-1);
      if (node?.type === 'wikiLink') node.value = this.sliceSerialize(token);
      this.exit(token);
    },
  },
};

/** The unified plugin that adds both to a parser. */
export function remarkWikiLink(this: Processor): void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(wikiLinkSyntax);
  (data.fromMarkdownExtensions ??= []).push(wikiLinkFromMarkdown);
}
