import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { ViewLayout } from '../query/saved-view.ts';
import {
  defaultViewTab,
  duplicateViewName,
  insertedViewOrder,
  landingView,
  movedViewOrder,
  newTypeViewName,
  orderWrites,
  takenViewPaths,
  typeViews,
  uniqueViewName,
  viewAfterRemoval,
  viewCopyNamed,
  viewNamedAs,
  viewOrderOf,
  viewTitleProblem,
  type PlacedView,
} from './index.ts';

const view = (
  name: string,
  {
    type = 'task',
    layout = 'table',
    order = null,
  }: Partial<Omit<PlacedView, 'path' | 'title'>> & {
    layout?: ViewLayout;
  } = {},
): PlacedView => ({
  path: createVaultPath(`.atlas/views/${name}.md`),
  title: name,
  type,
  layout,
  order,
});

const titles = (views: readonly PlacedView[]) => views.map((each) => each.title);
/** The views as they read once `writes` have landed in their files. */
const applied = (
  views: readonly PlacedView[],
  writes: readonly { path: string; order: number }[],
): PlacedView[] =>
  views.map((each) => ({
    ...each,
    order: writes.find((write) => write.path === each.path)?.order ?? each.order,
  }));
const named = (writes: readonly { path: string; order: number }[]) =>
  writes.map(({ path, order }) => [path.replace(/^\.atlas\/views\/|\.md$/g, ''), order]);

describe('viewOrderOf', () => {
  it('reads a number, or a string that is one, and nothing else', () => {
    expect(viewOrderOf({ order: 2 })).toBe(2);
    expect(viewOrderOf({ order: ' 1.5 ' })).toBe(1.5);
    expect(viewOrderOf({ order: 'soon' })).toBeNull();
    expect(viewOrderOf({ order: '' })).toBeNull();
    expect(viewOrderOf({ order: Number.NaN })).toBeNull();
    expect(viewOrderOf({ order: Number.POSITIVE_INFINITY })).toBeNull();
    expect(viewOrderOf({ order: [1] })).toBeNull();
    expect(viewOrderOf({})).toBeNull();
  });

  it('reads a string only when it is written as a plain decimal number', () => {
    expect(viewOrderOf({ order: '-2' })).toBe(-2);
    expect(viewOrderOf({ order: '.5' })).toBe(0.5);
    expect(viewOrderOf({ order: '0x10' })).toBeNull();
    expect(viewOrderOf({ order: '0b11' })).toBeNull();
    expect(viewOrderOf({ order: '1e3' })).toBeNull();
    expect(viewOrderOf({ order: 'Infinity' })).toBeNull();
  });
});

describe('takenViewPaths', () => {
  it('holds every file in the views folder and every view, once each', () => {
    expect(
      takenViewPaths({
        listed: ['.atlas/views/Scratch.md', '.atlas/views/Board.md'],
        views: [
          { path: createVaultPath('.atlas/views/Board.md') },
          { path: createVaultPath('Work/Mine.md') },
        ],
      }),
    ).toEqual(['.atlas/views/Scratch.md', '.atlas/views/Board.md', 'Work/Mine.md']);
  });
});

describe('typeViews', () => {
  it('keeps only the type’s views, placed first by order, then the rest by layout and name', () => {
    const views = [
      view('Zed', { layout: 'table' }),
      view('Board', { layout: 'board' }),
      view('Late', { order: 5 }),
      view('Early', { order: 1, layout: 'calendar' }),
      view('Theirs', { type: 'project', order: 0 }),
    ];
    expect(titles(typeViews(views, 'task'))).toEqual(['Early', 'Late', 'Board', 'Zed']);
  });

  it('breaks a tie in order by layout and name, so the same files always read the same', () => {
    const views = [
      view('B', { order: 1 }),
      view('A', { order: 1 }),
      view('C', { order: 1, layout: 'board' }),
    ];
    expect(titles(typeViews(views, 'task'))).toEqual(['C', 'A', 'B']);
  });

  it('counts a view listed twice once, as the later reading of it', () => {
    const views = [view('A', { order: 9 }), view('B', { order: 2 }), view('A', { order: 1 })];
    const owned = typeViews(views, 'task');
    expect(titles(owned)).toEqual(['A', 'B']);
    expect(owned[0]?.order).toBe(1);
  });
});

