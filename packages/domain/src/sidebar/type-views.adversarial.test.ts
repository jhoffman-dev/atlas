import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { ViewLayout } from '../query/saved-view.ts';
import type * as NewView from '../query/new-view.ts';
import { viewNameProblem, viewPathFor } from '../query/new-view.ts';
import {
  duplicateViewName,
  movedViewOrder,
  typeViews,
  uniqueViewName,
  type PlacedView,
  type ViewOrderWrite,
} from './index.ts';

/**
 * Adversarial pass on issue #11 (ADR-0023): a type owns its views, each in its
 * own `order:`. These try the rules at the edges a hand-edited vault and a long
 * life of reordering reach.
 */

// `uniqueViewName` asks `viewNameProblem` once per candidate. A name no suffix
// can make usable would ask forever and freeze the app, so the count is capped
// here and the cap reported as its own error rather than hanging the suite.
const LOOPED = 'uniqueViewName never stopped asking';
let asked = 0;
vi.mock('../query/new-view.ts', async (importOriginal) => {
  const original = await importOriginal<typeof NewView>();
  return {
    ...original,
    viewNameProblem: (name: string, taken: readonly string[]) => {
      asked += 1;
      if (asked > 10_000) throw new Error(LOOPED);
      return original.viewNameProblem(name, taken);
    },
  };
});
beforeEach(() => {
  asked = 0;
});

const view = (
  name: string,
  { layout = 'table', order = null }: { layout?: ViewLayout; order?: number | null } = {},
): PlacedView => ({
  path: createVaultPath(`.atlas/views/${name}.md`),
  title: name,
  type: 'task',
  layout,
  order,
});

/** The views as they read once `writes` have landed in their files. */
function applied(views: readonly PlacedView[], writes: readonly ViewOrderWrite[]): PlacedView[] {
  const next = new Map(writes.map((write) => [write.path as string, write.order]));
  return views.map((each) => ({ ...each, order: next.get(each.path) ?? each.order }));
}

const titles = (views: readonly PlacedView[]) => views.map((each) => each.title);
const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
const fileNameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

describe('uniqueViewName on a name no number can fix', () => {
  // renameTab hands the typed name of the virtual default table straight here
  // (materializeDefaultView), so "Q1/Q2" typed into its tab freezes the app.
  it('stops for a name holding a slash, rather than counting forever', () => {
    expect(() => uniqueViewName('Q1/Q2', [])).not.toThrow(LOOPED);
  });

  it('stops for a name starting with a dot, rather than counting forever', () => {
    expect(() => uniqueViewName('.hidden', [])).not.toThrow(LOOPED);
  });
});

describe('a copy’s name', () => {
  // A rename writes `title:` with no length limit, so a 250-character title is
  // reachable from the tab; its copy then becomes a file name the disk refuses.
  it('fits in the 255 bytes a file name may have, however long the title', () => {
    const name = duplicateViewName('x'.repeat(250), []);
    expect(viewNameProblem(name, [])).toBeNull();
    expect(utf8Bytes(fileNameOf(viewPathFor(name)))).toBeLessThanOrEqual(255);
  });
});

describe('moves among orders too large to count past', () => {
  it('reads in the asked order after a move, when a hand-written order is past 2^53', () => {
    const views = [view('Huge', { order: 2 ** 53 }), view('Beta'), view('Gamma')];
    expect(titles(typeViews(views, 'task'))).toEqual(['Huge', 'Beta', 'Gamma']);

    const writes = movedViewOrder({ views, typeName: 'task', path: views[2]!.path, to: 1 });

    expect(titles(typeViews(applied(views, writes), 'task'))).toEqual(['Huge', 'Gamma', 'Beta']);
  });
});

describe('a move to the front among many placed views', () => {
  // ADR-0023: "A move writes as few files as it can". Placing the moved view
  // before the first is one write; renumbering everyone after it is 59, each a
  // file a sync must carry and a conflict another Mac can hit.
  it('writes the moved view alone', () => {
    const views = Array.from({ length: 60 }, (_, at) =>
      view(`View ${String(at + 1).padStart(2, '0')}`, { order: at + 1 }),
    );
    const last = views[59]!;

    const writes = movedViewOrder({ views, typeName: 'task', path: last.path, to: 0 });

    expect(titles(typeViews(applied(views, writes), 'task'))[0]).toBe(last.title);
    expect(writes.map((write) => write.path)).toEqual([last.path]);
  });
});
