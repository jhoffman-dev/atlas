import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  acceptableAtOnce,
  duplicatesOf,
  isPickOne,
  proposalEntries,
  proposalHeadline,
  type ProposalEntry,
  type ProposalNote,
  type ProposalSlot,
  type VaultPath,
} from '@dfai/domain';
import { Icon } from '../icon.tsx';
import { SelectAllBox, SelectionBar, type RowSelection } from '../row-selection.tsx';
import { ConflictGroupRow } from './conflict-group.tsx';
import { ProposalRow } from './proposal-row.tsx';

/** What the Inbox's Proposals section lists, once the folder has been read. */
export interface ProposalsContents {
  /** Newest first. */
  readonly open: readonly ProposalNote[];
  /** Why each open proposal was made, by its path, as its maker wrote it; none for one that says nothing. */
  readonly reasons?: ReadonlyMap<VaultPath, string>;
  /** Answered, yet still in the Inbox: the Archive refused them. */
  readonly stranded: readonly ProposalNote[];
  /** The slots whose relation holds many values: proposals for them are never a pick-one. */
  readonly manyValued?: readonly ProposalSlot[];
  /** Notes that say they are proposals and cannot be read, with why. */
  readonly unreadable: readonly { readonly path: VaultPath; readonly problem: string }[];
}

export interface ProposalsSectionProps {
  /** Null while the folder is being read. */
  readonly contents: ProposalsContents | null;
  readonly error: string | null;
  /**
   * A failure with nothing to take back, said at the top of the section until
   * it is dismissed. What an answer did is said in the window's toast, with
   * its Undo (UI v2, slice 15).
   */
  readonly notice: string | null;
  /**
   * `undo` while an accept is being undone, which holds the answers until it
   * is; null otherwise. An answer itself holds nothing: its proposal leaves
   * the list at once, and is written behind it (#166).
   */
  readonly busy: 'undo' | null;
  /** Why answering a proposal was refused, by its path. */
  readonly problems: ReadonlyMap<VaultPath, string>;
  /** Whether answers are still being written: the section stays while they are, though none is left to answer. */
  readonly answering?: boolean;
  /**
   * Whether a proposal was answered here since the Inbox opened: the section
   * stays, once the last has gone, to say there is nothing left to answer.
   */
  readonly answered?: boolean;
  /** Accepts a proposal — with its payload as edited, when it was. */
  readonly onAccept: (path: VaultPath, payload?: unknown) => void;
  readonly onReject: (path: VaultPath) => void;
  /**
   * Accepts the proposal picked and, once that is written, rejects `rest`:
   * the other values of its question, and copies of the one picked. A refused
   * accept rejects nothing. One toast, one Undo for the whole choice.
   */
  readonly onAcceptChoice: (picked: VaultPath, rest: readonly VaultPath[]) => void;
  /** Which open proposals are chosen, to answer together (#168). */
  readonly selection: RowSelection;
  readonly onClearSelection: () => void;
  /** Accepts each of these as Accept would one, in turn; one Undo takes them all back. */
  readonly onAcceptMany: (paths: readonly VaultPath[]) => void;
  /** Rejects each of these as Reject would one, in turn. */
  readonly onRejectMany: (paths: readonly VaultPath[]) => void;
  /** Takes the failure said away, once it has been read. */
  readonly onDismissNotice: () => void;
  readonly onOpen: (path: VaultPath) => void;
  /** Opens the block a proposal cites, given as its link. */
  readonly onOpenSource: (link: string) => void;
}

/** Which proposals the list shows: every one, the sure ones, or the questions that need a pick. */
type Filter = 'all' | 'high' | 'choice';

const FILTERS: readonly { readonly filter: Filter; readonly label: string }[] = [
  { filter: 'all', label: 'All' },
  { filter: 'high', label: 'High confidence' },
  { filter: 'choice', label: 'Needs a choice' },
];

const NO_ENTRIES: readonly ProposalEntry[] = [];

