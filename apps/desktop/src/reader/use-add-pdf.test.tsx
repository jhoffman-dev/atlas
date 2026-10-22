// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { fakeVaultFs } from '@dfai/application';
import { useAddPdf } from './use-add-pdf.ts';

/*
 * Adding PDFs when pdf.js, loaded on the first one added, cannot be loaded
 * (a chunk missing from the build, a disk that failed): said, and the dialog
 * is usable again rather than stuck on "Adding…".
 */

vi.mock('./app-pdf-reader.ts', () => {
  throw new Error('Importing a module script failed.');
});

describe('adding a PDF when the reader cannot be loaded', () => {
  it('says so and stops adding, adding nothing', async () => {
    const onAdded = vi.fn();
    const { result } = renderHook(() =>
      useAddPdf({ fs: fakeVaultFs(), types: [], today: () => '2026-10-22', onAdded }),
    );
    await act(() =>
      result.current.add([new File(['%PDF-1.4'], 'lanterns.pdf', { type: 'application/pdf' })]),
    );
    expect(result.current.adding).toBe(false);
    expect(result.current.error).toContain('could not be loaded');
    expect(onAdded).not.toHaveBeenCalled();
  });
});
