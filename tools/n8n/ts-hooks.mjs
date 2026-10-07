// Lets plain `node` run this repo's TypeScript, including the domain, whose
// parameter properties Node's own type stripping refuses. Each .ts file is
// transpiled (types erased, nothing checked) as it is loaded.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TYPESCRIPT = /\.tsx?$/;

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !TYPESCRIPT.test(url) || url.includes('/node_modules/')) {
      return nextLoad(url, context);
    }
    const fileName = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
        jsx: ts.JsxEmit.ReactJSX,
        verbatimModuleSyntax: true,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
