// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardColumn, BoardRow } from '@atlas/domain';
import { ArtifactCardFace } from './artifact-card-face.tsx';
import { ARTIFACT_SANDBOX, ArtifactViewer, type ArtifactViewerCopy } from './artifact-viewer.tsx';
import { GalleryView } from './list-view.tsx';
import {
  LINK_ONLY_NOTE,
  NewArtifactDialog,
  type NewArtifactDraft,
} from './new-artifact-dialog.tsx';

const KINDS = [
  { value: 'page', label: 'Page' },
  { value: 'deck', label: 'Deck' },
];
const DRAFT: NewArtifactDraft = { url: '', title: '', kind: 'page', project: '', files: [] };
const page = new File(['<h1>Q3</h1>'], 'deck.html', { type: 'text/html' });

function dialog(
  draft: Partial<NewArtifactDraft> = {},
  extra: { error?: string; saving?: boolean } = {},
) {
  const onChange = vi.fn();
  const onCreate = vi.fn();
  const onClose = vi.fn();
  render(
    <NewArtifactDialog
      draft={{ ...DRAFT, ...draft }}
      kinds={KINDS}
      projects={[{ value: 'Atlas', label: 'Atlas' }]}
      error={extra.error ?? null}
      saving={extra.saving ?? false}
      onChange={onChange}
      onCreate={onCreate}
      onClose={onClose}
    />,
  );
  return { onChange, onCreate, onClose };
}

describe('NewArtifactDialog', () => {
  it('says that only the link is kept until a page is dropped', () => {
    dialog();
    expect(screen.getByRole('dialog', { name: 'New artifact' })).toBeDefined();
    expect(screen.getByText(LINK_ONLY_NOTE)).toBeDefined();
  });

  it('hands on each field as it changes', async () => {
    const { onChange } = dialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Link' }), {
      target: { value: 'https://claude.ai/artifact/a' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, url: 'https://claude.ai/artifact/a' });
    await userEvent.click(screen.getByRole('button', { name: 'Deck' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, kind: 'deck' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Atlas');
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, project: 'Atlas' });
  });

  it('takes a dropped page, and a picked one', async () => {
    const { onChange } = dialog();
    const zone = screen.getByRole('group', { name: 'Drop the page here' });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [page] } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, files: [page] });

    await userEvent.upload(screen.getByLabelText("Choose the page's files"), page);
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, files: [page] });
  });

  it('ignores a drag that carries no files', () => {
    const { onChange } = dialog();
    const zone = screen.getByRole('group', { name: 'Drop the page here' });
    fireEvent.drop(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names the files it will save, and can go back to the link alone', async () => {
    const { onChange } = dialog({ files: [page] });
    expect(screen.queryByText(LINK_ONLY_NOTE)).toBeNull();
    expect(screen.getByText(/deck\.html/)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Keep only the link' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DRAFT, files: [] });
  });

  it('saves only with a title, on Enter or the button, and not while saving', async () => {
    const empty = dialog();
    const save = screen.getByRole('button', { name: 'Save artifact' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '{Enter}');
    expect(empty.onCreate).not.toHaveBeenCalled();
  });

  it('saves a titled artifact, and shows why a save was refused', async () => {
    const { onCreate } = dialog({ title: 'Q3' }, { error: 'There is no page to open' });
    await userEvent.click(screen.getByRole('button', { name: 'Save artifact' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toBe('There is no page to open');
  });

  it('cannot save twice while a save is under way', () => {
    dialog({ title: 'Q3' }, { saving: true });
    const save = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});

function viewer(copy: ArtifactViewerCopy, url: string | null = 'https://claude.ai/artifact/a') {
  const handlers = { onOpenLink: vi.fn(), onReload: vi.fn(), onAddCopy: vi.fn() };
  const view = render(
    <ArtifactViewer title="Q3" url={url} copy={copy} adding={false} error={null} {...handlers} />,
  );
  return { ...handlers, ...view };
}

describe('ArtifactViewer', () => {
  it('shows the copy in a frame that may run scripts and nothing else', () => {
    viewer({ kind: 'ready', page: '<h1>Q3 numbers</h1>' });
    const frame = screen.getByTitle('Saved copy of Q3') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(ARTIFACT_SANDBOX).not.toMatch(/same-origin|top-navigation|popups|forms/);
    expect(frame.getAttribute('srcdoc')).toBe('<h1>Q3 numbers</h1>');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('opens the link, reloads, and fills the pane until Escape', async () => {
    const { onOpenLink, onReload, container } = viewer({ kind: 'ready', page: 'x' });
    await userEvent.click(screen.getByRole('button', { name: 'Open link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledTimes(1);

    const section = container.querySelector('section');
    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(section?.classList.contains('artifact-viewer--full')).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(section?.classList.contains('artifact-viewer--full')).toBe(false);
  });

  it('says there is only the link, with the ways to add a copy, and takes a dropped page', () => {
    const { onAddCopy } = viewer({ kind: 'none' });
    expect(screen.queryByTitle('Saved copy of Q3')).toBeNull();
    expect(screen.getByText('Only the link is saved')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
    const zone = screen.getByRole('group', { name: 'Drop the page here' });
    expect(within(zone).getByRole('button', { name: 'Open link' })).toBeDefined();
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [page] } });
    expect(onAddCopy).toHaveBeenCalledWith([page]);
  });

  it('says a copy is missing, and offers no link when the note has none', () => {
    viewer({ kind: 'missing' }, null);
    expect(screen.getByText('The saved copy is missing')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Open link' })).toBeNull();
  });
});

describe('the artifacts gallery', () => {
  const rows: BoardRow[] = [
    { path: 'artifacts/A.md', title: 'Alpha', values: { kind: 'deck' } },
    { path: 'artifacts/B.md', title: 'Beta', values: { kind: 'page' } },
  ];

  it('fronts a card with no picture with its kind and title', async () => {
    const covers = { coverOf: () => null, load: async () => null };
    const { container } = render(
      <GalleryView
        rows={rows}
        fields={[]}
        onOpenNote={() => {}}
        covers={covers}
        placeholder={(row) => (
          <ArtifactCardFace kind={String(row.values['kind'])} title={row.title} />
        )}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('.artifact-face')).toHaveLength(2));
    expect(container.querySelector('[data-kind="deck"]')?.textContent).toBe('Alpha');
  });

  it('draws a heading and a grid for each group that has cards', () => {
    const groups: BoardColumn[] = [
      { value: 'deck', label: 'deck', rows: [rows[0] as BoardRow] },
      { value: 'design', label: 'design', rows: [] },
      { value: 'page', label: 'page', rows: [rows[1] as BoardRow] },
    ];
    render(<GalleryView rows={rows} groups={groups} fields={[]} onOpenNote={() => {}} />);
    const sections = screen.getAllByRole('region');
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(['deck', 'page']);
    expect(within(sections[0] as HTMLElement).getByRole('button', { name: 'Alpha' })).toBeDefined();
  });
});
