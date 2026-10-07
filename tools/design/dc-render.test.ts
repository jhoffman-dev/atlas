// @vitest-environment jsdom
import { renderBoard, themesOf } from './dc-render.ts';

/** A minimal `.dc.html` file: markup, an optional logic class, optional declared props. */
function board(markup: string, options: { logic?: string; props?: object } = {}): string {
  const props = JSON.stringify(options.props ?? {});
  const logic = options.logic ?? 'renderVals() { return {}; }';
  return `<!doctype html><html><head><title>Fixture</title><script src="./support.js"></script></head><body>
<x-dc>${markup}</x-dc>
<script type="text/x-dc" data-dc-script data-props='${props}'>
class Component extends DCLogic { ${logic} }
</script></body></html>`;
}

function render(files: Record<string, string>, name = 'Main', props?: Record<string, unknown>) {
  const load = (component: string) => {
    const source = files[component];
    if (source === undefined) throw new Error(`no fixture ${component}`);
    return source;
  };
  const result = renderBoard({ name, load, parser: new DOMParser(), ...(props ? { props } : {}) });
  const document = new DOMParser().parseFromString(result.html, 'text/html');
  return { ...result, document };
}

describe('renderBoard', () => {
  it('fills text holes from renderVals, following dotted paths', () => {
    const { document } = render({
      Main: board('<p id="out">{{t.ink}} and {{count}}</p>', {
        logic: "renderVals() { return { t: { ink: '#123' }, count: 7 }; }",
      }),
    });
    expect(document.getElementById('out')?.textContent).toBe('#123 and 7');
  });

  it('fills holes inside an attribute and takes a whole-attribute hole raw', () => {
    const { document } = render({
      Main: board(
        '<a id="out" href="#i-{{icon}}" style="color: {{ink}};" hidden="{{off}}" data-n="{{n}}">x</a>',
        { logic: "renderVals() { return { icon: 'star', ink: 'red', off: false, n: 3 }; }" },
      ),
    });
    const link = document.getElementById('out');
    expect(link?.getAttribute('href')).toBe('#i-star');
    expect(link?.getAttribute('style')).toBe('color: red;');
    expect(link?.hasAttribute('hidden')).toBe(false);
    expect(link?.getAttribute('data-n')).toBe('3');
  });

  it('repeats sc-for children per item, with the loop variable and $index', () => {
    const { document } = render({
      Main: board(
        '<ul><sc-for list="{{rows}}" as="row" hint-placeholder-count="9"><li>{{$index}}:{{row.label}}</li></sc-for></ul>',
        { logic: "renderVals() { return { rows: [{ label: 'a' }, { label: 'b' }] }; }" },
      ),
    });
    const items = [...document.querySelectorAll('li')].map((item) => item.textContent);
    expect(items).toEqual(['0:a', '1:b']);
    expect(document.querySelector('sc-for')).toBeNull();
  });

  it('nests sc-for, the inner list read from the outer item', () => {
    const { document } = render({
      Main: board(
        '<sc-for list="{{cols}}" as="col"><section><sc-for list="{{col.cards}}" as="card"><i>{{card}}</i></sc-for></section></sc-for>',
        { logic: "renderVals() { return { cols: [{ cards: ['x', 'y'] }, { cards: ['z'] }] }; }" },
      ),
    });
    const sections = [...document.querySelectorAll('section')].map((section) =>
      [...section.querySelectorAll('i')].map((card) => card.textContent),
    );
    expect(sections).toEqual([['x', 'y'], ['z']]);
  });

  it('keeps sc-if children only when the value is truthy', () => {
    const { document } = render({
      Main: board(
        '<sc-if value="{{yes}}"><b id="kept">{{label}}</b></sc-if><sc-if value="{{no}}"><b id="dropped"></b></sc-if>',
        { logic: "renderVals() { return { yes: true, no: false, label: 'shown' }; }" },
      ),
    });
    expect(document.getElementById('kept')?.textContent).toBe('shown');
    expect(document.getElementById('dropped')).toBeNull();
    expect(document.querySelector('sc-if')).toBeNull();
  });

  it('treats an absent sc-if flag as false without reporting it missing', () => {
    const { document, missing } = render({
      Main: board('<sc-if value="{{card.done}}"><b id="done"></b></sc-if>', {
        logic: 'renderVals() { return { card: {} }; }',
      }),
    });
    expect(document.getElementById('done')).toBeNull();
    expect(missing).toEqual([]);
  });

  it('uses a prop default from data-props when nothing is passed', () => {
    const files = {
      Main: board('<p id="out">{{theme}}/{{mode}}</p>', {
        props: { theme: { default: 'light' }, $preview: { width: 248, height: 900 } },
        logic: "renderVals() { return { mode: this.props.theme === 'dark' ? 'night' : 'day' }; }",
      }),
    };
    expect(render(files).document.getElementById('out')?.textContent).toBe('light/day');
    expect(
      render(files, 'Main', { theme: 'dark' }).document.getElementById('out')?.textContent,
    ).toBe('dark/night');
  });

  it('reads the preview size from data-props, defaulting to 1440×900', () => {
    const sized = board('<p></p>', { props: { $preview: { width: 248, height: 900 } } });
    expect(render({ Main: sized }).size).toEqual({ width: 248, height: 900 });
    expect(render({ Main: board('<p></p>') }).size).toEqual({ width: 1440, height: 900 });
  });

  it('mounts dc-import with its attributes as camelCased props, dropping hint-*', () => {
    const { document } = render({
      Main: board(
        '<div id="host"><dc-import name="Side" theme="{{theme}}" active-item="board" hint-size="248px,900px"></dc-import></div>',
        { props: { theme: { default: 'dark' } }, logic: 'renderVals() { return {}; }' },
      ),
      Side: board('<nav id="side">{{theme}}:{{activeItem}}:{{hintSize}}</nav>', {
        props: { theme: { default: 'light' } },
      }),
    });
    expect(document.querySelector('#host > nav#side')?.textContent).toBe('dark:board:');
    expect(document.querySelector('dc-import')).toBeNull();
  });

  it('hoists every helmet into <head> once and drops the design tool runtime', () => {
    const helmet = (css: string) => `<helmet><style>${css}</style></helmet>`;
    const { document, html } = render({
      Main: board(
        `${helmet('.main{}')}<dc-import name="Side"></dc-import><dc-import name="Side"></dc-import>`,
      ),
      Side: board(`${helmet('.side{}')}<nav></nav>`),
    });
    const styles = [...document.head.querySelectorAll('style')].map((style) => style.textContent);
    expect(styles).toEqual(['.main{}', '.side{}']);
    expect(document.body.querySelector('helmet')).toBeNull();
    expect(document.querySelectorAll('nav')).toHaveLength(2);
    expect(html).not.toContain('support.js');
    expect(html).not.toContain('DCLogic');
    expect(document.title).toBe('Fixture');
  });

  it('reports holes that resolve to nothing instead of printing "undefined"', () => {
    const { document, missing } = render({
      Main: board('<p id="out">[{{t.nope}}]</p>', { logic: 'renderVals() { return { t: {} }; }' }),
    });
    expect(document.getElementById('out')?.textContent).toBe('[]');
    expect(missing).toEqual(['Main: t.nope']);
  });

  it('refuses an import cycle rather than recursing forever', () => {
    const files = {
      Main: board('<dc-import name="Side"></dc-import>'),
      Side: board('<dc-import name="Main"></dc-import>'),
    };
    expect(() => render(files)).toThrow('import cycle: Main → Side → Main');
  });

  it('refuses a file with no <x-dc>', () => {
    expect(() => render({ Main: '<html><body></body></html>' })).toThrow('Main: no <x-dc> element');
  });
});

describe('themesOf', () => {
  it("lists the theme prop's options, or none when the board has no theme", () => {
    const parser = new DOMParser();
    const themed = board('<p></p>', { props: { theme: { options: ['light', 'dark'] } } });
    expect(themesOf(themed, parser)).toEqual(['light', 'dark']);
    expect(themesOf(board('<p></p>', { props: { $preview: {} } }), parser)).toEqual([]);
  });
});
