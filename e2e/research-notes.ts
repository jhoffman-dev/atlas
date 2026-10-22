/**
 * Literature notes for the research views' tests (#507), written in the
 * format of ADR-0043 by the domain's own marker writer: one quote block per
 * highlight, its hidden marker, its comment, then its `^id`.
 */
import {
  highlightMarker,
  type HighlightAnchor,
  type HighlightColor,
} from '../packages/domain/src/index.ts';

export interface FixtureHighlight {
  readonly id: string;
  readonly quote: string;
  readonly comment?: string;
  readonly color?: HighlightColor;
  readonly mark?: 'highlight' | 'underline';
  /** A PDF page, or a Kindle location when `kind` is kindle. */
  readonly at: number;
}

export interface FixtureSource {
  readonly title: string;
  readonly author?: string;
  readonly kind: 'pdf' | 'epub' | 'kindle';
  readonly tags?: readonly string[];
  readonly project?: string;
  readonly highlights: readonly FixtureHighlight[];
}

function anchorOf(kind: FixtureSource['kind'], highlight: FixtureHighlight): HighlightAnchor {
  const quote = { exact: highlight.quote, prefix: '', suffix: '' };
  if (kind === 'kindle') {
    return { kind, location: { start: highlight.at, end: null }, annotationId: null };
  }
  if (kind === 'epub') return { kind, cfi: `epubcfi(/6/${highlight.at * 2}!/4/2)`, quote };
  return { kind, page: highlight.at, quote, rects: [] };
}

function block(kind: FixtureSource['kind'], highlight: FixtureHighlight): string {
  const marker = highlightMarker({
    style: { mark: highlight.mark ?? 'highlight', color: highlight.color ?? 'yellow' },
    anchor: anchorOf(kind, highlight),
  });
  const comment = highlight.comment === undefined ? [] : ['>', `> ${highlight.comment}`];
  return [`> ${highlight.quote}`, `> ${marker}`, ...comment, '', `^${highlight.id}`].join('\n');
}

/** A literature note's text: its frontmatter, then each highlight's block, a blank line between. */
export function literatureNote(source: FixtureSource): string {
  const front = [
    '---',
    'type: literature',
    `kind: ${source.kind}`,
    `title: ${JSON.stringify(source.title)}`,
    ...(source.author === undefined ? [] : [`author: ${JSON.stringify(source.author)}`]),
    ...(source.tags === undefined ? [] : [`tags: [${source.tags.join(', ')}]`]),
    ...(source.project === undefined ? [] : [`project: "[[${source.project}]]"`]),
    '---',
    '',
  ];
  return `${front.join('\n')}${source.highlights.map((each) => block(source.kind, each)).join('\n\n')}\n`;
}
