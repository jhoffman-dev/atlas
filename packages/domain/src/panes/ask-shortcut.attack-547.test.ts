/**
 * Attack on PR #547 (#37): ⌘J on Ask goes back to where you were — also when
 * the first ⌘J only switched to a tab already on Ask.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { ASK_PLACE, askShortcut } from './ask-shortcut.ts';
import type { NavigationPlace } from './navigation-history.ts';
import { activePlace, EMPTY_WORKSPACE, openInActiveTab, openInNewTab } from './workspace.ts';

const payroll: NavigationPlace = { kind: 'note', path: createVaultPath('Larkspur Payroll.md') };

describe('askShortcut, attacked (PR #547)', () => {
  it('⌘J then ⌘J returns to the note you were on when ⌘J switched to an Ask tab already open', () => {
    // Pane: [Ask] [Larkspur Payroll*]. ⌘J shows the Ask tab; ⌘J again must come back.
    const onNote = openInNewTab(openInActiveTab(EMPTY_WORKSPACE, ASK_PLACE), payroll);
    expect(activePlace(onNote)).toEqual(payroll);
    const onAsk = askShortcut(onNote);
    expect(activePlace(onAsk)).toEqual(ASK_PLACE);
    expect(activePlace(askShortcut(onAsk))).toEqual(payroll);
  });
});
