import type { RowOutcome } from './import-notion-meetings.ts';

const named = ({ row }: RowOutcome) => `"${row.title || 'Untitled'}" (${row.date || 'no date'})`;

function line(outcome: RowOutcome): string {
  switch (outcome.kind) {
    case 'written':
      return `wrote     ${outcome.path}`;
    case 'would-write':
      return `would write ${outcome.path}`;
    case 'in-vault':
      return `in vault  ${outcome.path}, ${named(outcome)}`;
    case 'no-source-id':
      return `no id     ${named(outcome)}: no Source ID, so not imported`;
    case 'left-out':
      return `left out  ${named(outcome)}: ${outcome.reason}`;
    case 'held':
      return `held      ${named(outcome)}: ${outcome.reason}`;
    case 'refused':
      return `refused   ${named(outcome)}: ${outcome.reason}`;
  }
}

const count = (outcomes: readonly RowOutcome[], kind: RowOutcome['kind']) =>
  outcomes.filter((outcome) => outcome.kind === kind).length;

/** One line per row, then the totals. */
export function reportLines(outcomes: readonly RowOutcome[]): string[] {
  const dryRun = count(outcomes, 'would-write');
  const totals = [
    `${count(outcomes, 'written')} written`,
    ...(dryRun === 0 ? [] : [`${dryRun} would be written`]),
    `${count(outcomes, 'in-vault')} already in the vault`,
    `${count(outcomes, 'no-source-id')} without a Source ID`,
    `${count(outcomes, 'left-out')} left out`,
    `${count(outcomes, 'held')} held`,
    `${count(outcomes, 'refused')} refused`,
  ];
  return [...outcomes.map(line), `${outcomes.length} rows: ${totals.join(', ')}`];
}

/** Whether every row with a Source ID that was asked for is now in the vault: none held, none refused. */
export const allImported = (outcomes: readonly RowOutcome[]) =>
  count(outcomes, 'refused') === 0 && count(outcomes, 'held') === 0;
