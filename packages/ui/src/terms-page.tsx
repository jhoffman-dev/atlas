import { useId, useState, type FormEvent } from 'react';
import {
  listAsInput,
  newTermRefusal,
  TERM_KINDS,
  termKindOf,
  type TermKind,
  type TermNote,
  type SpellingWarning,
  type VaultPath,
  type VocabularyClaim,
  type VocabularyConflict,
} from '@atlas/domain';
import { CommitField } from './commit-field.tsx';
import { Icon } from './icon.tsx';
import { PageAction, PageBar, type PageHistory } from './page-bar.tsx';
import { HiddenTitle } from './page-head.tsx';

/** What the Terms page lists, once it has been read. */
export interface TermsContents {
  /** In the order of their right spellings. */
  readonly terms: readonly TermNote[];
  readonly conflicts: readonly VocabularyConflict[];
  /** Misheard spellings that may not do what their author meant. */
  readonly warnings: readonly SpellingWarning[];
  /** How many misheard spellings Atlas puts right. */
  readonly spellings: number;
}

/** A term as the add form gives it: what was typed, commas between variants. */
export interface NewTerm {
  readonly canonical: string;
  readonly variants: string;
  readonly kind: TermKind | null;
}

export interface TermsPageProps {
  /** Null while the index is being asked. */
  contents: TermsContents | null;
  error: string | null;
  /** Writes a note of type term; the list shows it once the index has it. */
  onAdd: (term: NewTerm) => void;
  /** Changes a term's variants to what was typed, commas between them. */
  onEditVariants: (args: { path: VaultPath; variants: string }) => void;
  onOpen: (path: VaultPath) => void;
  onShowSidebar?: () => void;
  history?: PageHistory;
}

/**
 * Terms: the names a notetaker gets wrong and how each is spelt — every term,
 * the ways it is misheard, and any spelling two notes disagree about, which
 * Atlas leaves alone until one of them lets it go.
 */
