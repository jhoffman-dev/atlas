import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import {
  hasWords,
  type DocumentMatch,
  type PageRect,
  type PagePoint,
  type PdfPageText,
  type PlacedTextRun,
} from '@dfai/domain';
import type { ReaderDocument, ReaderHighlight, ReaderPageSize } from './reader-types.ts';

/*
 * One page of the reader (#504): the page drawn into a canvas, its words in
 * a layer of transparent text over it to select, the highlights and the
 * find matches on it, and — on a page with no words — a box to drag for an
 * area highlight. Drawn only while it is near the screen.
 */

export interface PdfPageProps {
  readonly pdf: ReaderDocument;
  readonly page: number;
  readonly zoom: number;
  /** The page's size while its own is read: the document's first page's. */
  readonly estimate: ReaderPageSize;
  readonly highlights: readonly ReaderHighlight[];
  readonly matches: readonly DocumentMatch[];
  readonly currentMatch: DocumentMatch | null;
  readonly flashing: string | null;
  /** A box dragged on a page with no words, corners in fractions of the page. */
  readonly onAreaDrawn: (args: {
    page: number;
    from: PagePoint;
    to: PagePoint;
    at: DOMRect;
  }) => void;
}

export const PdfPage = memo(function PdfPage(props: PdfPageProps) {
  const { pdf, page, zoom } = props;
  const { size: read, text } = usePageFacts(pdf, page);
  const size = read ?? props.estimate;
  const width = size.width * zoom;
  const height = size.height * zoom;
  const scanned = text !== null && !hasWords(text);
  return (
    <div
      className="pdf-page"
      data-pdf-page={page}
      data-text-length={text?.text.length ?? 0}
      aria-label={`Page ${page}`}
      role="region"
      style={{ width, height }}
    >
      <PageCanvas pdf={pdf} page={page} zoom={zoom} width={width} height={height} />
      {text !== null && <TextLayer text={text} width={width} height={height} />}
      <Marks
        page={page}
        zoom={zoom}
        highlights={props.highlights}
        matches={props.matches}
        currentMatch={props.currentMatch}
        flashing={props.flashing}
      />
      {scanned && <AreaLayer page={page} onAreaDrawn={props.onAreaDrawn} />}
    </div>
  );
});

/** What the PDF says of a page: its own size and its words, each null until read. */
interface PageFacts {
  readonly size: ReaderPageSize | null;
  readonly text: PdfPageText | null;
}

const UNREAD: PageFacts = { size: null, text: null };

/**
 * A page's size and words, read together so the page is drawn again once
 * for both, not once for each.
 */
function usePageFacts(pdf: ReaderDocument, page: number): PageFacts {
  const [facts, setFacts] = useState<PageFacts>(UNREAD);
  useEffect(() => {
    let live = true;
    void Promise.allSettled([pdf.pageSize(page), pdf.pageText(page)]).then(([size, text]) => {
      if (!live) return;
      setFacts({
        // The first page's size stands in: the page still draws, only perhaps at the wrong height.
        size: size.status === 'fulfilled' ? size.value : null,
        // A page whose words cannot be read is still drawn; it only has nothing to select.
        text: text.status === 'fulfilled' ? text.value : { text: '', runs: [] },
      });
    });
    return () => {
      live = false;
    };
  }, [pdf, page]);
  return facts;
}

const PageCanvas = memo(function PageCanvas({
  pdf,
  page,
  zoom,
  width,
  height,
}: {
  pdf: ReaderDocument;
  page: number;
  zoom: number;
  width: number;
  height: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const target = canvas.current;
    if (target === null) return;
    const drawing = pdf.drawPage({
      page,
      canvas: target,
      scale: zoom * (globalThis.devicePixelRatio || 1),
    });
    let live = true;
    drawing.done.then(
      () => live && setFailed(false),
      // Cancelled because the page scrolled away or the zoom changed: not a failure.
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      drawing.cancel();
    };
  }, [pdf, page, zoom]);
  return (
    <>
      <canvas
        ref={canvas}
        className="pdf-page__canvas"
        aria-hidden="true"
        style={{ width, height }}
      />
      {failed && <p className="pdf-page__failed">This page could not be drawn.</p>}
    </>
  );
});

/**
 * The page's words, each run where it sits, stretched to the width the PDF
 * gives it so a selection covers what is drawn under it.
 */
const TextLayer = memo(function TextLayer({
  text,
  width,
  height,
}: {
  text: PdfPageText;
  width: number;
  height: number;
}) {
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const spans = [...(layer.current?.querySelectorAll<HTMLElement>('[data-start]') ?? [])];
    // Read every width before writing any transform, so the layout is worked out once.
    const natural = spans.map((span) => span.offsetWidth);
    spans.forEach((span, at) => {
      const wanted = Number(span.dataset['width']);
      const own = natural[at] ?? 0;
      const stretch = own > 0 && wanted > 0 ? `scaleX(${wanted / own})` : '';
      const turn = span.dataset['turn'];
      span.style.transform = turn === undefined ? stretch : `rotate(${turn}rad) ${stretch}`.trim();
    });
  }, [text, width, height]);
  return (
    <div ref={layer} className="pdf-text">
      {text.runs.map((run) => (run.text === '' ? null : runSpan(run, width, height)))}
    </div>
  );
});

