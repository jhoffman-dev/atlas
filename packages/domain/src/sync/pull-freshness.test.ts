import { describe, expect, it } from 'vitest';
import {
  actsOnPulledFiles,
  ASLEEP_READING_SLACK_MS,
  pulledAfterArrival,
  pulledSinceLastSleep,
  type PullStanding,
} from './pull-freshness.ts';

/**
 * A fake of the host's counter (#172): the time asleep since boot, which a
 * test moves only by "sleeping" the Mac. The wall clock is not in it at all.
 */
function fakeMac(asleepMs = 457_335_000) {
  let asleep = asleepMs;
  return {
    read: () => asleep,
    sleep: (ms: number) => {
      asleep += ms;
    },
  };
}

const FINISHED_AT = 1_760_000_000_000;

function pulled(startedAsleepMs: number, changes: Partial<PullStanding> = {}): PullStanding {
  return { kind: 'pulled', startedAsleepMs, finishedAt: FINISHED_AT, namedAfter: true, ...changes };
}

describe('pulledSinceLastSleep (gate 2, ADR-0035 part 4)', () => {
  it('is false at launch, before any pull has completed', () => {
    const mac = fakeMac();
    expect(pulledSinceLastSleep({ standing: null, asleepNowMs: mac.read() })).toBe(false);
  });

  it('is true once a pull started and completed with the Mac awake throughout', () => {
    const mac = fakeMac();
    const standing = pulled(mac.read());
    expect(pulledSinceLastSleep({ standing, asleepNowMs: mac.read() })).toBe(true);
  });

  it('is false after the Mac sleeps, however long ago the pull was', () => {
    const mac = fakeMac();
    const standing = pulled(mac.read());
    mac.sleep(8 * 60 * 60 * 1000);
    expect(pulledSinceLastSleep({ standing, asleepNowMs: mac.read() })).toBe(false);
  });

  it('is false after a dark wake, which the did-wake notification never reports', () => {
    const mac = fakeMac();
    const standing = pulled(mac.read());
    mac.sleep(991_000);
    expect(pulledSinceLastSleep({ standing, asleepNowMs: mac.read() })).toBe(false);
  });

  it('does not count a pull that started before a sleep and completed after it', () => {
    const mac = fakeMac();
    const straddling = pulled(mac.read());
    mac.sleep(60_000);
    expect(pulledSinceLastSleep({ standing: straddling, asleepNowMs: mac.read() })).toBe(false);
  });

  it('is true again once a pull started after the wake has completed', () => {
    const mac = fakeMac();
    mac.sleep(60_000);
    const afterWake = pulled(mac.read());
    expect(pulledSinceLastSleep({ standing: afterWake, asleepNowMs: mac.read() })).toBe(true);
  });

  it('is false when the host could not read the counter: it never guesses', () => {
    const mac = fakeMac();
    expect(pulledSinceLastSleep({ standing: pulled(mac.read()), asleepNowMs: null })).toBe(false);
    // Not read as zero either: a Mac that has not slept since it booted reads zero.
    expect(pulledSinceLastSleep({ standing: pulled(0), asleepNowMs: null })).toBe(false);
  });

  it('is false while a pull is under way: what it brings is judged once it completes', () => {
    const mac = fakeMac();
    expect(pulledSinceLastSleep({ standing: { kind: 'pulling' }, asleepNowMs: mac.read() })).toBe(
      false,
    );
  });

  it('is true for a vault that does not sync, whatever the counter says', () => {
    expect(pulledSinceLastSleep({ standing: { kind: 'not-synced' }, asleepNowMs: null })).toBe(
      true,
    );
  });

  // Two reads of one awake spell differ only by the moment between the host's
  // two clock reads, which rounding can show as a millisecond or a preempted
  // thread as a few more; no real sleep is that short.
  it('takes two readings within the slack as one awake spell, and one past it as a sleep', () => {
    const started = 457_335_000;
    const within = [started + 1, started - 1, started + ASLEEP_READING_SLACK_MS];
    for (const asleepNowMs of within) {
      expect(pulledSinceLastSleep({ standing: pulled(started), asleepNowMs })).toBe(true);
    }
    const past = [started + ASLEEP_READING_SLACK_MS + 1, started - ASLEEP_READING_SLACK_MS - 1];
    for (const asleepNowMs of past) {
      expect(pulledSinceLastSleep({ standing: pulled(started), asleepNowMs })).toBe(false);
    }
  });

  it('is false on a reading that is not a number of milliseconds', () => {
    for (const asleepNowMs of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pulledSinceLastSleep({ standing: pulled(457_335_000), asleepNowMs })).toBe(false);
    }
  });
});