describe('landingView', () => {
  const views = [
    view('Board', { layout: 'board' }),
    view('Table'),
    view('Other', { type: 'project' }),
  ];

  it('opens the tab last open on this machine while the type still owns it', () => {
    expect(landingView({ views, typeName: 'task', remembered: views[1]!.path })?.title).toBe(
      'Table',
    );
  });

  it('falls back to the first tab when nothing is remembered, or what was is gone or another type’s', () => {
    expect(landingView({ views, typeName: 'task', remembered: null })?.title).toBe('Board');
    expect(landingView({ views, typeName: 'task', remembered: 'gone.md' })?.title).toBe('Board');
    expect(landingView({ views, typeName: 'task', remembered: views[2]!.path })?.title).toBe(
      'Board',
    );
  });

  it('is null for a type with no views, which shows its default table instead', () => {
    expect(landingView({ views, typeName: 'person', remembered: null })).toBeNull();
  });
});

describe('orderWrites', () => {
  it('numbers views that were never placed from one', () => {
    expect(named(orderWrites([view('A'), view('B'), view('C')]))).toEqual([
      ['A', 1],
      ['B', 2],
      ['C', 3],
    ]);
  });

  it('writes nothing when the orders already read in sequence, gaps and all', () => {
    expect(
      orderWrites([view('A', { order: 1 }), view('B', { order: 4 }), view('C', { order: 9 })]),
    ).toEqual([]);
  });

  it('keeps an order that is still ahead of the last, and moves on from a fraction', () => {
    const sequence = [view('A', { order: 1.5 }), view('B', { order: 1 }), view('C', { order: 7 })];
    expect(named(orderWrites(sequence))).toEqual([['B', 2]]);
  });
});

describe('movedViewOrder', () => {
  const placed = [view('A', { order: 1 }), view('B', { order: 2 }), view('C', { order: 3 })];

  it('moves a tab to the end by writing that tab alone', () => {
    expect(
      named(movedViewOrder({ views: placed, typeName: 'task', path: placed[0]!.path, to: 2 })),
    ).toEqual([['A', 4]]);
  });

  it('moves a tab into the middle by writing it alone, halfway between its new neighbours', () => {
    const writes = movedViewOrder({
      views: placed,
      typeName: 'task',
      path: placed[2]!.path,
      to: 1,
    });
    expect(named(writes)).toEqual([['C', 1.5]]);
  });

  it('keeps to whole numbers when there is a whole one between the neighbours', () => {
    const spaced = [view('A', { order: 1 }), view('B', { order: 4 }), view('C', { order: 9 })];
    expect(
      named(movedViewOrder({ views: spaced, typeName: 'task', path: spaced[2]!.path, to: 1 })),
    ).toEqual([['C', 2]]);
  });

  it('moves a tab to the front by writing it alone, one before the first', () => {
    expect(
      named(movedViewOrder({ views: placed, typeName: 'task', path: placed[2]!.path, to: 0 })),
    ).toEqual([['C', 0]]);
  });

  it('places only the moved tab when it lands before every view nobody placed', () => {
    const loose = [
      view('Board', { layout: 'board' }),
      view('Table'),
      view('List', { layout: 'list' }),
    ];
    const writes = movedViewOrder({ views: loose, typeName: 'task', path: loose[2]!.path, to: 0 });
    expect(named(writes)).toEqual([['List', 1]]);
  });

  it('places the unplaced views before a tab moved among them, and none after it', () => {
    const loose = [
      view('Board', { layout: 'board' }),
      view('Table'),
      view('List', { layout: 'list' }),
    ];
    const writes = movedViewOrder({ views: loose, typeName: 'task', path: loose[0]!.path, to: 1 });
    expect(named(writes)).toEqual([
      ['Table', 1],
      ['Board', 2],
    ]);
    expect(titles(typeViews(applied(loose, writes), 'task'))).toEqual(['Table', 'Board', 'List']);
  });

  it('renumbers only when two neighbours leave no room between them', () => {
    // A and B share an order, so nothing fits between them: B moves on instead.
    const tied = [view('A', { order: 1 }), view('B', { order: 1 }), view('C', { order: 2 })];
    const writes = movedViewOrder({ views: tied, typeName: 'task', path: tied[2]!.path, to: 1 });
    expect(titles(typeViews(applied(tied, writes), 'task'))).toEqual(['A', 'C', 'B']);
  });

  it('renumbers when the numbers are too large to count past or before', () => {
    const top = [view('A', { order: 1 }), view('B', { order: 1e308 }), view('C', { order: 2 })];
    // Reads A, C, B; moving A to the end needs a number past 1e308, which there is not.
    const toEnd = movedViewOrder({ views: top, typeName: 'task', path: top[0]!.path, to: 2 });
    expect(titles(typeViews(applied(top, toEnd), 'task'))).toEqual(['C', 'B', 'A']);
    expect(toEnd.every((write) => Number.isFinite(write.order))).toBe(true);

    const bottom = [view('A', { order: -1e308 }), view('B', { order: 1 }), view('C', { order: 2 })];
    const toFront = movedViewOrder({
      views: bottom,
      typeName: 'task',
      path: bottom[2]!.path,
      to: 0,
    });
    expect(titles(typeViews(applied(bottom, toFront), 'task'))).toEqual(['C', 'A', 'B']);
  });

  it('finds a midpoint between neighbours too large to add together', () => {
    const big = [
      view('A', { order: 1.5e308 }),
      view('B', { order: 1.7e308 }),
      view('C', { order: 1 }),
    ];
    // Reads C, A, B; C between A and B.
    const writes = movedViewOrder({ views: big, typeName: 'task', path: big[2]!.path, to: 1 });
    expect(writes).toHaveLength(1);
    expect(titles(typeViews(applied(big, writes), 'task'))).toEqual(['A', 'C', 'B']);
  });

  it('writes nothing for a move that goes nowhere, past either end, or of another type’s view', () => {
    const at = (path: string, to: number) =>
      movedViewOrder({ views: placed, typeName: 'task', path, to });
    expect(at(placed[1]!.path, 1)).toEqual([]);
    expect(at(placed[1]!.path, -1)).toEqual([]);
    expect(at(placed[1]!.path, 3)).toEqual([]);
    expect(at(placed[1]!.path, 0.5)).toEqual([]);
    expect(at('elsewhere.md', 0)).toEqual([]);
    expect(
      movedViewOrder({ views: placed, typeName: 'project', path: placed[0]!.path, to: 1 }),
    ).toEqual([]);
  });

  it('produces orders that read back in the asked sequence', () => {
    const writes = movedViewOrder({
      views: placed,
      typeName: 'task',
      path: placed[2]!.path,
      to: 0,
    });
    const after = placed.map((each) => ({
      ...each,
      order: writes.find((write) => write.path === each.path)?.order ?? each.order,
    }));
    expect(titles(typeViews(after, 'task'))).toEqual(['C', 'A', 'B']);
  });
});

