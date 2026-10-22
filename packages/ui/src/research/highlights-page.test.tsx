// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createVaultPath,
  highlightChoices,
  NO_HIGHLIGHT_FILTER,
  type HighlightEntry,
} from '@dfai/domain';
import { HighlightsPage, type HighlightsPageProps } from './highlights-page.tsx';

const ART = createVaultPath('Library/The Art of War.md');
const STOIC = createVaultPath('Library/Meditations.md');

function highlight(id: string, rest: Partial<HighlightEntry> = {}): HighlightEntry {
  return {
    path: ART,
    source: 'The Art of War',
    modified: 0,
    index: 0,
    id,
    kind: 'pdf',
    quote: `Quote ${id}`,
    comment: '',
    mark: 'highlight',
    color: 'yellow',
    page: null,
    location: null,
    tags: [],
    ...rest,
  };
}

const DECEPTION = highlight('k3x9q2', {
  quote: 'All warfare is based on deception.',
  comment: 'Compare the Larkspur pitch.',
  color: 'green',
  page: 3,
  tags: ['strategy'],
});
const FATE = highlight('m1n2o3', {
  path: STOIC,
  source: 'Meditations',
  kind: 'kindle',
  quote: 'Accept the things to which fate binds you.',
  color: 'teal',
  mark: 'underline',
  location: 77,
});
const ENTRIES = [DECEPTION, FATE];