/**
 * The proposals waiting for an answer, as a section of the Inbox page
 * (P29-02, P30-01, #307): what Claude or an automation suggested, each with
 * the line it came from, to accept, edit first, or reject. Nothing it
 * proposes is written until it is accepted. Proposals wait in the Inbox but
 * are answered here, never filed with the notes beside them. Several can be
 * chosen — Shift-click for a run of them — and accepted or rejected together
 * (#168); the sure ones all at once. Proposals that disagree are one "pick
 * one" question (Q12).
 */
export function ProposalsSection(props: ProposalsSectionProps) {
  const { heading, list, keepingFocus } = useFocusKeptOnAnswer(props.contents);
  const [filter, setFilter] = useState<Filter>('all');
  const open = props.contents?.open;
  const manyValued = props.contents?.manyValued;
  const entries = useMemo(
    () =>
      open === undefined ? NO_ENTRIES : proposalEntries(open, { manyValued: manyIn(manyValued) }),
    [open, manyValued],
  );
  const shown = useMemo(() => entries.filter(passes(filter)), [entries, filter]);
  const sure = useMemo(() => acceptableAtOnce(entries), [entries]);
  return (
    <section className="proposals" aria-label="Proposals">
      <div className="proposals__head">
        <h2 className="proposals__heading" tabIndex={-1} ref={heading}>
          <Icon name="spark" size={16} /> Proposals
        </h2>
        <p className="proposals__summary">{describe(props.contents)}</p>
        {entries.length > 0 && (
          <div className="segmented proposals__filters" role="group" aria-label="Show">
            {FILTERS.map((each) => (
              <button
                key={each.filter}
                type="button"
                className={`segmented__option${filter === each.filter ? ' segmented__option--on' : ''}`}
                aria-pressed={filter === each.filter}
                onClick={() => setFilter(each.filter)}
              >
                {each.label}
              </button>
            ))}
          </div>
        )}
        {sure.length > 0 && (
          <button
            type="button"
            className="btn btn--sm btn--positive"
            disabled={props.busy !== null}
            onClick={() => acceptAtOnce(props, entries, sure)}
          >
            Accept all high confidence
          </button>
        )}
      </div>
      {props.notice !== null && <Notice notice={props.notice} onDismiss={props.onDismissNotice} />}
      <Chosen {...props} entries={shown} />
      <ProposalList {...props} entries={shown} list={list} keepingFocus={keepingFocus} />
      {props.contents !== null && props.contents.stranded.length > 0 && (
        <Stranded stranded={props.contents.stranded} onOpen={props.onOpen} />
      )}
      {props.contents !== null && props.contents.unreadable.length > 0 && (
        <Unreadable unreadable={props.contents.unreadable} onOpen={props.onOpen} />
      )}
    </section>
  );
}

function passes(filter: Filter): (entry: ProposalEntry) => boolean {
  if (filter === 'all') return () => true;
  if (filter === 'choice') return isPickOne;
  return (entry) =>
    'one' in entry
      ? entry.one.confidence === 'high'
      : !isPickOne(entry) && entry.choice.confidence === 'high';
}

/** Which slots the type says hold many values. */
function manyIn(slots: readonly ProposalSlot[] | undefined): (slot: ProposalSlot) => boolean {
  if (slots === undefined || slots.length === 0) return () => false;
  return (slot) => slots.some((each) => each.note === slot.note && each.property === slot.property);
}

/** Accepts the sure ones at once; the copies of one are rejected only once it is accepted, so it is never applied twice. */
function acceptAtOnce(
  props: ProposalsSectionProps,
  entries: readonly ProposalEntry[],
  sure: readonly VaultPath[],
) {
  const copied = sure.filter((path) => duplicatesOf(entries, path).length > 0);
  for (const path of copied) props.onAcceptChoice(path, duplicatesOf(entries, path));
  const alone = sure.filter((path) => !copied.includes(path));
  if (alone.length > 0) props.onAcceptMany(alone);
}

/** Whether the section has anything to show: something to answer, to look at, to undo, or being written. */
export function proposalsToShow({
  contents,
  error,
  notice,
  answering = false,
  answered = false,
}: ProposalsSectionProps): boolean {
  if (error !== null || notice !== null || answering || answered) return true;
  if (contents === null) return false;
  return contents.open.length + contents.stranded.length + contents.unreadable.length > 0;
}