describe('insertedViewOrder', () => {
  const placed = [view('A', { order: 1 }), view('B', { order: 2 })];

  it('adds a view at the end by writing the new view alone', () => {
    const added = view('New');
    expect(named(insertedViewOrder({ views: placed, typeName: 'task', added, at: 2 }))).toEqual([
      ['New', 3],
    ]);
  });

  it('puts a copy right after its source, moving only what follows', () => {
    const added = view('A copy');
    expect(named(insertedViewOrder({ views: placed, typeName: 'task', added, at: 1 }))).toEqual([
      ['A copy', 2],
      ['B', 3],
    ]);
  });

  it('clamps a place past either end, and places unplaced siblings so the new one lands there', () => {
    const loose = [view('Board', { layout: 'board' }), view('Table')];
    expect(
      named(insertedViewOrder({ views: loose, typeName: 'task', added: view('New'), at: 99 })),
    ).toEqual([
      ['Board', 1],
      ['Table', 2],
      ['New', 3],
    ]);
    expect(
      named(insertedViewOrder({ views: placed, typeName: 'task', added: view('First'), at: -4 })),
    ).toEqual([
      ['First', 1],
      ['A', 2],
      ['B', 3],
    ]);
  });
});

describe('viewAfterRemoval', () => {
  const placed = [view('A', { order: 1 }), view('B', { order: 2 }), view('C', { order: 3 })];
  const after = (path: string) => viewAfterRemoval({ views: placed, typeName: 'task', path });

  it('lands on the next tab, or the one before when the last went', () => {
    expect(after(placed[1]!.path)).toBe(placed[2]!.path);
    expect(after(placed[2]!.path)).toBe(placed[1]!.path);
  });

  it('is null when the type’s only view went, or the view was not the type’s', () => {
    expect(
      viewAfterRemoval({ views: [placed[0]!], typeName: 'task', path: placed[0]!.path }),
    ).toBeNull();
    expect(after('elsewhere.md')).toBeNull();
  });
});

