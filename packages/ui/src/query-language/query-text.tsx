import type { QueryProblem } from '@atlas/domain';
import { isImeKey } from '../ime.ts';

/**
 * The query as text (P24-01): what is saved in the view's file. A problem is
 * shown under it with the line it is on and the characters that caused it
 * marked, so a mistake is pointed at rather than described.
 */
export function QueryText({
  text,
  onChange,
  problem,
  onRun,
}: {
  text: string;
  onChange: (text: string) => void;
  problem: QueryProblem | null;
  /** Cmd+Enter: run now, rather than waiting for the text to settle. */
  onRun?: () => void;
}) {
  return (
    <div className="qtext">
      <textarea
        className={`qtext__area${problem === null ? '' : ' qtext__area--invalid'}`}
        aria-label="Query"
        aria-invalid={problem !== null}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="FROM task WHERE status != done SORT BY due GROUP BY project THEN status"
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !isImeKey(event)) {
            event.preventDefault();
            onRun?.();
          }
        }}
      />
      {problem !== null && <ProblemNote text={text} problem={problem} />}
    </div>
  );
}

function ProblemNote({ text, problem }: { text: string; problem: QueryProblem }) {
  const place = placeOf(text, problem.span.start);
  const line = text.split('\n')[place.line - 1] ?? '';
  const from = place.column - 1;
  const to = Math.max(from + 1, from + (problem.span.end - problem.span.start));
  return (
    <div className="qtext__problem" role="alert">
      <p className="qtext__message">
        <span className="qtext__where">
          Line {place.line}, column {place.column}
        </span>
        {problem.message}
      </p>
      <code className="qtext__line" aria-hidden="true">
        {line.slice(0, from)}
        <mark className="qtext__mark">{line.slice(from, to) || ' '}</mark>
        {line.slice(to)}
      </code>
    </div>
  );
}

/** Where an offset falls, counted from 1 as an editor counts. */
function placeOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}
