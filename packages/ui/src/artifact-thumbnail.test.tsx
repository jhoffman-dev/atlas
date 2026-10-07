// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardRow, PropertyDef } from '@atlas/domain';
import { ArtifactCardFace } from './artifact-card-face.tsx';
import { ThumbnailValue } from './thumbnail-value.tsx';
import { ArtifactViewer } from './artifact-viewer.tsx';
import { GalleryView } from './list-view.tsx';
import { PropertiesPanel } from './properties-panel.tsx';

function thumbnailValue(overrides: Partial<Parameters<typeof ThumbnailValue>[0]> = {}) {
  const handlers = { onRegenerate: vi.fn(), onClear: vi.fn() };
  const load = vi.fn(async (src: string) => `blob:${src}`);
  render(
    <ThumbnailValue
      id="thumb"
      cover="q3/atlas-thumbnail.png"
      shown="q3/atlas-thumbnail.png"
      generating={false}
      failure={null}
      canGenerate
      load={load}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, load };
}

describe('the Thumbnail row', () => {
  it('shows the picture rather than its path, loading what it is told to show', async () => {
    const { load } = thumbnailValue({ shown: 'q3/atlas-thumbnail.png#2' });
    const image = await screen.findByRole('img');
    expect(image.getAttribute('src')).toBe('blob:q3/atlas-thumbnail.png#2');
    expect(load).toHaveBeenCalledWith('q3/atlas-thumbnail.png#2');
    expect(screen.queryByText('q3/atlas-thumbnail.png')).toBeNull();
  });

  it('regenerates and clears', async () => {
    const { onRegenerate, onClear } = thumbnailValue();
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('asks before Regenerate replaces a picture only the note remembers', async () => {
    const url = 'https://example.com/dune.jpg';
    const { onRegenerate } = thumbnailValue({ cover: url, shown: url, regenerateDiscards: url });
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog').textContent).toContain(url);

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onRegenerate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replace it' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('offers Choose image… where it can take a picture, handing over the file picked', async () => {
    const onChoose = vi.fn();
    thumbnailValue({ onChoose });
    const picker = screen.getByLabelText('Choose a thumbnail image') as HTMLInputElement;
    const click = vi.spyOn(picker, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Choose image…' }));
    expect(click).toHaveBeenCalledTimes(1);
    const file = new File([new Uint8Array([1])], 'me.png', { type: 'image/png' });
    await userEvent.upload(picker, file);
    expect(onChoose).toHaveBeenCalledWith(file);
    expect(picker.accept).toContain('.png');
  });

  it('offers no Choose image… without somewhere to put it', () => {
    thumbnailValue();
    expect(screen.queryByRole('button', { name: 'Choose image…' })).toBeNull();
  });

  it('says a cleared one is none, with nothing to clear, and one not made yet can be cleared', () => {
    thumbnailValue({ cover: null, shown: null, clearable: false, emptyLabel: 'None' });
    expect(screen.getByText('None', { exact: true })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('can be cleared before its first picture is made', () => {
    thumbnailValue({ cover: null, shown: null, clearable: true });
    expect(screen.getByText('None yet')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDefined();
  });

  it('says it is generating, with both actions held until it is done', () => {
    thumbnailValue({ generating: true });
    expect(screen.getByText('Generating…')).toBeDefined();
    expect(screen.queryByRole('img')).toBeNull();
    for (const name of ['Regenerate', 'Clear']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('offers Generate, and no Clear, when there is none; nothing to make without a copy', () => {
    thumbnailValue({ cover: null, shown: null });
    expect(screen.getByText('None yet')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('offers no Generate without a copy, and says why the last one failed', () => {
    thumbnailValue({ canGenerate: false, failure: 'thumbnails are made on macOS only' });
    expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'No thumbnail: thumbnails are made on macOS only',
    );
  });

  it('is drawn in place of the text box by the properties panel, labelled by the row', () => {
    const def: PropertyDef = {
      key: 'cover',
      label: 'Thumbnail',
      kind: 'text',
      required: false,
      options: [],
      target: null,
      many: false,
    };
    render(
      <PropertiesPanel
        typeName="artifact"
        rows={[{ def, value: 'q3/atlas-thumbnail.png', error: null }]}
        relationChoices={{}}
        onChange={() => {}}
        customValues={{ cover: (id) => <span id={id}>the picture</span> }}
      />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Thumbnail').getAttribute('for')).toBe(
      screen.getByText('the picture').id,
    );
  });
});

describe('Regenerate on the saved copy', () => {
  const view = (thumbnail?: { generating: boolean; onRegenerate: () => void }) =>
    render(
      <ArtifactViewer
        title="Q3"
        url={null}
        copy={{ kind: 'ready', page: '<p>' }}
        adding={false}
        error={null}
        onOpenLink={() => {}}
        onReload={() => {}}
        onAddCopy={() => {}}
        {...(thumbnail !== undefined && { thumbnail })}
      />,
    );

  it('makes the thumbnail again, and says so while it does', async () => {
    const onRegenerate = vi.fn();
    const { rerender } = view({ generating: false, onRegenerate });
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate thumbnail' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    rerender(
      <ArtifactViewer
        title="Q3"
        url={null}
        copy={{ kind: 'ready', page: '<p>' }}
        adding={false}
        error={null}
        onOpenLink={() => {}}
        onReload={() => {}}
        onAddCopy={() => {}}
        thumbnail={{ generating: true, onRegenerate }}
      />,
    );
    const busy = screen.getByRole('button', { name: 'Generating thumbnail…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
  });

  it('is not offered where no thumbnail can be made', () => {
    view();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /thumbnail/i })).toBeNull();
  });
});

describe('an artifact card', () => {
  const rows: BoardRow[] = [{ path: 'artifacts/A.md', title: 'Alpha', values: { kind: 'deck' } }];

  it('is fronted 16:10 with the thumbnail once there is one', async () => {
    const { container } = render(
      <GalleryView
        rows={rows}
        fields={[]}
        onOpenNote={() => {}}
        covers={{
          coverOf: () => 'a/atlas-thumbnail.png',
          load: async (args) => `blob:${args.src}`,
        }}
        fronts="screen"
      />,
    );
    const cover = await waitFor(() => {
      const found = container.querySelector('img.card-cover');
      expect(found).not.toBeNull();
      return found;
    });
    expect(cover?.getAttribute('src')).toBe('blob:a/atlas-thumbnail.png');
    expect(container.querySelector('ul.gallery')?.classList.contains('gallery--screens')).toBe(
      true,
    );
  });

  it('says a thumbnail is being made on its drawn front', () => {
    const { container, rerender } = render(<ArtifactCardFace kind="deck" title="Alpha" />);
    expect(screen.queryByText('Generating thumbnail…')).toBeNull();
    expect(container.querySelector('.artifact-face')?.getAttribute('aria-busy')).toBe('false');
    rerender(<ArtifactCardFace kind="deck" title="Alpha" generating />);
    expect(screen.getByText('Generating thumbnail…')).toBeDefined();
    expect(container.querySelector('.artifact-face')?.getAttribute('aria-busy')).toBe('true');
  });
});
