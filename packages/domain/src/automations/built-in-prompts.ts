/**
 * The prompt notes Atlas ships (P29-05, #179): what a ready-made rule's Claude step
 * is asked. A prompt is a note in `.atlas/prompts/`, the person's to edit, so
 * Atlas writes one only where there is none — when a rule that names it is
 * saved — and never over one that is there.
 *
 * The rules a prompt gives are words to a model. What an answer may do is
 * held by its output's schema whatever the prompt says.
 */

import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { PROMPTS_DIRECTORY } from './claude-step.ts';

export interface BuiltInPrompt {
  readonly path: VaultPath;
  /** The note as written: a heading for whoever opens it, then what Claude is asked. */
  readonly contents: string;
}

/** The prompt of the `meeting-items` output: what to pull out of a meeting, and how sure to be. */
export const MEETING_EXTRACTION_PROMPT = createVaultPath(
  `${PROMPTS_DIRECTORY}/meeting-extraction.md`,
);

const MEETING_EXTRACTION = `# Meeting extraction

Read the meeting's transcript and pull out what somebody now has to do, what was
decided, and what should be chased later. Each item becomes a proposal the
vault's owner accepts or rejects, so leave out anything they would reject.

This note is yours to edit: it is what a rule with \`output: meeting-items\` asks
Claude. Atlas adds who was in the meeting, the provider's own next steps and the
vocabulary as data beside the meeting, and checks every answer itself.

## What to pull out

- **task** — something a person said they will do, or was asked to do and agreed to.
- **waiting** — the same, when it is somebody else's to do and the owner is waiting
  on it. Atlas decides "mine" or "waiting for" from the owner you name, so name
  the owner with care.
- **decision** — something the meeting settled: a choice made, not a topic discussed.
- **follow-up** — something the owner should chase or check later that nobody took
  on: a question left open, a "let's come back to this".

## Rules

1. **Only real commitments.** Someone must have said they will do it, or agreed
   when asked. An idea, a wish, a "we should", a description of work already
   done, or small talk is not an item. When in doubt, leave it out.
2. **Mine and others'.** The vault's owner is written **You** in the transcript.
   For what the owner took on, write "owner": "You". For anyone else, write their
   name exactly as the attendee list gives it.
3. **Do not guess a person.** A speaker written Unknown, Remote Speaker or
   Speaker 2 was not named by the provider. If nothing else in the transcript
   makes plain who it is, write "owner": "" and "confidence": "low". If you do
   name someone on the strength of other turns, the confidence is still "low".
4. **Cite one turn.** "source_block" is the id of the single turn where the
   commitment was made or the decision settled — the turn of the person taking
   it on, not the question before it.
5. **The provider's next steps are hints, not a source.** Use them to notice
   what the meeting produced. Keep one only if a turn you were shown says it,
   and cite that turn; otherwise leave it out. Where a hint and the transcript
   disagree about who or what, the transcript wins.
6. **Titles stand alone.** A few words, starting with a verb for a task
   ("Send the renewal contract"), naming what and for whom, so it makes sense
   in a task list without the meeting. Spell names and products as the
   vocabulary does.
7. **A due date only when one was said.** Work it out from the meeting's date
   ("by Friday") and write it as YYYY-MM-DD. If no date or day was said, leave
   "due" out.
8. **Confidence means how sure you are it is real and whose it is.**
   "high": said plainly by a named speaker, and the owner is certain.
   "medium": clear what, some doubt about who or whether it was agreed.
   "low": inferred, or the owner is a guess, or the speaker was not named.
9. **One item per commitment.** No duplicates, and nothing a turn you were shown
   does not say. When you are shown one part of a long transcript, answer for
   that part alone.
10. **Nothing to pull out is an answer.** A meeting with no commitments and no
    decisions gets an empty list.
`;

/**
 * The prompt of the "After a meeting" rule (#179, ADR-0036): the action items
 * and who owns each. Its rule may make the owner's own into tasks, so the
 * rules about who owns an item are stricter than extraction's; who the owner
 * is, and so what becomes a task, Atlas still decides from the cited turn.
 */
