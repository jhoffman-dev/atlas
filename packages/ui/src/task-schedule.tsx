import { durationLabel, type TaskSchedule } from '@atlas/domain';
import { Icon } from './icon.tsx';

/** "1h 30m of 2h", or the minutes alone when the task has no estimate. */
function ofEstimate(minutes: number, estimate: number | null): string {
  return estimate === null
    ? durationLabel(minutes)
    : `${durationLabel(minutes)} of ${durationLabel(estimate)}`;
}

/**
 * A task's estimate beside the time its blocks set aside and what is done
 * (P31-01), under its properties: read-only, since both follow from the
 * blocks and the status. Time scheduled past the estimate is said, so an
 * over-booked task is seen before the day it runs out.
 */
export function TaskScheduleSummary(props: { schedule: TaskSchedule } | { problem: string }) {
  if ('problem' in props) {
    return (
      <section className="props task-schedule" aria-label="Schedule">
        <p className="props__error" role="alert">
          The schedule could not be read: {props.problem}
        </p>
      </section>
    );
  }
  const { estimate, scheduled, done, overBy } = props.schedule;
  return (
    <section className="props task-schedule" aria-label="Schedule">
      <dl className="props__list">
        <div className="props__row">
          <dt className="props__label">
            <Icon name="calendar" size={16} />
            Scheduled
          </dt>
          <dd className="props__value">
            {ofEstimate(scheduled, estimate)}
            {estimate === null && <span className="task-schedule__note">no estimate</span>}
            {overBy > 0 && (
              <span className="task-schedule__over">{durationLabel(overBy)} over the estimate</span>
            )}
          </dd>
        </div>
        {done !== null && (
          <div className="props__row">
            <dt className="props__label">
              <Icon name="check" size={16} />
              Done
            </dt>
            <dd className="props__value">{ofEstimate(done, estimate)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
