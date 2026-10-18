// @vitest-environment jsdom
import { boardRenders, loadBoard, renderName } from './boards.ts';
import { renderBoard } from './dc-render.ts';

const parser = new DOMParser();
const renders = boardRenders(parser);

describe('design/target', () => {
  it('holds the v2 boards, the themed ones once per theme', () => {
    expect(renders.map(renderName)).toEqual([
      'BoardDark',
      'Dashboard-light',
      'Dashboard-dark',
      'DashboardDark',
      'FlowInbox',
      'FlowPeek',
      'FlowSplit',
      'FlowTable',
      'FlowType',
      'Main-light',
      'Main-dark',
      'Sidebar-light',
      'Sidebar-dark',
      'Table-light',
      'Table-dark',
      'TableDark',
      'Tokens',
    ]);
  });

  it.each(renders.map((render) => [renderName(render), render] as const))(
    '%s renders with every hole filled',
    (_name, { board, theme }) => {
      const { html, missing, size } = renderBoard({
        name: board,
        load: loadBoard,
        parser,
        ...(theme ? { props: { theme } } : {}),
      });
      expect(missing).toEqual([]);
      expect(html).not.toContain('{{');
      expect(html).not.toMatch(/<(sc-for|sc-if|dc-import)\b/);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    },
  );
});