export function TermsPage(props: TermsPageProps) {
  const counted = describe(props.contents);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <PageBar
        crumb={{ icon: 'term', parent: 'Terms' }}
        name="All terms"
        {...(counted !== null && { count: counted })}
        actions={
          <PageAction
            icon="plus"
            label="New term"
            tone="primary"
            expanded={adding}
            onPress={() => setAdding((was) => !was)}
          />
        }
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body">
        <article className="page page--wide terms" aria-label="Terms">
          <HiddenTitle>All terms</HiddenTitle>
          {adding && (
            <NewTermForm
              onAdd={(term) => {
                setAdding(false);
                props.onAdd(term);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {props.contents !== null && props.contents.conflicts.length > 0 && (
            <Conflicts conflicts={props.contents.conflicts} onOpen={props.onOpen} />
          )}
          <TermList {...props} />
        </article>
      </div>
    </>
  );
}

/** How many terms and spellings there are, beside the page's name; nothing while there are none. */
function describe(contents: TermsContents | null): string | null {
  if (contents === null) return null;
  const terms = contents.terms.length;
  const spellings = contents.spellings;
  if (terms === 0 && spellings === 0) return null;
  return `${terms} ${terms === 1 ? 'term' : 'terms'} · ${spellings} misheard ${spellings === 1 ? 'spelling' : 'spellings'}`;
}

/** The one place the app says how a spelling is matched (P28-07): field help, not a page subtitle. */
const MATCHING_RULE =
  'Put right exactly as written, capitals included. A person’s or company’s aliases link people and never correct text.';

function NewTermForm({
  onAdd,
  onCancel,
}: {
  onAdd: (term: NewTerm) => void;
  onCancel: () => void;
}) {
  const [canonical, setCanonical] = useState('');
  const [variants, setVariants] = useState('');
  const [kind, setKind] = useState<TermKind | null>(null);
  const [tried, setTried] = useState(false);
  const hintId = useId();
  const problem = newTermRefusal(canonical);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problem === null) onAdd({ canonical: canonical.trim(), variants, kind });
  };

  return (
    <form className="terms__new" aria-label="New term" onSubmit={submit}>
      <label className="terms__field">
        <span className="terms__label">Right spelling</span>
        <input
          className={tried && problem !== null ? 'field field--invalid' : 'field'}
          type="text"
          value={canonical}
          placeholder="Larkspur"
          aria-invalid={tried && problem !== null}
          onChange={(event) => setCanonical(event.target.value)}
        />
      </label>
      <label className="terms__field terms__field--grow">
        <span className="terms__label">Misheard as</span>
        <input
          className="field"
          type="text"
          value={variants}
          placeholder="lark spur, Larks Burr"
          aria-describedby={hintId}
          onChange={(event) => setVariants(event.target.value)}
        />
      </label>
      <p className="terms__hint" id={hintId}>
        {MATCHING_RULE}
      </p>
      <label className="terms__field terms__field--kind">
        <span className="terms__label">Kind</span>
        <span className="select">
          <select
            className="field select__control"
            value={kind ?? ''}
            onChange={(event) => setKind(termKindOf(event.target.value))}
          >
            <option value="">—</option>
            {TERM_KINDS.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </span>
      </label>
      <div className="terms__new-actions">
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary btn--sm">
          Add term
        </button>
      </div>
      <p className="terms__hint">
        Commas between the misheard spellings; one that holds a comma goes in double quotes, as in{' '}
        <code>&quot;Quill, Mara&quot;</code>. A spelling is matched exactly as written, capitals
        included: list <code>lark spur</code> and <code>Lark Spur</code> if both turn up.
      </p>
      {tried && problem !== null && (
        <p className="terms__problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

/** The spellings two notes disagree about, each with the notes that claim it. */
function Conflicts({
  conflicts,
  onOpen,
}: {
  conflicts: readonly VocabularyConflict[];
  onOpen: (path: VaultPath) => void;
}) {
  return (
    <section className="terms__conflicts" aria-label="Conflicts">
      <h2 className="terms__conflicts-title">
        <Icon name="term" size={16} />
        {conflicts.length === 1 ? '1 conflict' : `${conflicts.length} conflicts`}
      </h2>
      <p className="terms__conflicts-why">
        Each of these spellings is claimed by two notes that spell it differently, so Atlas leaves
        it as it is until one of them lets it go.
      </p>
      <ul className="terms__conflict-list">
        {conflicts.map((conflict) => (
          <li key={conflict.form} className="terms__conflict">
            <span className="terms__form">“{conflict.form}”</span>
            {conflict.claims.map((claim) => (
              <ClaimButton key={claim.path} claim={claim} onOpen={onOpen} />
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimButton({
  claim,
  onOpen,
}: {
  claim: VocabularyClaim;
  onOpen: (path: VaultPath) => void;
}) {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm terms__claim"
      aria-label={`${claim.canonical} (${claim.source})`}
      title={claim.path}
      onClick={() => onOpen(claim.path)}
    >
      {claim.canonical}
      <span className="terms__claim-source">{claim.source}</span>
    </button>
  );
}

function TermList({ contents, error, onOpen, onEditVariants }: TermsPageProps) {
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (contents === null) return <p className="table__empty">Reading the terms…</p>;
  if (contents.terms.length === 0) {
    return (
      <p className="terms__empty">
        No terms yet. Add the names a notetaker gets wrong — a product, a colleague, a vendor — with
        New term.
      </p>
    );
  }
  return (
    <div className="table">
      <div className="table__sheet">
        <table className="table__grid terms__grid">
          <thead>
            <tr>
              <th>Term</th>
              <th>Kind</th>
              <th>Misheard as</th>
            </tr>
          </thead>
          <tbody>
            {contents.terms.map((term) => (
              <tr key={term.path} className="table__row">
                <td className="table__name">
                  <button type="button" className="table__link" onClick={() => onOpen(term.path)}>
                    <Icon name="term" size={16} />
                    <span className="table__title">{term.canonical}</span>
                  </button>
                </td>
                <td className="terms__kind">{term.kind ?? '—'}</td>
                <td className="terms__variants">
                  <CommitField
                    className="field terms__variants-input"
                    label={`Misheard spellings of ${term.canonical}`}
                    value={listAsInput(term.variants)}
                    placeholder="None yet"
                    onCommit={(variants) => onEditVariants({ path: term.path, variants })}
                  />
                  <ConflictNote term={term} conflicts={contents.conflicts} />
                  <WarningNotes
                    warnings={contents.warnings.filter((warning) => warning.path === term.path)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Under a term's variants: which of its spellings another note claims too. */
function ConflictNote({
  term,
  conflicts,
}: {
  term: TermNote;
  conflicts: readonly VocabularyConflict[];
}) {
  const its = conflicts.filter((conflict) =>
    conflict.claims.some((claim) => claim.path === term.path),
  );
  if (its.length === 0) return null;
  return (
    <p className="terms__in-conflict">
      In conflict, so not used: {its.map((conflict) => `“${conflict.form}”`).join(', ')}
    </p>
  );
}

/** Under a term's variants: a spelling that is not used, or is also found alone inside another note's name. */
function WarningNotes({ warnings }: { warnings: readonly SpellingWarning[] }) {
  return (
    <>
      {warnings.map((warning) => (
        <p key={`${warning.kind}:${warning.variant}`} className="terms__in-conflict">
          {warning.kind === 'unusable'
            ? `“${warning.variant}” is not used: a spelling needs a letter or a digit.`
            : `“${warning.variant}” is also corrected on its own wherever it stands, though it is part of “${warning.name}”, which is left as written.`}
        </p>
      ))}
    </>
  );
}
