---
type: adr
id: ADR-0001
title: TypeScript pinned to 6.x until typescript-eslint supports TS 7
status: accepted
date: 2026-09-20
---

# ADR-0001 — TypeScript pinned to 6.x

## Context

TypeScript 7.0 (the native compiler) installs by default as `typescript@latest`, and it
typechecks this repo correctly. But `typescript-eslint@8.70` refuses to load against the
TS 7 API and aborts the whole lint run:

```
Error: typescript-eslint does not support TS 7.0.
```

Lint is part of the merge gate. A gate that cannot run is not a gate.

## Decision

Pin the root `typescript` devDependency to `^6.0.3`. Revisit when typescript-eslint
ships TS 7 support (tracked upstream in typescript-eslint#10940).

## Consequences

- Slower typechecks than the native compiler would give. At this repo size, irrelevant.
- `tsconfig.json` already uses relative `paths` entries with no `baseUrl`, which TS 7
  requires and TS 6 accepts, so the upgrade will not need config changes.
- Two smaller pins ride along for the same reason — ESLint 10 breaks
  `eslint-plugin-react`'s React version _detection_, so the version is stated
  explicitly in `eslint.config.js` rather than detected.
