import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon.tsx';

/**
 * One figure on the KPI strip: its label over the value, with a shorter
 * figure beside it — "17 phases", "94%" — and, under them, anything more the
 * widget has to say, such as the hero's status bar.
 *
 * A zero is drawn like any other value: "In flight 0" is the answer, not an
 * empty slot. The rule that hides zero counts is for the counts in lists.
 */
export function KpiItem({
  label,
  value,
  sub,
  icon,
  children,
}: {
  label: string;
  value: string | number;
  sub?: string | undefined;
  icon?: IconName | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="kpi">
      <span className="kpi__label">
        {icon !== undefined && <Icon name={icon} size={14} className="kpi__icon" />}
        {label}
      </span>
      <span className="kpi__figure">
        <span className="kpi__value">{value}</span>
        {sub !== undefined && <span className="kpi__sub">{sub}</span>}
      </span>
      {children}
    </div>
  );
}
