// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  fakeIndexPort,
  fakeVaultFs,
  recordingActivity,
  type QueryResult,
} from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import { useSelfEmailsSetting } from './use-self-emails-setting.ts';

/** #173: Settings → Profile keeps the owner's addresses as `selfEmails`, the one source. */

const VAULT = '/Users/mara/Vault';
const SETTINGS = '.atlas/settings.md';

/**
 * The index's answer to the link directory's query for one Person note,
 * Mara Quill's, with her two addresses. A fake rather than the SQLite test
 * index: this file runs in jsdom, where `node:sqlite` cannot be bundled.
 */
const MARA = 'People/Mara Quill.md';
const linkDirectory = async (): Promise<QueryResult> => ({
  columns: ['path', 'title', 'type', 'key', 'value'],
  rows: [
    [MARA, 'Mara Quill', 'person', 'email', 'mara.quill@example.com'],
    [MARA, 'Mara Quill', 'person', 'other_emails', 'mq@example.com'],
  ],
  truncated: false,
});

/** A vault whose settings note and Person note are held in memory, the settings written back as the host would. */
function vaultWith(settings: string | null = '---\nprofileName: Mara Quill\n---\n') {
  const file = { text: settings ?? '', modified: 1, unreadable: settings === null };
  const fs = fakeVaultFs({
    readNotes: async (paths) => {
      if (file.unreadable) throw new Error(`${SETTINGS} could not be read: permission denied`);
      return paths.includes(SETTINGS)
        ? [{ path: SETTINGS, text: file.text, modified: file.modified, size: 1 }]
        : [];
    },
    readTextFile: async () => ({ text: file.text, modified: file.modified }),
    writeTextFile: async ({ contents }) => {
      file.text = contents;
      file.modified += 1;
      return file.modified;
    },
  });
  return { file, fs, index: { ...fakeIndexPort(), query: linkDirectory } };
}

function render(vault = vaultWith()) {
  return renderHook(
    ({ changeKey }: { changeKey: string }) =>
      useSelfEmailsSetting({
        fs: vault.fs,
        markdown: remarkMarkdown,
        index: vault.index,
        vaultKey: VAULT,
        changeKey,
        active: true,
        activity: recordingActivity(),
      }),
    { initialProps: { changeKey: '0' } },
  );
}