function describe(contents: ProposalsContents | null): string | null {
  if (contents === null) return null;
  const count = contents.open.length;
  return `${count} open ${count === 1 ? 'proposal' : 'proposals'} · nothing is written until you accept`;
}

/** A failure the last answer or undo left, which stays until it is read and dismissed. */
function Notice({ notice, onDismiss }: { notice: string; onDismiss: () => void }) {
  return (
    <div className="proposals__notice" role="status">
      <span>{notice}</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

/** The proposals listed on their own, in order: the ones a box can choose. */
const singles = (entries: readonly ProposalEntry[]): readonly ProposalNote[] =>
  entries.flatMap((entry) => ('one' in entry ? [entry.one] : []));

function ProposalList({
  entries,
  list,
  keepingFocus,
  ...props
}: ProposalsSectionProps & {
  entries: readonly ProposalEntry[];
  list: RefObject<HTMLUListElement | null>;
  /** Gives an answer from row `at`, its focus kept in the list once the row has left. */
  keepingFocus: (at: number, answer: () => void) => void;
}) {
  const { contents, error } = props;
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (contents === null) return <p className="table__empty">Reading the proposals…</p>;
  if (contents.open.length === 0) {
    return (
      <p className="proposals__empty">
        Nothing to answer. What Claude proposes lands here, in <code>Inbox/Proposals</code>.
      </p>
    );
  }
  if (entries.length === 0) return <p className="proposals__empty">None of these.</p>;
  const order = singles(entries).map((proposal) => proposal.path);
  return (
    <ul className="proposals__list" aria-label="Open proposals" ref={list}>
      {entries.map((entry, at) =>
        'choice' in entry && isPickOne(entry) ? (
          <li key={entry.choice.choices.map((choice) => choice.proposals[0]?.path).join('\n')}>
            <ConflictGroupRow
              group={entry.choice}
              busy={props.busy !== null}
              problems={props.problems}
              onAcceptChoice={(picked, rest) =>
                keepingFocus(at, () => props.onAcceptChoice(picked, rest))
              }
              onRejectMany={props.onRejectMany}
            />
          </li>
        ) : 'choice' in entry ? (
          <li key={entry.choice.choices[0]?.proposals[0]?.path}>
            <CopiedRow
              proposals={entry.choice.choices[0]?.proposals ?? []}
              {...props}
              reasons={contents.reasons}
              keepingFocus={(answer) => keepingFocus(at, answer)}
            />
          </li>
        ) : (
          <li key={entry.one.path}>
            <ProposalRow
              proposal={entry.one}
              {...(order.length > 1 && {
                selection: {
                  checked: props.selection.selected.has(entry.one.path),
                  onChange: ({ shift }: { shift: boolean }) =>
                    props.selection.onToggle(entry.one.path, shift ? { order } : undefined),
                },
              })}
              reason={contents.reasons?.get(entry.one.path) ?? null}
              busy={props.busy !== null}
              problem={props.problems.get(entry.one.path) ?? null}
              onAccept={(payload) =>
                keepingFocus(at, () => props.onAccept(entry.one.path, payload))
              }
              onReject={() => keepingFocus(at, () => props.onReject(entry.one.path))}
              onOpen={() => props.onOpen(entry.one.path)}
              onOpenSource={props.onOpenSource}
            />
          </li>
        ),
      )}
    </ul>
  );
}

/** One proposal made more than once, as the first of them: accepting it rejects the copies, rejecting it all of them. */
function CopiedRow({
  proposals,
  reasons,
  keepingFocus,
  ...props
}: ProposalsSectionProps & {
  proposals: readonly ProposalNote[];
  reasons: ProposalsContents['reasons'];
  keepingFocus: (answer: () => void) => void;
}) {
  const [first, ...copies] = proposals;
  if (first === undefined) return null;
  return (
    <>
      <ProposalRow
        proposal={first}
        reason={reasons?.get(first.path) ?? null}
        busy={props.busy !== null}
        problem={props.problems.get(first.path) ?? null}
        onAccept={() =>
          keepingFocus(() =>
            props.onAcceptChoice(
              first.path,
              copies.map((copy) => copy.path),
            ),
          )
        }
        onReject={() => keepingFocus(() => props.onRejectMany(proposals.map((each) => each.path)))}
        onOpen={() => props.onOpen(first.path)}
        onOpenSource={props.onOpenSource}
      />
      <p className="proposal-row__dup">Proposed {proposals.length} times; the copies go with it.</p>
    </>
  );
}

/** Choosing every proposal listed on its own, and what can be done to the chosen ones together. */
function Chosen({
  entries,
  selection,
  busy,
  onAcceptMany,
  onRejectMany,
  onClearSelection,
}: ProposalsSectionProps & { entries: readonly ProposalEntry[] }) {
  const paths = singles(entries).map((proposal) => proposal.path);
  if (paths.length < 2) return null;
  const chosen = paths.filter((path) => selection.selected.has(path));
  const many = chosen.length === 1 ? 'proposal' : `${chosen.length} proposals`;
  return (
    <div className="proposals__choose">
      <label className="proposals__all">
        <SelectAllBox paths={paths} selection={selection} />
        <span aria-hidden="true">Select all</span>
      </label>
      <SelectionBar
        count={chosen.length}
        actions={[
          { label: `Accept ${many}`, onRun: () => onAcceptMany(chosen), disabled: busy !== null },
          { label: `Reject ${many}`, onRun: () => onRejectMany(chosen), disabled: busy !== null },
        ]}
        onClear={onClearSelection}
        label="Chosen proposals"
      />
    </div>
  );
}

/**
 * An answered row leaves the list at once (#166), and the focus on its
 * button would fall to the page: it goes instead to the row that took its
 * place — the next, or the one before when it was the last — or, with none
 * left, to the section's heading, so the next answer is a key away.
 */
function useFocusKeptOnAnswer(contents: ProposalsContents | null) {
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const answeredAt = useRef<number | null>(null);
  useEffect(() => {
    const at = answeredAt.current;
    if (at === null) return;
    const focused = document.activeElement;
    // Only focus that was lost with the row: never taken from wherever the person moved it.
    if (focused !== null && focused !== document.body && focused.isConnected) return;
    answeredAt.current = null;
    const rows = list.current?.children ?? [];
    const row = rows[Math.min(at, rows.length - 1)];
    const action = row?.querySelector<HTMLElement>('button');
    (action ?? heading.current)?.focus();
  }, [contents]);
  const keepingFocus = (at: number, answer: () => void) => {
    const focused = document.activeElement;
    answeredAt.current = focused !== null && list.current?.contains(focused) === true ? at : null;
    answer();
  };
  return { heading, list, keepingFocus };
}

/** Proposals answered but never filed away: said so, with each a click from its note. */
function Stranded({
  stranded,
  onOpen,
}: {
  stranded: readonly ProposalNote[];
  onOpen: (path: VaultPath) => void;
}) {
  return (
    <section className="proposals__unreadable" aria-label="Answered, still in the Inbox">
      <h2>Answered, still in the Inbox</h2>
      <p>These were answered, but could not be moved to the Archive. Archive each from its page.</p>
      <ul>
        {stranded.map((proposal) => (
          <li key={proposal.path}>
            <button type="button" className="proposals__path" onClick={() => onOpen(proposal.path)}>
              {proposalHeadline(proposal)}
            </button>
            <span>{proposal.state === 'rejected' ? 'Rejected' : 'Accepted'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Unreadable({
  unreadable,
  onOpen,
}: {
  unreadable: ProposalsContents['unreadable'];
  onOpen: (path: VaultPath) => void;
}) {
  return (
    <section className="proposals__unreadable" aria-label="Proposals that cannot be read">
      <h2>
        <Icon name="close" size={14} /> Can’t be read
      </h2>
      <ul>
        {unreadable.map(({ path, problem }) => (
          <li key={path}>
            <button type="button" className="proposals__path" onClick={() => onOpen(path)}>
              {path}
            </button>
            <span>{problem}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
