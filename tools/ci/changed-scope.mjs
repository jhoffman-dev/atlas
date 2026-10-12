#!/usr/bin/env node
// Tells the gate what a change needs: reads changed paths, one per line, on
// stdin and prints `code=true` or `code=false` for $GITHUB_OUTPUT. The rule is
// in docs-only.ts; this only reads and prints.
import { text } from 'node:stream/consumers';
import { isDocsOnlyChange } from './docs-only.ts';

const changedPaths = (await text(process.stdin)).split('\n').filter((path) => path !== '');
console.log(`code=${!isDocsOnlyChange(changedPaths)}`);