/**
 * One run where it is drawn: along its box, or, for a turned run, from its
 * first letter's top corner and turned the way it reads, so a drag along
 * turned text selects the part of it under the pointer.
 */
function runSpan(run: PlacedTextRun, width: number, height: number) {
  const placed = spanPlacement(run, width, height);
  return (
    <span
      key={run.start}
      data-start={run.start}
      data-end={run.end}
      data-width={placed.length}
      data-turn={placed.turn}
      className="pdf-text__run"
      style={{ left: placed.left, top: placed.top, fontSize: placed.size, lineHeight: 1 }}
    >
      {run.text}
    </span>
  );
}

function spanPlacement(run: PlacedTextRun, width: number, height: number) {
  const { box, direction } = run;
  if (direction === undefined) {
    return {
      left: box.x * width,
      top: box.y * height,
      size: box.height * height,
      length: box.width * width,
      turn: undefined,
    };
  }
  const advance = { x: direction.advance.x * width, y: direction.advance.y * height };
  const rise = { x: direction.rise.x * width, y: direction.rise.y * height };
  return {
    // The span's top-left corner is the top of the run's first letter.
    left: direction.origin.x * width + rise.x,
    top: direction.origin.y * height + rise.y,
    size: Math.hypot(rise.x, rise.y),
    length: Math.hypot(advance.x, advance.y),
    turn: Math.atan2(advance.y, advance.x),
  };
}

const Marks = memo(function Marks({
  page,
  highlights,
  matches,
  currentMatch,
  flashing,
  zoom,
}: Pick<PdfPageProps, 'page' | 'highlights' | 'matches' | 'currentMatch' | 'flashing'> & {
  zoom: number;
}) {
  const here = highlights.filter(
    (highlight) => highlight.placement.kind !== 'lost' && highlight.placement.page === page,
  );
  const found = matches.filter((match) => match.page === page);
  return (
    <div className="pdf-marks" aria-hidden="true" data-zoom={zoom}>
      {here.map((highlight) =>
        highlight.placement.kind === 'lost'
          ? null
          : highlight.placement.rects.map((rect, at) => (
              <div
                key={`${highlight.id}-${at}`}
                data-highlight={highlight.id}
                className={markClass(highlight, flashing)}
                style={boxStyle(rect)}
              />
            )),
      )}
      {found.map((match) =>
        match.rects.map((rect, at) => (
          <div
            key={`find-${match.start}-${at}`}
            className={match === currentMatch ? 'pdf-find pdf-find--current' : 'pdf-find'}
            style={boxStyle(rect)}
          />
        )),
      )}
    </div>
  );
});

function markClass(highlight: ReaderHighlight, flashing: string | null): string {
  const classes = [
    'pdf-mark',
    `pdf-mark--${highlight.style.mark}`,
    `pdf-mark--${highlight.style.color}`,
  ];
  if (highlight.placement.kind === 'boxes') classes.push('pdf-mark--approximate');
  if (flashing === highlight.id) classes.push('pdf-mark--flash');
  return classes.join(' ');
}

const boxStyle = (rect: PageRect) => ({
  left: `${rect.x * 100}%`,
  top: `${rect.y * 100}%`,
  width: `${rect.width * 100}%`,
  height: `${rect.height * 100}%`,
});

/** On a page with no words: drag a box to highlight it. */
function AreaLayer({
  page,
  onAreaDrawn,
}: {
  page: number;
  onAreaDrawn: PdfPageProps['onAreaDrawn'];
}) {
  const [drag, setDrag] = useState<{ from: PagePoint; to: PagePoint } | null>(null);
  const pointAt = (event: PointerEvent<HTMLDivElement>): PagePoint => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) / (box.width || 1),
      y: (event.clientY - box.top) / (box.height || 1),
    };
  };
  return (
    <div
      className="pdf-area"
      title="Drag a box to highlight an area of this page"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const at = pointAt(event);
        setDrag({ from: at, to: at });
      }}
      onPointerMove={(event) => drag !== null && setDrag({ ...drag, to: pointAt(event) })}
      onPointerUp={(event) => {
        if (drag === null) return;
        const to = pointAt(event);
        setDrag(null);
        onAreaDrawn({ page, from: drag.from, to, at: event.currentTarget.getBoundingClientRect() });
      }}
    >
      {drag !== null && (
        <div
          className="pdf-area__box"
          style={boxStyle({
            x: Math.min(drag.from.x, drag.to.x),
            y: Math.min(drag.from.y, drag.to.y),
            width: Math.abs(drag.to.x - drag.from.x),
            height: Math.abs(drag.to.y - drag.from.y),
          })}
        />
      )}
    </div>
  );
}
