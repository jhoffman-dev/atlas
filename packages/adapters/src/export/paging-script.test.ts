// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { EXPORT_PAGE } from '@dfai/domain';
import { pagingScript } from './paging-script.ts';

/*
 * The paging script against a page laid out by a stand-in for WebKit: jsdom
 * draws nothing, so each block's height is written on it (`data-h`) and
 * blocks stack one under another from the top margin, each pushed down by
 * the margin the script gives it or a table holding it. US Letter: sheets
 * 792 tall, margins 54, so a sheet's foot is at 738.
 */

const { height: H, margin: M } = EXPORT_PAGE;

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

describe('pagingScript (#501)', () => {
  it('moves a paragraph that would be cut by a sheet’s foot below the next sheet’s top margin', () => {
    const { tops, pages } = run(
      '<p data-name="first" data-h="600"></p><p data-name="cut" data-h="100"></p>',
    );
    expect(tops.get('first')).toBe(M);
    expect(tops.get('cut')).toBe(H + M);
    expect(pages).toBe('2');
  });

  it('leaves what fits where it is, on one sheet', () => {
    const { tops, pages } = run(
      '<p data-name="a" data-h="300"></p><p data-name="b" data-h="300"></p>',
    );
    expect(tops.get('b')).toBe(M + 300);
    expect(pages).toBe('1');
  });

  it('takes a heading near a sheet’s foot to the next sheet, with what follows it', () => {
    const { tops } = run(
      '<p data-name="a" data-h="640"></p><h2 data-name="heading" data-h="30"></h2><p data-name="after" data-h="20"></p>',
    );
    expect(tops.get('heading')).toBe(H + M);
    expect(tops.get('after')).toBe(H + M + 30);
  });

  it('never splits a table’s row: the table is split there, its header repeated', () => {
    const { tops, pages } = run(
      [
        '<p data-name="a" data-h="620"></p>',
        '<table><thead><tr data-name="head" data-h="20"><th>Owner</th></tr></thead>',
        '<tbody><tr data-name="one" data-h="40"><td>Mara</td></tr>',
        '<tr data-name="two" data-h="40"><td>Tobias</td></tr></tbody></table>',
      ].join(''),
    );
    const tables = document.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    expect(tables[1]?.querySelector('thead')?.textContent).toBe('Owner');
    expect(tables[1]?.querySelector('tbody')?.textContent).toBe('Tobias');
    expect(tops.get('one')).toBe(M + 620 + 20);
    // The header repeated on the next sheet sits at its top margin, the row under it.
    expect(tops.get('two')).toBe(H + M + 20);
    expect(pages).toBe('2');
  });

  it('leaves a block taller than a sheet to be cut, rather than moving it for ever', () => {
    const { tops } = run(
      '<p data-name="a" data-h="100"></p><pre data-name="tall" data-h="900"></pre>',
    );
    expect(tops.get('tall')).toBe(M + 100);
  });

  it('makes the page exactly as tall as its sheets', () => {
    run('<p data-h="600"></p><p data-h="100"></p>');
    expect(document.body.style.minHeight).toBe(`${2 * H}px`);
  });
});