describe('pulledAfterArrival (gate 1, ADR-0035 part 4)', () => {
  it('is true for a file that was there before the pull completed', () => {
    const standing = pulled(0);
    expect(pulledAfterArrival({ standing, modifiedAt: FINISHED_AT - 1 })).toBe(true);
  });

  it('is false for a file that arrived as or after the pull completed', () => {
    const standing = pulled(0);
    expect(pulledAfterArrival({ standing, modifiedAt: FINISHED_AT })).toBe(false);
    expect(pulledAfterArrival({ standing, modifiedAt: FINISHED_AT + 1 })).toBe(false);
  });

  it('is false with no completed pull, or one under way', () => {
    expect(pulledAfterArrival({ standing: null, modifiedAt: 0 })).toBe(false);
    expect(pulledAfterArrival({ standing: { kind: 'pulling' }, modifiedAt: 0 })).toBe(false);
  });

  it('is true for a vault that does not sync', () => {
    expect(pulledAfterArrival({ standing: { kind: 'not-synced' }, modifiedAt: FINISHED_AT })).toBe(
      true,
    );
  });
});

describe('actsOnPulledFiles: the import and the Claude step (ADR-0035 part 4)', () => {
  const awake = 457_335_000;
  const cases: {
    name: string;
    standing: PullStanding | null;
    asleepNowMs: number | null;
    namedNow: boolean;
    acts: boolean;
  }[] = [
    {
      name: 'no pull yet this session',
      standing: null,
      asleepNowMs: awake,
      namedNow: true,
      acts: false,
    },
    {
      name: 'a pull under way',
      standing: { kind: 'pulling' },
      asleepNowMs: awake,
      namedNow: true,
      acts: false,
    },
    {
      name: 'fresh pull, named after it and now',
      standing: pulled(awake),
      asleepNowMs: awake,
      namedNow: true,
      acts: true,
    },
    {
      name: 'fresh pull, but the settings it brought name another Mac',
      standing: pulled(awake, { namedAfter: false }),
      asleepNowMs: awake,
      namedNow: true,
      acts: false,
    },
    {
      name: 'fresh pull, named after it, but the settings now name another Mac',
      standing: pulled(awake),
      asleepNowMs: awake,
      namedNow: false,
      acts: false,
    },
    {
      name: 'named, but slept since the pull started',
      standing: pulled(awake),
      asleepNowMs: awake + 60_000,
      namedNow: true,
      acts: false,
    },
    {
      name: 'named, counter unreadable',
      standing: pulled(awake),
      asleepNowMs: null,
      namedNow: true,
      acts: false,
    },
    {
      name: 'a vault that does not sync, named',
      standing: { kind: 'not-synced' },
      asleepNowMs: null,
      namedNow: true,
      acts: true,
    },
    {
      name: 'a vault that does not sync, its settings naming another Mac',
      standing: { kind: 'not-synced' },
      asleepNowMs: awake,
      namedNow: false,
      acts: false,
    },
  ];

  for (const { name, acts, ...facts } of cases) {
    it(`${acts ? 'acts' : 'does not act'}: ${name}`, () => {
      expect(actsOnPulledFiles(facts)).toBe(acts);
    });
  }

  it('runs nothing on a Mac another claimed while it slept: it wakes, pulls, and is not named', () => {
    const laptop = fakeMac();
    // The laptop was named and pulled before it slept.
    const beforeSleep = pulled(laptop.read());
    expect(
      actsOnPulledFiles({ standing: beforeSleep, asleepNowMs: laptop.read(), namedNow: true }),
    ).toBe(true);
    // The studio claims while it sleeps; it wakes still holding the old settings.
    laptop.sleep(20 * 60_000);
    expect(
      actsOnPulledFiles({ standing: beforeSleep, asleepNowMs: laptop.read(), namedNow: true }),
    ).toBe(false);
    // The pull after the wake brings the claim in.
    const afterWake = pulled(laptop.read(), { namedAfter: false });
    expect(
      actsOnPulledFiles({ standing: afterWake, asleepNowMs: laptop.read(), namedNow: true }),
    ).toBe(false);
    expect(
      actsOnPulledFiles({ standing: afterWake, asleepNowMs: laptop.read(), namedNow: false }),
    ).toBe(false);
  });
});
