import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriExportFiles, EXPORT_WRITE_HEADERS } = await import('./tauri-export-files.ts');
const { tauriPdfRenderer, PDF_HEADERS } = await import('./tauri-pdf-renderer.ts');

const destination = {
  id: 'grant-1',
  path: '/Exports/Kickoff.md',
  companion: '/Exports/Kickoff attachments',
};

describe('tauriExportFiles (#501)', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the host where an export goes, and hands back what was picked or null', async () => {
    invoke.mockResolvedValueOnce(destination).mockResolvedValueOnce(null);
    const request = { kind: 'folder', folderName: 'Exported notes 2026-10-21' } as const;
    expect(await tauriExportFiles.choose(request)).toEqual(destination);
    expect(await tauriExportFiles.choose(request)).toBeNull();
    expect(invoke).toHaveBeenCalledWith('export_choose_destination', { request });
  });

  it('writes the bytes as the raw body, naming the destination and the path in headers', async () => {
    invoke.mockResolvedValue(3);
    const bytes = new Uint8Array([1, 2, 3]);
    await tauriExportFiles.write({ destination, path: 'Kickoff attachments/chart (1).png', bytes });
    expect(invoke).toHaveBeenCalledWith('export_write_file', bytes, {
      headers: {
        [EXPORT_WRITE_HEADERS.destination]: 'grant-1',
        [EXPORT_WRITE_HEADERS.path]: 'Kickoff%20attachments%2Fchart%20(1).png',
      },
    });
  });

  it('turns the host’s refusal into an error that says it', async () => {
    invoke.mockRejectedValue('cannot write /Exports/Kickoff.md: Permission denied');
    await expect(
      tauriExportFiles.write({ destination, path: '', bytes: new Uint8Array() }),
    ).rejects.toThrow('Permission denied');
  });

  it('lets the destination go by its id', async () => {
    invoke.mockResolvedValue(null);
    await tauriExportFiles.finish(destination);
    expect(invoke).toHaveBeenCalledWith('export_finish', { id: 'grant-1' });
  });
});

describe('tauriPdfRenderer (#501)', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('sends the page as the raw body and the sheet as headers, and hands back the PDF', async () => {
    invoke.mockResolvedValue(new TextEncoder().encode('%PDF-1.7').buffer);
    const pdf = await tauriPdfRenderer.render({
      html: '<p>é</p>',
      page: { width: 612, height: 792, margin: 54 },
    });
    expect(new TextDecoder().decode(pdf)).toBe('%PDF-1.7');
    const [command, body, options] = invoke.mock.calls[0] as [
      string,
      Uint8Array,
      { headers: Record<string, string> },
    ];
    expect(command).toBe('export_render_pdf');
    expect(new TextDecoder().decode(body)).toBe('<p>é</p>');
    expect(options.headers[PDF_HEADERS.width]).toBe('612');
    expect(options.headers[PDF_HEADERS.height]).toBe('792');
    expect(Number(options.headers[PDF_HEADERS.timeoutMs])).toBeGreaterThanOrEqual(1000);
  });

  it('says why WebKit could not make it', async () => {
    invoke.mockRejectedValue('timed out after 60000 ms');
    await expect(
      tauriPdfRenderer.render({ html: '', page: { width: 612, height: 792, margin: 54 } }),
    ).rejects.toThrow('timed out after 60000 ms');
  });

  it('lays the page out on its own sheets', () => {
    expect(tauriPdfRenderer.pagingScript).toContain('const H = 792, M = 54;');
  });
});