function renderPage(props: Partial<HighlightsPageProps> = {}) {
  const handlers = {
    onFilter: vi.fn(),
    onOpen: vi.fn(),
    onCopyEmbed: vi.fn(),
    linkTargetOf: vi.fn((path: string) => path.replace(/^Library\//, '').replace(/\.md$/, '')),
  };
  render(
    <HighlightsPage
      state={{ kind: 'ready', shown: ENTRIES, total: ENTRIES.length }}
      choices={highlightChoices(ENTRIES)}
      filter={NO_HIGHLIGHT_FILTER}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const rows = () =>
  within(screen.getByRole('list', { name: 'Highlights' })).getAllByRole('listitem');

describe('HighlightsPage (#507)', () => {
  it("names a row's colour and mark in its accessible name, not only by its swatch", () => {
    renderPage();
    const [deception, fate] = rows();
    expect(within(deception!).getByRole('button', { name: /^green highlight:/ })).toBeTruthy();
    // An unknown colour is drawn yellow, and is called so.
    expect(within(fate!).getByRole('button', { name: /^yellow underline:/ })).toBeTruthy();
  });

  it('tells a screen reader where each row is among all of them', () => {
    renderPage();
    const [first, second] = rows();
    expect(first?.getAttribute('aria-setsize')).toBe('2');
    expect(first?.getAttribute('aria-posinset')).toBe('1');
    expect(second?.getAttribute('aria-posinset')).toBe('2');
  });

  it("copies a highlight's embed from the keyboard: Cmd+C on its row, and its Copy embed button", async () => {
    const { onCopyEmbed } = renderPage();
    const user = userEvent.setup();
    within(rows()[0]!)
      .getByRole('button', { name: /^green highlight:/ })
      .focus();
    await user.keyboard('{Meta>}c{/Meta}');
    expect(onCopyEmbed).toHaveBeenLastCalledWith('![[The Art of War#^k3x9q2]]');
    await user.click(within(rows()[1]!).getByRole('button', { name: /Copy embed/ }));
    expect(onCopyEmbed).toHaveBeenLastCalledWith('![[Meditations#^m1n2o3]]');
  });

  it('leaves Cmd+C to the browser while words are selected', async () => {
    const { onCopyEmbed } = renderPage();
    const open = within(rows()[0]!).getByRole('button', { name: /^green highlight:/ });
    open.focus();
    const range = document.createRange();
    range.selectNodeContents(within(rows()[0]!).getByText('All warfare is based on deception.'));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.keyDown(open, { key: 'c', metaKey: true });
    expect(onCopyEmbed).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
    fireEvent.keyDown(open, { key: 'c', metaKey: true });
    expect(onCopyEmbed).toHaveBeenCalledTimes(1);
  });

  it('offers Clear filters only while a filter is on, and clears them all', async () => {
    const { onFilter } = renderPage();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    cleanup();
    const again = renderPage({ filter: { ...NO_HIGHLIGHT_FILTER, tag: 'strategy' } });
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(again.onFilter).toHaveBeenLastCalledWith(NO_HIGHLIGHT_FILTER);
    expect(onFilter).not.toHaveBeenCalled();
  });

  it('lists each highlight: quote, comment, source, place, and its colour as a pastel', () => {
    renderPage();
    const [deception, fate] = rows();
    expect(deception?.textContent).toContain('All warfare is based on deception.');
    expect(deception?.textContent).toContain('Compare the Larkspur pitch.');
    expect(deception?.textContent).toContain('The Art of War');
    expect(deception?.textContent).toContain('Page 3');
    expect(deception?.querySelector('.highlight__swatch')?.getAttribute('data-hue')).toBe('green');
    expect(fate?.textContent).toContain('Location 77');
    // A colour this build does not know is drawn yellow; an underline says so.
    const swatch = fate?.querySelector('.highlight__swatch');
    expect(swatch?.getAttribute('data-hue')).toBe('yellow');
    expect(swatch?.getAttribute('data-mark')).toBe('underline');
    expect(fate?.querySelector('.highlight__comment')).toBeNull();
    expect(screen.getByText('2 highlights')).toBeTruthy();
  });

  it("opens a highlight's place — its note, at its block — where the click asks", async () => {
    const { onOpen } = renderPage();
    await userEvent.click(within(rows()[0]!).getByRole('button', { name: /highlight:/ }));
    expect(onOpen).toHaveBeenLastCalledWith(ART, 'k3x9q2', 'here');
    const user = userEvent.setup();
    await user.keyboard('{Meta>}{Shift>}');
    await user.click(within(rows()[1]!).getByRole('button', { name: /underline:/ }));
    expect(onOpen).toHaveBeenLastCalledWith(STOIC, 'm1n2o3', 'split');
  });

  it('carries the embed of its block when dragged: as text, and as the editor reads a block embed', () => {
    const { linkTargetOf } = renderPage();
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => data.set(type, value),
      effectAllowed: 'none',
    };
    fireEvent.dragStart(rows()[0]!, { dataTransfer });
    expect(linkTargetOf).toHaveBeenCalledWith(ART);
    expect(data.get('text/plain')).toBe('![[The Art of War#^k3x9q2]]');
    expect(data.get('text/html')).toBe(
      '<div data-block-embed="The Art of War" data-heading="#^k3x9q2"></div>',
    );
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(rows()[0]?.getAttribute('draggable')).toBe('true');
  });

  it('filters by source, colour, tag, comment and when the source changed', async () => {
    const { onFilter } = renderPage();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Source' }), STOIC);
    expect(onFilter).toHaveBeenLastCalledWith({ ...NO_HIGHLIGHT_FILTER, source: STOIC });

    const colours = screen.getByRole('group', { name: 'Colour' });
    expect(
      within(colours)
        .getAllByRole('button')
        .map((chip) => [chip.textContent, chip.getAttribute('data-hue')]),
    ).toEqual([
      ['Yellow1', 'yellow'],
      ['Green1', 'green'],
    ]);
    await userEvent.click(within(colours).getByRole('button', { name: /Green/ }));
    expect(onFilter).toHaveBeenLastCalledWith({ ...NO_HIGHLIGHT_FILTER, colors: ['green'] });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tag' }), 'strategy');
    expect(onFilter).toHaveBeenLastCalledWith({ ...NO_HIGHLIGHT_FILTER, tag: 'strategy' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Comment' }), 'with');
    expect(onFilter).toHaveBeenLastCalledWith({ ...NO_HIGHLIGHT_FILTER, comment: 'with' });

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Date' }), 'week');
    expect(onFilter).toHaveBeenLastCalledWith({ ...NO_HIGHLIGHT_FILTER, changed: 'week' });
  });

  it('says it is reading, and when there are none or none match', () => {
    const cases: [HighlightsPageProps['state'], string][] = [
      [{ kind: 'loading' }, 'Reading the highlights…'],
      [{ kind: 'failed', message: 'The highlights could not be read: busy' }, 'busy'],
      [{ kind: 'ready', shown: [], total: 0 }, 'No highlights yet.'],
      [{ kind: 'ready', shown: [], total: 5 }, 'No highlight matches.'],
    ];
    for (const [state, said] of cases) {
      const view = render(
        <HighlightsPage
          state={state}
          choices={highlightChoices([])}
          filter={NO_HIGHLIGHT_FILTER}
          onFilter={() => {}}
          onOpen={() => {}}
          onCopyEmbed={() => {}}
          linkTargetOf={() => ''}
        />,
      );
      expect(view.getByText(said, { exact: false })).toBeTruthy();
      expect(view.queryByRole('list', { name: 'Highlights' })).toBeNull();
      view.unmount();
    }
  });

  it('puts only a screenful of 20,000 highlights in the page', () => {
    const many = Array.from({ length: 20_000 }, (_, at) => highlight(`h${at}`, { index: at }));
    renderPage({ state: { kind: 'ready', shown: many, total: many.length } });
    const drawn = rows().length;
    expect(drawn).toBeGreaterThan(5);
    expect(drawn).toBeLessThan(80);
    expect(screen.getByText('20,000 highlights')).toBeTruthy();
  });
});
