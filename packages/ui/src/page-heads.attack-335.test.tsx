// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildVaultGraph,
  createVaultPath,
  DEFAULT_GRAPH_FILTER,
  NO_LINKS,
  readProposal,
  scopeGraph,
  type EditorDocument,
  type ListedTerm,
} from '@atlas/domain';
import { TermsPage, type TermsContents } from './terms-page.tsx';
import { GraphView } from './graph/graph-view.tsx';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';
import { NotePane, type NotePaneProps, type PageHeading } from './note-pane.tsx';

// Attack on #335 (UI v2 slice 3b, #295): the counts that moved into the nav
// bar, and the rename field a view keeps for "Rename file".

const barCount = (container: HTMLElement) => container.querySelector('.page-bar__count');

describe('the bar count is hidden at 0', () => {
  const terms = (contents: TermsContents) =>
    render(
      <TermsPage
        contents={contents}
        error={null}
        onAdd={() => {}}
        onEditVariants={() => {}}
        onOpen={() => {}}
      />,
    );

  it('Terms with no terms and no spellings shows no count', () => {
    const { container } = terms({ terms: [], conflicts: [], warnings: [], spellings: 0 });
    expect(barCount(container)?.textContent ?? null).toBeNull();
  });

  it('Terms says "1 term · 1 misheard spelling" in the singular', () => {
    const one: ListedTerm = {
      path: createVaultPath('Terms/Larkspur.md'),
      canonical: 'Larkspur',
      variants: ['lark spur'],
      kind: null,
      source: 'term',
    };
    const { container } = terms({ terms: [one], conflicts: [], warnings: [], spellings: 1 });
    expect(barCount(container)?.textContent).toBe('1 term · 1 misheard spelling');
  });

  it('the Graph of an empty vault shows no count', () => {
    const empty = buildVaultGraph({ notes: [], links: [], relations: [] });
    const graph = scopeGraph(empty, { scope: { kind: 'vault' }, filter: DEFAULT_GRAPH_FILTER });
    const { container } = render(
      <GraphView
        content={{ kind: 'ready', graph, hidden: 0 }}
        centre={null}
        types={[]}
        typeLabel={(type) => type ?? 'No type'}
        tones={new Map()}
        filter={DEFAULT_GRAPH_FILTER}
        onFilterChange={vi.fn()}
        onDepthChange={vi.fn()}
        onShowVault={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(barCount(container)?.textContent ?? null).toBeNull();
  });
});

function proposalNamed(title: string) {
  const reading = readProposal({
    path: createVaultPath(`Inbox/Proposals/${title}.md`),
    properties: { type: 'proposal', kind: 'task', payload: { title } },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

describe('the Inbox count when one side is 0', () => {
  const EMPTY: InboxContents = { items: [], truncated: false, total: 0 };
  const inbox = (overrides: Partial<InboxPageProps>) =>
    render(
      <InboxPage
        contents={EMPTY}
        error={null}
        filing={[]}
        people={[]}
        onOpen={vi.fn()}
        onShowMore={vi.fn()}
        onClarify={vi.fn(async () => true)}
        busy={false}
        problem={null}
        {...overrides}
      />,
    );

  it('nothing to process but 2 to answer reads as a count, "2 to answer", not a sentence', () => {
    const proposals = {
      contents: { open: [], stranded: [], unreadable: [] },
      error: null,
      notice: null,
      busy: null,
      problems: new Map(),
      onAccept: vi.fn(),
      onReject: vi.fn(),
      selection: { selected: new Set<string>(), onToggle: vi.fn(), onToggleAll: vi.fn() },
      onClearSelection: vi.fn(),
      onAcceptMany: vi.fn(),
      onRejectMany: vi.fn(),
      onUndo: vi.fn(),
      onDismissNotice: vi.fn(),
      onOpen: vi.fn(),
      onOpenSource: vi.fn(),
    } as unknown as NonNullable<InboxPageProps['proposals']>;
    const two = {
      ...proposals,
      contents: {
        ...proposals.contents!,
        open: [proposalNamed('Send Mara the file'), proposalNamed('Call Tobias')],
      },
    };
    const { container } = inbox({ proposals: two });
    expect(barCount(container)?.textContent).toBe('2 to answer');
  });

  it('5 to process and nothing to answer reads "5 to process"', () => {
    const { container } = inbox({ contents: { ...EMPTY, total: 5 } });
    expect(barCount(container)?.textContent).toBe('5 to process');
  });
});

const doc = { type: 'doc', content: [] } as unknown as EditorDocument;

const viewHeading = (overrides: Partial<PageHeading> = {}): PageHeading => ({
  kind: 'view',
  crumb: { icon: 'folder', parent: 'Views' },
  // A title from a property, so the "…" menu offers "Rename file".
  title: { text: 'Doing', source: 'property' },
  description: null,
  path: '.atlas/views/Doing.md',
  sql: null,
  ...overrides,
});

function showView(overrides: Partial<NotePaneProps> = {}) {
  const props = {
    state: {
      kind: 'ready',
      title: 'Doing',
      doc,
      dirty: false,
      saving: false,
      saveError: null,
    },
    heading: viewHeading(),
    arrangement: {},
    onChange: vi.fn(),
    onSave: vi.fn(),
    onFollowLink: vi.fn(),
    suggestNotes: () => [],
    links: NO_LINKS,
    mentions: { kind: 'idle' },
    onFindMentions: vi.fn(),
    onLinkMention: vi.fn(),
    onOpenNote: vi.fn(),
    loadImage: async () => null,
    typeName: null,
    properties: [],
    propertyKeys: [],
    relationChoices: {},
    typeLabel: null,
    relationTargets: [],
    onChangeProperty: vi.fn(),
    onAddProperty: vi.fn(async () => 'x'),
    onRename: vi.fn(),
    onOverwrite: vi.fn(),
    onDiscard: vi.fn(),
    body: <p>the board</p>,
    ...overrides,
  } as unknown as NotePaneProps;
  const view = render(<NotePane {...props} />);
  return { props, ...view };
}

describe('a view headed by its bar', () => {
  it('a blank description draws no empty count beside the name', () => {
    const { container } = showView({ heading: viewHeading({ description: '' }) });
    expect(barCount(container)).toBeNull();
  });

  it('a whitespace-only description draws no count beside the name', () => {
    const { container } = showView({ heading: viewHeading({ description: '   ' }) });
    expect(barCount(container)).toBeNull();
  });

  it('"Rename file", then Escape: the field goes, nothing is renamed, one h1 is back', async () => {
    const { props } = showView();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Rename file/ }));
    const input = screen.getByRole('textbox', { name: 'Note name' });
    await userEvent.type(input, ' later{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Note name' })).toBeNull();
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('"Rename file" to a blank name renames nothing and closes the field', async () => {
    const { props } = showView();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Rename file/ }));
    const input = screen.getByRole('textbox', { name: 'Note name' });
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');
    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Note name' })).toBeNull();
  });

  it('while "Rename file" is open the page still has exactly one h1', async () => {
    showView();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Rename file/ }));
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
