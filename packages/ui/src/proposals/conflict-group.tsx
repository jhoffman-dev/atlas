import { useId, useState } from 'react';
import { noteTitle, type ConflictGroup, type VaultPath } from '@dfai/domain';
import { ConfidencePill, KIND_LABEL } from './proposal-row.tsx';

export interface ConflictGroupProps {
  readonly group: ConflictGroup;
  /** While any proposal is being answered. */
  readonly busy: boolean;
  /** Why the last answer to each member was refused, by its path. */
  readonly problems: ReadonlyMap<VaultPath, string>;
  /** Accepts the proposal picked, then rejects the rest — its copies and the other choices — if that was written. */
  readonly onAcceptChoice: (picked: VaultPath, rest: readonly VaultPath[]) => void;
  readonly onRejectMany: (paths: readonly VaultPath[]) => void;
}

/**
 * Proposals that disagree (#307, Q12), as one "pick one" question with a
 * radio per value: Accept choice accepts the one picked and, once that is
 * written, rejects the rest; Reject all rejects every one. Which conflict is which is worked out
 * afresh from the open proposals each time (`conflictGroups`), so nothing
 * here is kept.
 */
export function ConflictGroupRow({
  group,
  busy,
  problems,
  onAcceptChoice,
  onRejectMany,
}: ConflictGroupProps) {
  const name = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const question = questionOf(group);
  const members = group.choices.flatMap((choice) => choice.proposals.map((each) => each.path));
  const problem = members.map((path) => problems.get(path)).find((why) => why !== undefined);
  const acceptChoice = () => {
    const choice = group.choices.find((each) => each.value === picked);
    const chosen = choice?.proposals[0];
    if (chosen === undefined) return;
    onAcceptChoice(
      chosen.path,
      members.filter((path) => path !== chosen.path),
    );
  };
  return (
    <section className="proposal-row proposal-row--choice" aria-label={`Pick one: ${question}`}>
      <div className="proposal-row__line">
        <span className="proposal-row__select" />
        <span className="proposal-row__kind">{KIND_LABEL[group.kind]}</span>
        <div className="proposal-row__text">
          <span className="proposal-row__title">{question}</span>
          <p className="proposal-row__why">
            {members.length} proposals disagree. Pick one; the others are rejected.
          </p>
          {problem !== undefined && (
            <p className="proposal-row__problem" role="alert">
              {problem}
            </p>
          )}
        </div>
        <ConfidencePill confidence={group.confidence} />
        <span className="proposal-row__actions">
          <button
            type="button"
            className="btn btn--sm btn--destructive"
            disabled={busy}
            onClick={() => onRejectMany(members)}
          >
            Reject all
          </button>
          <button
            type="button"
            className="btn btn--sm btn--positive"
            disabled={busy || picked === null}
            onClick={acceptChoice}
          >
            Accept choice
          </button>
        </span>
      </div>
      <div className="proposal-row__choices" role="radiogroup" aria-label={question}>
        {group.choices.map((choice) => (
          <label key={choice.value} className="proposal-row__choice">
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={picked === choice.value}
              disabled={busy}
              onChange={() => setPicked(choice.value)}
            />
            <span>{choice.value}</span>
            {choice.proposals.length > 1 && (
              <span className="proposal-row__dup">proposed {choice.proposals.length} times</span>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}

/** "Which link for people of 2026-10-16 Platform Standup?" */
function questionOf(group: ConflictGroup): string {
  const what = group.kind === 'link' ? 'link' : KIND_LABEL[group.kind].toLowerCase();
  return `Which ${what} for ${group.slot.property} of ${noteTitle(group.slot.note)}?`;
}
