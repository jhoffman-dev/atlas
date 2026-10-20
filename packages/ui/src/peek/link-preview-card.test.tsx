// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkPreviewCard } from './link-preview-card.tsx';

describe('LinkPreviewCard', () => {
  it('says the title, the type and where it belongs, and the first lines', () => {
    render(
      <LinkPreviewCard
        preview={{
          title: 'P16-04',
          kicker: 'Task · Phase 16',
          excerpt: 'Leave .atlas/ out of every view.',
        }}
        placement={{ left: 150, top: 296 }}
      />,
    );
    const card = screen.getByRole('tooltip');
    expect(card.textContent).toContain('P16-04');
    expect(card.textContent).toContain('Task · Phase 16');
    expect(card.textContent).toContain('Leave .atlas/ out of every view.');
    expect(card.textContent).toContain('Click to peek');
  });

  it('stands where it is placed: under the link, or over it', () => {
    const { rerender } = render(
      <LinkPreviewCard
        preview={{ title: 'P16-04', kicker: null, excerpt: null }}
        placement={{ left: 150, top: 296 }}
      />,
    );
    const card = screen.getByRole('tooltip');
    expect(card.style.left).toBe('150px');
    expect(card.style.top).toBe('296px');
    rerender(
      <LinkPreviewCard
        preview={{ title: 'P16-04', kicker: null, excerpt: null }}
        placement={{ left: 150, bottom: 106 }}
      />,
    );
    expect(card.style.bottom).toBe('106px');
    expect(card.style.top).toBe('');
  });

  it('draws no kicker and no lines when the note has none', () => {
    render(
      <LinkPreviewCard
        preview={{ title: 'Untitled', kicker: null, excerpt: '  ' }}
        placement={{ left: 0, top: 0 }}
      />,
    );
    const card = screen.getByRole('tooltip');
    expect(card.querySelector('.link-preview__title')?.textContent).toBe('Untitled');
    expect(card.querySelector('.link-preview__kicker')).toBeNull();
    expect(card.querySelector('.link-preview__excerpt')).toBeNull();
  });
});
