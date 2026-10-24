/**
 * Verification of PR #547 (#37): where ⌘J goes back to after the panes change
 * under it. Fictional notes only.
 */

import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { ASK_PLACE, askShortcut } from './ask-shortcut.ts';
import type { NavigationPlace } from './navigation-history.ts';
import {
  activePlace,
  closePaneInWorkspace,
  EMPTY_WORKSPACE,
  openInActiveTab,
  openInNewTab,
  openInSplit,
} from './workspace.ts';
import { rememberWorkspace } from './remember-workspace.ts';

const plan: NavigationPlace = { kind: 'note', path: createVaultPath('Plan.md') };
const memo: NavigationPlace = { kind: 'note', path: createVaultPath('Larkspur memo.md') };

/** Pane 0 on Plan; pane 1 holding an Ask tab and, shown and focused, the memo. */
const splitOnMemo = () =>
  openInNewTab(
    openInActiveTab(openInSplit(openInActiveTab(EMPTY_WORKSPACE, plan), plan), ASK_PLACE),
    memo,
  );

describe('askShortcut, verified (PR #547)', () => {
  it('returns to the tab it switched from after the pane before it closes and its index shifts', () => {
    const onAsk = askShortcut(splitOnMemo());
    expect(activePlace(onAsk)).toEqual(ASK_PLACE);
    const unsplit = closePaneInWorkspace(onAsk, 0);
    expect(activePlace(unsplit)).toEqual(ASK_PLACE);
    expect(activePlace(askShortcut(unsplit))).toEqual(memo);
  });

  it('never remembers where ⌘J came from across launches', () => {
    const onAsk = askShortcut(splitOnMemo());
    expect(onAsk.askReturn).toBeDefined();
    const remembered = JSON.stringify(rememberWorkspace({ vaultKey: 'v', workspace: onAsk }));
    expect(remembered).not.toContain('askReturn');
  });
});
