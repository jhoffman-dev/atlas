import { useState } from 'react';
import type { QueryWidgetData } from '@atlas/application';
import { GroupedResult } from '../query-language/grouped-result.tsx';

/**
 * A query widget's answer: the query's rows as a list, in their groups and
 * sub-groups, each folding shut on its own tile (ADR-0019, P24-04).
 */
export function WidgetGroups({
  data,
  onOpenNote,
}: {
  data: QueryWidgetData;
  onOpenNote: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="widget__scroll widget__groups">
      <GroupedResult
        layout="list"
        fields={data.fields}
        rows={data.rows}
        groups={data.groups}
        collapsed={collapsed}
        onToggleGroup={(id) =>
          setCollapsed((was) => {
            const next = new Set(was);
            if (!next.delete(id)) next.add(id);
            return next;
          })
        }
        onOpenNote={onOpenNote}
      />
    </div>
  );
}
