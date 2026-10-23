import { Fragment, memo, type ReactNode } from 'react';
import type { AnswerBlock, AnswerInline } from '@dfai/domain';
import { openHowFrom, type OpenHow } from '../open-how.ts';
import type { AskAnswerView } from './ask-view.ts';

interface AnswerLinks {
  readonly onFollowCitation: (link: string, how: OpenHow) => void;
  readonly onOpenWeb: (url: string) => void;
}

/**
 * An answer on Ask (#37), drawn from its blocks: never as HTML. A citation is
 * a chip that opens its note at the block; a paragraph that cites nothing is
 * kept in full and marked "not cited" once the answer is finished.
 */
export const AskAnswer = memo(function AskAnswer({
  answer,
  links,
}: {
  answer: AskAnswerView;
  links: AnswerLinks;
}) {
  return (
    <div className="ask__answer">
      {quotedRuns(answer.blocks).map(({ quoted, blocks }, at) => {
        const drawn = groupItems(blocks).map((run, index) =>
          drawRun({ run, at: index, answer, links }),
        );
        // A list in a quote is drawn in it, each item judged on its own.
        return quoted ? (
          <blockquote key={at} className="ask__quote ask__quote--list">
            {drawn}
          </blockquote>
        ) : (
          <Fragment key={at}>{drawn}</Fragment>
        );
      })}
    </div>
  );
});

/** The blocks, with each run of blocks from one quoted list gathered, so the quote is drawn as one. */
function quotedRuns(
  blocks: readonly AnswerBlock[],
): { readonly quoted: boolean; readonly blocks: readonly AnswerBlock[] }[] {
  const runs: { quoted: boolean; blocks: AnswerBlock[] }[] = [];
  for (const block of blocks) {
    const last = runs.at(-1);
    if (last !== undefined && last.quoted === block.quoted) last.blocks.push(block);
    else runs.push({ quoted: block.quoted, blocks: [block] });
  }
  return runs;
}

/** Blocks with each run of list items gathered, so a list is drawn as one. */
type Run = { readonly list: readonly AnswerBlock[] } | { readonly block: AnswerBlock };

function groupItems(blocks: readonly AnswerBlock[]): Run[] {
  const runs: Run[] = [];
  for (const block of blocks) {
    const last = runs.at(-1);
    if (block.kind === 'item' && last !== undefined && 'list' in last) {
      runs[runs.length - 1] = { list: [...last.list, block] };
    } else runs.push(block.kind === 'item' ? { list: [block] } : { block });
  }
  return runs;
}

function drawRun({
  run,
  at,
  answer,
  links,
}: {
  run: Run;
  at: number;
  answer: AskAnswerView;
  links: AnswerLinks;
}): ReactNode {
  if ('block' in run)
    return <Block key={at} block={run.block} checked={answer.checked} links={links} />;
  return (
    <ul key={at} className="ask__list">
      {run.list.map((block, index) => (
        <li
          key={index}
          className="ask__item"
          style={{ marginInlineStart: `${block.depth * 1.25}rem` }}
          data-ordered={/^\d/.test(block.marker ?? '') || undefined}
          {...citedMark(block, answer.checked)}
        >
          {/^\d/.test(block.marker ?? '') && <span className="ask__marker">{block.marker}</span>}
          <Pieces pieces={block.inline} links={links} />
          <Uncited block={block} checked={answer.checked} />
        </li>
      ))}
    </ul>
  );
}

function Block({
  block,
  checked,
  links,
}: {
  block: AnswerBlock;
  checked: boolean;
  links: AnswerLinks;
}) {
  const pieces = <Pieces pieces={block.inline} links={links} />;
  const mark = citedMark(block, checked);
  switch (block.kind) {
    case 'heading':
      return <h3 className="ask__heading">{pieces}</h3>;
    case 'rule':
      return <hr className="ask__rule" />;
    case 'code':
      return (
        <pre className="ask__code">
          <code>{block.inline.map((piece) => ('text' in piece ? piece.text : '')).join('')}</code>
        </pre>
      );
    case 'quote':
      // A quoted paragraph is already inside the quote it was written in.
      if (block.quoted) {
        return (
          <p className="ask__para" {...mark}>
            {pieces}
            <Uncited block={block} checked={checked} />
          </p>
        );
      }
      return (
        <blockquote className="ask__quote" {...mark}>
          {pieces}
          <Uncited block={block} checked={checked} />
        </blockquote>
      );
    case 'table':
      return (
        <div className="ask__table" {...mark}>
          {pieces}
          <Uncited block={block} checked={checked} />
        </div>
      );
    default:
      return (
        <p className="ask__para" {...mark}>
          {pieces}
          <Uncited block={block} checked={checked} />
        </p>
      );
  }
}

function citedMark(block: AnswerBlock, checked: boolean) {
  return checked && block.citation === 'uncited' ? { 'data-uncited': true } : {};
}

/** The quiet word after a block that cites nothing: shown, never hiding the block. */
function Uncited({ block, checked }: { block: AnswerBlock; checked: boolean }) {
  if (!checked || block.citation !== 'uncited') return null;
  return (
    <span className="ask__uncited" title="Nothing here links to the note it came from">
      not cited
    </span>
  );
}

function Pieces({ pieces, links }: { pieces: readonly AnswerInline[]; links: AnswerLinks }) {
  return pieces.map((piece, at) => <Piece key={at} piece={piece} links={links} />);
}

function Piece({ piece, links }: { piece: AnswerInline; links: AnswerLinks }) {
  switch (piece.kind) {
    case 'text':
      return piece.text;
    case 'code':
      return <code className="ask__inline-code">{piece.text}</code>;
    case 'cite':
      return (
        <button
          type="button"
          className="ask__cite"
          data-hue="blue"
          title={`Open ${piece.link} (⌘-click: new tab)`}
          onClick={(event) => links.onFollowCitation(piece.link, openHowFrom(event))}
        >
          {piece.label}
        </button>
      );
    case 'web':
      return (
        <a
          className="ask__web"
          href={piece.url}
          title={piece.url}
          onClick={(event) => {
            // The window never navigates: the browser opens it.
            event.preventDefault();
            links.onOpenWeb(piece.url);
          }}
        >
          {piece.label}
          {piece.host !== null && <span className="ask__host"> ({piece.host})</span>}
        </a>
      );
  }
}
