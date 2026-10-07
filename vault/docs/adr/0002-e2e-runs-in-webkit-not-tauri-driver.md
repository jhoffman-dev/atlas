---
type: adr
id: ADR-0002
title: End-to-end tests drive WebKit directly, not the Tauri window
status: accepted
date: 2026-09-20
---

# ADR-0002 — End-to-end tests drive WebKit, not the Tauri window

## Context

The testing bar asks for an end-to-end smoke test of the core loop on every merge.
The obvious way to test a Tauri app is `tauri-driver`, which speaks WebDriver to the
real window. It supports Linux and Windows. It does not support macOS, because
Apple ships no WebKitWebDriver for WKWebView, and this is a macOS-first app.

## Decision

Run the end-to-end tests in Playwright against **WebKit** — the same engine the
Tauri window embeds on macOS — loading the real production bundle from `vite preview`.
A stand-in host (`e2e/host.ts`) answers the same four IPC commands against a real
temporary directory on disk.

The Rust half is covered by its own tests in `apps/desktop/src-tauri`, which exercise
the real filesystem, including the traversal and symlink guards.

## Consequences

- The core loop is covered in a real browser engine against real files, and it runs
  in CI on every merge.
- The seam between TypeScript and Rust — command names and argument shapes — is the
  one thing neither suite covers. A rename on one side and not the other would pass
  both. Changes to the command surface are checked by running the app.
- If Tauri ever gains macOS WebDriver support, these tests port over largely intact:
  the assertions are written against roles and visible text, not internals.