describe('useSelfEmailsSetting', () => {
  it('offers the Person note’s addresses while none are kept, and uses them only once saved', async () => {
    const vault = vaultWith();
    const hook = render(vault);
    await waitFor(() =>
      expect(hook.result.current.view.suggested).toBe('mara.quill@example.com, mq@example.com'),
    );
    expect(hook.result.current.view.kept).toBe('');
    expect(hook.result.current.emails).toEqual([]);
    expect(vault.file.text).not.toContain('selfEmails');

    act(
      () => void hook.result.current.save('mara.quill@example.com; MQ@example.com mq@example.com'),
    );
    await waitFor(() =>
      expect(vault.file.text).toContain(
        'selfEmails:\n  - mara.quill@example.com\n  - mq@example.com',
      ),
    );
    expect(vault.file.text).toContain('profileName: Mara Quill');
    await waitFor(() =>
      expect(hook.result.current.view.kept).toBe('mara.quill@example.com, mq@example.com'),
    );
    expect(hook.result.current.emails).toEqual(['mara.quill@example.com', 'mq@example.com']);
  });

  it('uses the Granola key’s addresses while selfEmails keeps none, and says where they come from', async () => {
    const vault = vaultWith('---\ngranola_self_emails:\n  - mara@example.com\n---\n');
    const hook = render(vault);
    await waitFor(() => expect(hook.result.current.emails).toEqual(['mara@example.com']));
    expect(hook.result.current.view).toMatchObject({ kept: '', inherited: 'mara@example.com' });

    act(() => void hook.result.current.save('mara@example.com'));
    await waitFor(() => expect(vault.file.text).toContain('selfEmails:\n  - mara@example.com'));
    // The Granola key stays where it is; selfEmails now holds the addresses, and wins.
    expect(vault.file.text).toContain('granola_self_emails:\n  - mara@example.com');
    await waitFor(() => expect(hook.result.current.view.kept).toBe('mara@example.com'));
    expect(hook.result.current.view.inherited).toBeNull();
  });

  it('removes selfEmails when every address is taken out', async () => {
    const vault = vaultWith('---\nselfEmails:\n  - mara@example.com\n---\n');
    const hook = render(vault);
    await waitFor(() => expect(hook.result.current.view.kept).toBe('mara@example.com'));
    act(() => void hook.result.current.save('  '));
    await waitFor(() => expect(vault.file.text).not.toContain('selfEmails'));
    expect(hook.result.current.emails).toEqual([]);
  });

  it('refuses, and keeps nothing of, addresses typed with words that are not addresses', async () => {
    const vault = vaultWith('---\nselfEmails:\n  - mara@example.com\n---\n');
    const hook = render(vault);
    await waitFor(() => expect(hook.result.current.view.kept).toBe('mara@example.com'));
    const before = vault.file.text;
    let kept = true;
    act(() => {
      kept = hook.result.current.save('mq@example.com, Mara Quill');
    });
    expect(kept).toBe(false);
    expect(hook.result.current.view.problem).toBe(
      'Not an email address: “Mara”, “Quill”. Nothing was saved.',
    );
    await act(async () => undefined);
    expect(vault.file.text).toBe(before);
    expect(hook.result.current.emails).toEqual(['mara@example.com']);

    act(() => {
      kept = hook.result.current.save('Mara Quill <MQ@example.com>');
    });
    expect(kept).toBe(true);
    expect(hook.result.current.view.problem).toBeNull();
    await waitFor(() => expect(vault.file.text).toContain('selfEmails:\n  - mq@example.com'));
  });

  it('reads addresses the settings hold that are not all addresses as none, and says why', async () => {
    const vault = vaultWith(
      '---\nprofileName: Mara Quill\nselfEmails: mara.quill@example.com, Mara\ngranola_self_emails:\n  - mara.quill@example.com\n---\n',
    );
    const hook = render(vault);
    await waitFor(() =>
      expect(hook.result.current.view.unreadable).toBe(
        'Your emails in settings could not be read: Not an email address: “Mara”.',
      ),
    );
    // Nothing guessed: not the readable part, and not the Granola key's.
    expect(hook.result.current.emails).toEqual([]);
    expect(hook.result.current.view).toMatchObject({ kept: '', inherited: null });

    act(() => void hook.result.current.save('mara.quill@example.com'));
    // Saved over what could not be read: the card stops saying so at once, not once it is read again.
    expect(hook.result.current.view.unreadable).toBeNull();
    await waitFor(() =>
      expect(vault.file.text).toContain('selfEmails:\n  - mara.quill@example.com'),
    );
    expect(hook.result.current.view.kept).toBe('mara.quill@example.com');
  });

  it('uses no address, and cannot be changed, while the settings note cannot be read', async () => {
    const hook = render(vaultWith(null));
    await waitFor(() =>
      expect(hook.result.current.problem).toBe(`${SETTINGS} could not be read: permission denied`),
    );
    expect(hook.result.current.emails).toEqual([]);
    expect(hook.result.current.view.disabled).toBe(true);
  });

  it('stops using the addresses it read once the settings note can no longer be read', async () => {
    const vault = vaultWith('---\nselfEmails:\n  - mara@example.com\n---\n');
    const hook = render(vault);
    await waitFor(() => expect(hook.result.current.emails).toEqual(['mara@example.com']));

    vault.file.unreadable = true;
    hook.rerender({ changeKey: '1' });

    await waitFor(() => expect(hook.result.current.problem).toContain('could not be read'));
    expect(hook.result.current.emails).toEqual([]);
    expect(hook.result.current.view.disabled).toBe(true);
  });
});
