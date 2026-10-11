---
type: adr
id: ADR-0033
title: The global capture shortcut is registered by the host and only says it was pressed
status: proposed
date: 2026-10-10
---

# ADR-0033 — The global capture shortcut is registered by the host and only says it was pressed

## Context

#81 asks for quick capture from any app: one system-wide key that brings Atlas
forward with capture open, landing in `Inbox/` (P30-01). A key that works while
another app has the keyboard is not something a webview can listen for; it has
to be registered with macOS. Tauri's way is `tauri-plugin-global-shortcut`,
which wraps `global-hotkey` (Carbon `RegisterEventHotKey` on macOS).

The plugin ships JavaScript commands (`register`, `unregister`, …) that a
webview can call once a capability grants them. The webview is the untrusted
side (ADR-0017): anything that can run script in it — a synced note's content
going wrong, an artifact escaping its frame — could then register any key on
the Mac, a bare `A` included, and take it from every other app.

## Decision

**The host registers the shortcut and does nothing else with it.** The plugin is
added from Rust (`global_capture.rs`) and **no capability grants its commands**,
so the webview cannot call them. When the shortcut is pressed the host brings
the main window forward and emits `global-capture`, with no payload. What
happens next — capture opening, or "Quick capture needs a vault" when none is
open — is the webview's, as everything the person sees is.

**The webview chooses the shortcut; the host vets it.** Two commands cross the
boundary: `global_capture_status` and `global_capture_set(shortcut | null)`. The
default, ⌃⌥N (`Control+Alt+KeyN`), and what counts as a shortcut live in the
domain (`globalShortcutFromKeys`): it must hold **two** of ⌘, ⌥ and ⌃ (Shift
does not count), since a hot key reaches Atlas before any other app and one
modifier alone is how every app copies (⌘C), quits (⌘Q) and types (⌥E is é);
macOS's own two-modifier shortcuts (⌃⌘Q Lock Screen, ⌃⌘Space emoji, ⌥⌘Esc
Force Quit, ⌃⌘F full screen, ⌥⌘Space, ⌥⌘D) are refused too, and so are F21–F24,
which have no key code on a Mac. The host re-parses what it is handed and
applies the same rule — the backstop for an untrusted caller, the ADR-0014
nuance of obeying a rule rather than having one. The new shortcut is registered
before the old one is let go: one macOS refuses is kept as the choice and
reported as not working, and the old one keeps working meanwhile.

**The choice is per Mac, kept in the webview's `localStorage`**, and handed to
the host as the app starts. Which keys are free depends on what else runs on
that Mac, and the shortcut must work with no vault open, so it is not a vault
setting and does not sync.

**Bringing the window forward** is: unminimise, show, join every Space, activate
the app and focus the window, leave every Space again. Joining every Space for
that moment is what moves the window to the Space being looked at, rather than
sending the person to the Space it was left on.

**The plugin is pinned to 2.3** (`~2.3.1`): 2.4 needs Tauri 2.12, and this
change adds a plugin without moving Tauri. Moving to 2.4 comes with the next
Tauri upgrade.

## Consequences

- A new Rust dependency (`tauri-plugin-global-shortcut` 2.3.2, and under it
  `global-hotkey` 0.8). Adding it needs a stop and rerun of `pnpm tauri:dev`; no
  npm package is added, since the webview never calls the plugin.
- The shortcut works only while Atlas is running. Closing the window quits the
  app, so there is no hidden-window case to handle.
- While a palette or dialog holds the screen (Settings, search), a press brings
  the window forward and opens nothing over it — the same rule as ⇧⌘N inside
  the app.
- Registration is not exclusive: macOS may let two apps register the same
  shortcut, and a shortcut macOS itself uses may reach macOS first. Atlas
  cannot always tell either case — "not working" appears only when macOS
  refuses outright — and the guide says so.
- Raising the window, activation and Spaces are checked by hand (the manual
  steps in #81's PR): the order is unit-tested against a fake window, but no
  test here can drive a real macOS Space.
