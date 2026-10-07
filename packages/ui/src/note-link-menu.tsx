import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { BOOKMARK_NODE } from '@atlas/domain';
import { linkSwitchAt, showAsBookmark, showAsLink } from './editor/bookmark-commands.ts';
import { FOLLOW_REQUEST, LINK_MENU_REQUEST, type LinkMenuRequest } from './editor/link-keys.ts';
import { LinkHoverButton, LinkMenu } from './link-menu.tsx';
import type { MenuCommand } from './menu-items.tsx';

/** How long the "…" stays up once the pointer has left the link, to be reached. */
const HOVER_GRACE_MS = 300;

const LINKS: ReadonlySet<string> = new Set(['wikiLink', BOOKMARK_NODE]);

/** The position of the link or card `element` draws, or null when it draws neither. */
function linkPositionOf(editor: Editor, element: Element): number | null {
  let at: number;
  try {
    at = editor.view.posAtDOM(element, 0);
  } catch {
    // Not in this editor's document (a popup, say): no link of the note's.
    return null;
  }
  const candidates = [at, at - 1].filter((position) => position >= 0);
  return (
    candidates.find((position) => LINKS.has(editor.state.doc.nodeAt(position)?.type.name ?? '')) ??
    null
  );
}

/** The link element under an event, inside this editor, or null. */
function linkElementOf(editor: Editor, target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest('[data-bookmark], [data-wikilink]');
  return element !== null && editor.view.dom.contains(element) ? element : null;
}

/**
 * The menu of each link in an editable note (P22-02), and the ways to it: the
 * "…" over a link under the pointer and on a card, a right-click, and
 * Shift+F10. Also opens a selected card's note on Enter. Hands back the
 * handlers for the element round the editor, and what to draw.
 */
export function useLinkMenu({
  editor,
  onFollowLink,
}: {
  editor: Editor | null;
  onFollowLink: (target: string) => void;
}): {
  handlers: {
    onMouseOver: (event: MouseEvent) => void;
    onMouseOut: (event: MouseEvent) => void;
    onContextMenu: (event: MouseEvent) => void;
  };
  overlay: ReactNode;
} {
  const [menu, setMenu] = useState<LinkMenuRequest | null>(null);
  const [hover, setHover] = useState<{ at: number; element: Element } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const follow = useRef(onFollowLink);
  useEffect(() => {
    follow.current = onFollowLink;
  }, [onFollowLink]);

  useEffect(() => {
    if (editor === null) return;
    const element = editor.view.dom;
    const openMenu = (event: Event) => setMenu((event as CustomEvent<LinkMenuRequest>).detail);
    const openNote = (event: Event) => follow.current((event as CustomEvent<string>).detail);
    element.addEventListener(LINK_MENU_REQUEST, openMenu);
    element.addEventListener(FOLLOW_REQUEST, openNote);
    return () => {
      element.removeEventListener(LINK_MENU_REQUEST, openMenu);
      element.removeEventListener(FOLLOW_REQUEST, openNote);
    };
  }, [editor]);

  // A scrolled note moves its links from under a "…" drawn where they were.
  useEffect(() => {
    if (hover === null) return;
    const hide = () => setHover(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [hover]);

  useEffect(() => () => clearTimer(hideTimer), []);

  const keepHover = (inside: boolean) => {
    clearTimer(hideTimer);
    if (!inside) hideTimer.current = setTimeout(() => setHover(null), HOVER_GRACE_MS);
  };

  const handlers = {
    onMouseOver: (event: MouseEvent) => {
      const element = editor === null ? null : linkElementOf(editor, event.target);
      // A card carries its own "…"; only a link in the text needs one drawn.
      if (editor === null || !editor.isEditable || element === null) return;
      if (element.hasAttribute('data-bookmark')) return;
      const at = linkPositionOf(editor, element);
      if (at === null) return;
      clearTimer(hideTimer);
      setHover({ at, element });
    },
    onMouseOut: (event: MouseEvent) => {
      if (editor !== null && linkElementOf(editor, event.target) !== null) keepHover(false);
    },
    onContextMenu: (event: MouseEvent) => {
      const element = editor === null ? null : linkElementOf(editor, event.target);
      const at = editor === null || element === null ? null : linkPositionOf(editor, element);
      if (at === null || element === null || editor?.isEditable !== true) return;
      event.preventDefault();
      setMenu({ at, anchor: element });
    },
  };

  const close = () => {
    setMenu(null);
    // A note followed from the menu may have taken this editor away.
    if (editor !== null && !editor.isDestroyed) editor.commands.focus();
  };

  const overlay = (
    <>
      {hover !== null && menu === null && (
        <LinkHoverButton
          rect={hover.element.getBoundingClientRect()}
          onPointerInside={keepHover}
          // Hung from the link, not the button, which goes once the menu is up.
          onOpen={() => setMenu({ at: hover.at, anchor: hover.element })}
        />
      )}
      <LinkMenu
        anchor={menu?.anchor ?? null}
        items={editor === null || menu === null ? [] : linkCommands(editor, menu.at, onFollowLink)}
        onClose={close}
      />
    </>
  );
  return { handlers, overlay };
}

/** What a link's menu offers: open its note, and switch it the one way it can go. */
function linkCommands(
  editor: Editor,
  at: number,
  onFollowLink: (target: string) => void,
): MenuCommand[] {
  const node = editor.state.doc.nodeAt(at);
  if (node === null || !LINKS.has(node.type.name)) return [];
  const target = String(node.attrs['target'] ?? '');
  const open: MenuCommand = {
    label: 'Open note',
    movesFocus: true,
    onSelect: () => onFollowLink(target),
  };
  const switchTo = linkSwitchAt(editor, at);
  if (switchTo === 'bookmark') {
    return [open, { label: 'Show as bookmark', onSelect: () => showAsBookmark(editor, at) }];
  }
  if (switchTo === 'link') {
    return [open, { label: 'Show as link', onSelect: () => showAsLink(editor, at) }];
  }
  return [open];
}

function clearTimer(timer: { current: ReturnType<typeof setTimeout> | null }): void {
  if (timer.current !== null) clearTimeout(timer.current);
  timer.current = null;
}
