import { describe, expect, it } from 'vitest';
import { EXPORT_PAGE, exportPageDocument, exportPagePolicy, propertySummary } from './index.ts';

describe('propertySummary (#501)', () => {
  it('reads each property as words, in order, leaving out the title and empty ones', () => {
    expect(
      propertySummary({
        title: 'Kickoff',
        attendees: ['[[Mara Quill]]', '[[people/tobias|Tobias Fenn]]'],
        project: '[[Larkspur Payroll]]',
        done: false,
        effort: 3,
        due: new Date('2026-10-21T00:00:00Z'),
        notes: '',
        empty: [],
        none: null,
        extra: { nested: 1 },
      }),
    ).toEqual([
      { label: 'attendees', value: 'Mara Quill, Tobias Fenn' },
      { label: 'project', value: 'Larkspur Payroll' },
      { label: 'done', value: 'No' },
      { label: 'effort', value: '3' },
      { label: 'due', value: '2026-10-21' },
      { label: 'extra', value: '{"nested":1}' },
    ]);
  });
});

describe('exportPageDocument (#501)', () => {
  const page = (script: string | null = null) =>
    exportPageDocument({
      title: 'Plan <b>&</b> "Q3"',
      properties: [{ label: 'owner<', value: 'Mara & Tobias' }],
      bodyHtml: '<p>Body</p>',
      styles: 'p{color:#111}</style><b>out</b>',
      script,
    });

  it('escapes the title and the properties, and keeps the body as the editor drew it', () => {
    const html = page();
    expect(html).toContain('<title>Plan &lt;b&gt;&amp;&lt;/b&gt; &quot;Q3&quot;</title>');
    expect(html).toContain('<th scope="row">owner&lt;</th><td>Mara &amp; Tobias</td>');
    expect(html).toContain('<div class="export__body"><p>Body</p></div>');
  });

  it('cannot be closed early by what its styles or script hold', () => {
    const html = page('if (a </script> b) {}');
    expect(html).toContain('p{color:#111}<\\/style><b>out</b></style>');
    expect(html).toContain('<script>if (a <\\/script> b) {}</script>');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html.match(/<\/style>/g)).toHaveLength(1);
  });

  it('runs a script only when given one, and never fetches anything', () => {
    expect(page()).toContain(`content="${exportPagePolicy({ script: false })}"`);
    expect(exportPagePolicy({ script: false })).toContain("script-src 'none'");
    expect(exportPagePolicy({ script: true })).toContain("script-src 'unsafe-inline'");
    expect(page()).not.toContain('<script>');
    expect(exportPagePolicy({ script: true })).toContain("connect-src 'none'");
    expect(exportPagePolicy({ script: false })).toContain('img-src data:;');
    expect(exportPagePolicy({ script: false })).not.toContain('https:');
  });

  it('has no summary when the note has no properties', () => {
    const html = exportPageDocument({ title: 'T', properties: [], bodyHtml: '', styles: '' });
    expect(html).not.toContain('export__properties');
  });

  it('is laid out on US Letter with three-quarter-inch margins', () => {
    expect(EXPORT_PAGE).toEqual({ width: 612, height: 792, margin: 54 });
  });
});
