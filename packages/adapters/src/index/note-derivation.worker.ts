import { remarkMarkdown } from '../markdown/markdown-port.ts';
import {
  serveNoteDerivation,
  type DerivationAnswer,
  type DerivationRequest,
} from './worker-note-deriver.ts';

/**
 * The worker the index's notes are read in (#135): the markdown reader and
 * the rules of the index, on a thread that is not the window's. It is given
 * note text and answers with rows; it touches no file and no host.
 */
const serve = serveNoteDerivation({
  markdown: remarkMarkdown,
  answer: (answer: DerivationAnswer) => postMessage(answer),
});

addEventListener('message', (event: MessageEvent<DerivationRequest>) => serve(event.data));
