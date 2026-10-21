// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EXPORT_PAGE } from '@atlas/domain';
import { pagingScript } from './paging-script.ts';

/*
 * Attack on PR #502: the paging script against the tables the export
 * renderer really draws. The stand-in layout is copied from
 * paging-script.test.ts: each block's height is written on it (`data-h`)
 * and blocks stack from the top margin. US Letter, margins 54.
 */

const { margin: M } = EXPORT_PAGE;

function layOut(): Map<Element, { top: number; height: number }> {
  const leaves = [...document.querySelectorAll('[data-h]')];
  const margined = [...document.querySelectorAll<HTMLElement>('*')].filter(
    (el) => el.style.marginTop !== '',
  );
  const firstLeaf = (el: Element) =>
    el.hasAttribute('data-h') ? el : el.querySelector('[data-h]');
  const placed = new Map<Element, { top: number; height: number }>();
  let y = M;
  for (const leaf of leaves) {
    for (const el of margined) {
      if ((el === leaf || el.contains(leaf)) && firstLeaf(el) === leaf) {
        y += parseFloat(el.style.marginTop);
      }
    }
    const height = Number(leaf.getAttribute('data-h'));
    placed.set(leaf, { top: y, height });
    y += height;
  }
  return placed;
}

function rectOf(el: Element): DOMRect {
  const placed = layOut();
  const own = placed.get(el);
  const inside = [...placed].filter(([leaf]) => el.contains(leaf)).map(([, box]) => box);
  const top = own?.top ?? inside[0]?.top ?? 0;
  const height = own?.height ?? inside.reduce((sum, box) => sum + box.height, 0);
  return {
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function run(body: string): { tops: Map<string, number>; pages: string | null } {
  document.body.innerHTML = body;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return rectOf(this);
  };
  Object.defineProperty(document.body, 'scrollHeight', {
    configurable: true,
    get: () => {
      const boxes = [...layOut().values()];
      const last = boxes.at(-1);
      return (last === undefined ? M : last.top + last.height) + M;
    },
  });
  new Function(pagingScript(EXPORT_PAGE))();
  const tops = new Map(
    [...layOut()].map(([el, box]) => [el.getAttribute('data-name') ?? '', box.top]),
  );
  return { tops, pages: document.documentElement.getAttribute('data-pages') };
}

afterEach(() => {
  document.documentElement.removeAttribute('data-pages');
});

describe('paging the tables the export renderer draws (attack on #502)', () => {
  // The export renderer (tiptap's table schema) writes a header row as
  // `<tr><th>` inside `<tbody>`, with a `<colgroup>`, and never a `<thead>`.
  it('repeats a tiptap table’s header row on the sheet a split table continues on', () => {
    run(
      [
        '<p data-name="a" data-h="620"></p>',
        '<table><colgroup><col><col></colgroup><tbody>',
        '<tr data-name="head" data-h="20"><th><p>Owner</p></th><th><p>Task</p></th></tr>',
        '<tr data-name="one" data-h="40"><td><p>Mara</p></td><td><p>Plan</p></td></tr>',
        '<tr data-name="two" data-h="40"><td><p>Tobias</p></td><td><p>Ship</p></td></tr>',
        '</tbody></table>',
      ].join(''),
    );
    const tables = document.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    expect(tables[1]?.querySelector('tr')?.textContent).toBe('OwnerTask');
  });
});
