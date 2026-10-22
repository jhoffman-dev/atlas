import { useState } from 'react';
import {
  firstRows,
  LINKED_ROWS_SHOWN,
  RECENT_DAYS,
  type LinkedRange,
  type LinkedSectionId,
} from '@dfai/domain';
import type { LinkedSection } from '@dfai/application';
import { GroupedResult } from '../query-language/grouped-result.tsx';
import { SegmentedControl } from '../segmented-control.tsx';

export interface LinkedSectionsProps {
  /** The page's sections; null until they have been read. */
  readonly sections: readonly LinkedSection[] | null;
  /** Why the sections could not be read at all, said over whatever was read before; null when they were. */
  readonly problem?: string | null;
  readonly onChangeRange: (section: LinkedSectionId, range: LinkedRange) => void;
  readonly onOpenNote: (path: string) => void;
}

const RANGES = [
  { value: 'recent', label: `${RECENT_DAYS} days` },
  { value: 'all', label: 'All' },
] as const;

/**
 * What a linked page (P30-06) shows about itself, between its properties and
 * its text: a section each for its meetings, waiting-fors, open tasks,
 * decisions and linked notes, every row a way to the note it names. Read from
 * the index, never from the note — nothing here is in the file.
 */
export function LinkedSections({
  sections,
  problem = null,
  onChangeRange,
  onOpenNote,
}: LinkedSectionsProps) {
  const read = sections ?? [];
  if (read.length === 0 && problem === null) return null;
  return (
    <section className="linked" aria-label="Linked">
      {problem !== null && (
        <p className="linked__problem" role="alert">
          {problem}
        </p>
      )}
      {read.map((section) => (
        <Section
          key={section.id}
          section={section}
          onChangeRange={(range) => onChangeRange(section.id, range)}
          onOpenNote={onOpenNote}
        />
      ))}
    </section>
  );
}

function Section({
  section,
  onChangeRange,
  onOpenNote,
}: {
  section: LinkedSection;
  onChangeRange: (range: LinkedRange) => void;
  onOpenNote: (path: string) => void;
}) {
  const empty = section.rows.length === 0 && section.problem === null;
  return (
    <section
      className={empty ? 'linked__section linked__section--empty' : 'linked__section'}
      aria-label={section.title}
    >
      <header className="linked__head">
        <h2 className="linked__title">{section.title}</h2>
        {empty ? (
          <span className="linked__none">{noneText(section)}</span>
        ) : (
          section.problem === null && <Count section={section} />
        )}
        {section.range !== null && (
          <SegmentedControl
            label={`${section.title}: how far back`}
            options={RANGES}
            value={section.range}
            onChange={onChangeRange}
            tone="quiet"
          />
        )}
      </header>
      {section.hint !== null && (
        <p className="linked__hint" role="note">
          {section.hint}
        </p>
      )}
      {section.problem !== null && (
        <p className="linked__problem" role="alert">
          {section.problem}
        </p>
      )}
      {!empty && section.problem === null && <Rows section={section} onOpenNote={onOpenNote} />}
    </section>
  );
}

/** An empty section's one quiet word, saying how far back it looked when it looked back. */
function noneText(section: LinkedSection): string {
  return section.range === 'recent' ? `none in the last ${RECENT_DAYS} days` : 'none';
}

function Count({ section }: { section: LinkedSection }) {
  const count = section.rows.length;
  const said = section.truncated ? `${count}+` : String(count);
  const notes = count === 1 && !section.truncated ? '1 note' : `${said} notes`;
  return (
    <span className="linked__count" aria-label={notes}>
      {said}
    </span>
  );
}

function Rows({
  section,
  onOpenNote,
}: {
  section: LinkedSection;
  onOpenNote: (path: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const { rows, groups } = section;
  const drawn = all
    ? { rows, groups, more: 0 }
    : firstRows({ rows, groups, shown: LINKED_ROWS_SHOWN });
  const toggle = (id: string) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <div className="linked__rows">
      <GroupedResult
        layout="list"
        fields={section.fields}
        rows={drawn.rows}
        groups={drawn.groups}
        collapsed={collapsed}
        onToggleGroup={toggle}
        onOpenNote={onOpenNote}
      />
      {drawn.more > 0 && (
        <button type="button" className="linked__more" onClick={() => setAll(true)}>
          Show {drawn.more} more
        </button>
      )}
      {all && rows.length > LINKED_ROWS_SHOWN && (
        <button type="button" className="linked__more" onClick={() => setAll(false)}>
          Show fewer
        </button>
      )}
      {section.truncated && (all || drawn.more === 0) && (
        <p className="linked__cut">These are the first {rows.length}; there are more.</p>
      )}
    </div>
  );
}