describe('naming views nobody had to name', () => {
  it('calls a new view after its type and layout, numbering it past any taken name in any case', () => {
    const type = { name: 'task', label: 'Task' };
    expect(newTypeViewName({ type, layout: 'board', takenPaths: [] })).toBe('Task board');
    expect(
      newTypeViewName({
        type,
        layout: 'board',
        takenPaths: ['.atlas/views/task BOARD.md', '.atlas/views/Task board 2.md'],
      }),
    ).toBe('Task board 3');
  });

  it('falls back to the type’s own name when its label cannot be a file name', () => {
    expect(
      newTypeViewName({ type: { name: 'io', label: 'In/Out' }, layout: 'table', takenPaths: [] }),
    ).toBe('io table');
  });

  it('calls a copy after what it copies, in a file name a disk can hold', () => {
    expect(duplicateViewName('Board', ['.atlas/views/Board copy.md'])).toBe('Board copy 2');
    expect(duplicateViewName('Ship: v2', [])).toBe('Ship- v2 copy');
  });

  it('gives back the base name itself when it is free', () => {
    expect(uniqueViewName('  Roadmap ', [])).toBe('Roadmap');
  });

  it('writes a name no file can hold under one it can, with a dash for each such character', () => {
    expect(uniqueViewName('Q1/Q2', [])).toBe('Q1-Q2');
    expect(uniqueViewName('a\\b:c*d?e"f<g>h|i', [])).toBe('a-b-c-d-e-f-g-h-i');
    expect(uniqueViewName('Q1/Q2', ['.atlas/views/q1-q2.md'])).toBe('Q1-Q2 2');
  });

  it('drops the dots a name starts with, which would hide its file', () => {
    expect(uniqueViewName('.hidden', [])).toBe('hidden');
    expect(uniqueViewName(' ...', [])).toBe('View');
  });

  it('stops counting once every number it could need has been tried', () => {
    // n taken names can block at most n candidates, so n + 1 always finds one.
    const taken = ['View', ...Array.from({ length: 50 }, (_, at) => `View ${at + 2}`)].map(
      (name) => `.atlas/views/${name}.md`,
    );
    expect(uniqueViewName('View', taken)).toBe('View 52');
  });

  it('cuts a long name to the 255 bytes a file name may have, never through a character', () => {
    const family = '👨‍👩‍👧‍👦'; // one character to a reader, 25 bytes
    const name = uniqueViewName(`${'a'.repeat(244)}${family}`, []);
    expect(name).toBe('a'.repeat(244));

    const numbered = uniqueViewName('é'.repeat(200), [`.atlas/views/${'é'.repeat(126)}.md`]);
    expect(numbered).toBe(`${'é'.repeat(125)} 2`);
    expect(new TextEncoder().encode(`${numbered}.md`).length).toBeLessThanOrEqual(255);
  });

  it('keeps a tab renamed as typed, written under a file name that holds what it can', () => {
    expect(viewNamedAs('Roadmap', [])).toEqual({ fileName: 'Roadmap', title: null });
    expect(viewNamedAs('Q1/Q2', [])).toEqual({ fileName: 'Q1-Q2', title: 'Q1/Q2' });
    // Renaming a written tab never numbers it, so the default table's does not either.
    expect(viewNamedAs('Board', ['.atlas/views/Board.md'])).toEqual({
      fileName: 'Board 2',
      title: 'Board',
    });
  });

  it('names a copy for its file when the file can say it, numbered past others', () => {
    expect(viewCopyNamed('Board', ['.atlas/views/Board copy.md'])).toEqual({
      fileName: 'Board copy 2',
      title: null,
    });
    expect(viewCopyNamed('Q1/Q2', [])).toEqual({ fileName: 'Q1-Q2 copy', title: 'Q1/Q2 copy' });
    const long = viewCopyNamed('x'.repeat(250), []);
    expect(long.title).toBe(`${'x'.repeat(250)} copy`);
    expect(new TextEncoder().encode(`${long.fileName}.md`).length).toBeLessThanOrEqual(255);
  });

  it('refuses only a blank title for a rename', () => {
    expect(viewTitleProblem('  ')).toBe('Name the view.');
    expect(viewTitleProblem('Ship: v2')).toBeNull();
  });
});

describe('defaultViewTab', () => {
  it('is a selected table, not yet a file, named and placed where it would be written', () => {
    expect(
      defaultViewTab({
        type: { name: 'task', label: 'Task' },
        takenPaths: ['.atlas/views/Task table.md'],
      }),
    ).toEqual({
      path: '.atlas/views/Task table 2.md',
      title: 'Task table 2',
      icon: 'table',
      selected: true,
      virtual: true,
      movable: false,
      deletable: false,
    });
  });
});
