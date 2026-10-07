import type { BuilderQuery, QueryProblem } from '@atlas/domain';
import { SegmentedControl } from '../segmented-control.tsx';
import { QueryBuilder, type QueryBuilderProps } from './query-builder.tsx';
import { QueryText } from './query-text.tsx';

export type ComposerMode = 'builder' | 'text';

export interface QueryComposerProps {
  readonly mode: ComposerMode;
  /** Asks for the other mode; the page may refuse the builder a query it cannot show. */
  readonly onMode: (mode: ComposerMode) => void;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  /** What is wrong with the text, pointing at where. */
  readonly problem: QueryProblem | null;
  readonly onRun: () => void;
  /** The query as the builder holds it; null while it is being edited as text. */
  readonly builder: BuilderQuery | null;
  readonly onBuilderChange: (builder: BuilderQuery) => void;
  /** Why the builder cannot show this query, when it cannot: it stays text. */
  readonly textOnly: string | null;
  readonly choices: Pick<QueryBuilderProps, 'types' | 'fields' | 'valueChoices'>;
}

const MODES = [
  { value: 'builder' as const, label: 'Builder' },
  { value: 'text' as const, label: 'Text' },
];

/**
 * One query, two ways to edit it (P24-02): dropdowns, or the text they write.
 * Switching is free while the builder can show the query; when it cannot, the
 * page says why and the query stays text rather than being mangled.
 */
export function QueryComposer(props: QueryComposerProps) {
  return (
    <section className="qcomposer" aria-label="Query">
      <div className="qcomposer__head">
        <SegmentedControl
          label="Edit the query as"
          options={MODES}
          value={props.mode}
          onChange={props.onMode}
        />
        {props.mode === 'builder' && props.text !== '' && (
          <code className="qcomposer__preview" aria-label="Query text">
            {props.text}
          </code>
        )}
      </div>
      {props.textOnly !== null && props.mode === 'text' && (
        <p className="qcomposer__notice" role="status">
          {props.textOnly}
        </p>
      )}
      {props.mode === 'builder' && props.builder !== null ? (
        <QueryBuilder builder={props.builder} onChange={props.onBuilderChange} {...props.choices} />
      ) : (
        <QueryText
          text={props.text}
          onChange={props.onTextChange}
          problem={props.problem}
          onRun={props.onRun}
        />
      )}
      {props.mode === 'builder' && props.problem !== null && (
        <p className="qcomposer__problem" role="alert">
          {props.problem.message}
        </p>
      )}
    </section>
  );
}