export const AFTER_A_MEETING_PROMPT = createVaultPath(`${PROMPTS_DIRECTORY}/after-a-meeting.md`);

const AFTER_A_MEETING = `# After a meeting

Read the meeting's transcript and list what somebody now has to do, what was
decided, and what should be chased later, each with the one person who owns it.
The vault's owner may have their own items made into tasks without a click, so
who owns an item matters more than anything else you write.

This note is yours to edit: it is what the "After a meeting" rule asks Claude.
Atlas adds who was in the meeting, the provider's own next steps and the
vocabulary as data beside the meeting, and checks every answer itself.
Atlas decides who an item belongs to from the turn you cite and the owner you
name; you never decide what becomes a task.

## What to list

- **task** — something a person said they will do, or was asked to do and agreed to.
- **waiting** — the same, when it is somebody else's to do and the owner is
  waiting on it.
- **decision** — something the meeting settled: a choice made, not a topic discussed.
- **follow-up** — something that should be chased or checked later that nobody
  took on: a question left open, a "let's come back to this".

## Who owns an item

1. **Cite the turn of the person who takes it on.** "source_block" is the id of
   the single turn where they said they will do it, or agreed when asked: their
   own words, not the question before them. Atlas reads the owner from that
   turn's speaker, so a turn spoken by someone else makes the item a proposal.
2. **Name the owner as the transcript does.** The vault's owner is
   written **You** in the transcript: for what they took on, write "owner":
   "You". For anyone else, write their name exactly as the attendee list gives it.
3. **One owner per item.** "You and Tobias Fenn", "the team" or two names is not
   an owner: if two people each took a part, list two items, each citing its own
   turn. If it cannot be split, write "owner": "" and "confidence": "low".
4. **"we" is nobody in particular.** "We should send it" or "we'll look at it"
   names no owner unless a later turn says who: write "owner": "" and
   "confidence": "low".
5. **Do not guess a person.** A speaker written Unknown, Remote Speaker or
   Speaker 2 was not named by the provider. If nothing else in the transcript
   makes plain who it is, write "owner": "" and "confidence": "low". If you name
   someone on the strength of other turns, the confidence is still "low".
6. **Confidence means how sure you are it is real and whose it is.**
   "high": said plainly by the named speaker who owns it.
   "medium": clear what, some doubt about who or whether it was agreed.
   "low": inferred, or the owner is a guess, or the speaker was not named.

## What each item says

7. **Only real commitments.** An idea, a wish, a "we should", work already done
   or small talk is not an item. When in doubt, leave it out.
8. **Titles stand alone.** A few words, starting with a verb for a task ("Send
   the renewal contract"), naming what and for whom, so it makes sense in a task
   list without the meeting. Spell names and products as the vocabulary does.
9. **A due date only when one was said.** Work it out from the meeting's date
   ("by Friday") and write it as YYYY-MM-DD. If no date or day was said, leave
   "due" out.
10. **The provider's next steps are hints, not a source.** Keep one only if a turn
    you were shown says it, and cite that turn. Where a hint and the transcript
    disagree about who or what, the transcript wins.
11. **One item per commitment, and nothing a turn you were shown does not say.**
    When you are shown one part of a long transcript, answer for that part alone.
    A meeting with no commitments and no decisions gets an empty list.
`;

export const BUILT_IN_PROMPTS: readonly BuiltInPrompt[] = [
  { path: MEETING_EXTRACTION_PROMPT, contents: MEETING_EXTRACTION },
  { path: AFTER_A_MEETING_PROMPT, contents: AFTER_A_MEETING },
];

/** The prompt Atlas ships at `path`, or null when it ships none there. */
export function builtInPromptAt(path: string): BuiltInPrompt | null {
  return BUILT_IN_PROMPTS.find((prompt) => prompt.path === path) ?? null;
}
