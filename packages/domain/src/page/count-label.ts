/** Nouns English does not pluralise by rule, among the names a type is likely to have. */
const IRREGULAR: Readonly<Record<string, string>> = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
};

/**
 * A type's name as a plural noun, lower case: "Task" is "tasks", "Company" is
 * "companies". English by rule, which is right for the names types are given;
 * an odd one reads a little off rather than wrong.
 */
export function pluralNoun(noun: string): string {
  const word = noun.trim().toLowerCase();
  if (word === '') return 'notes';
  const irregular = IRREGULAR[word];
  if (irregular !== undefined) return irregular;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/** How many notes a view holds, in its type's words: "177 tasks", "1 task". */
export function countLabel({ count, noun }: { count: number; noun: string }): string {
  const word = noun.trim().toLowerCase();
  if (count !== 1) return `${count} ${pluralNoun(noun)}`;
  return `1 ${word === '' ? 'note' : word}`;
}

/** The command that adds a note of a type: "New task". */
export function newNoteLabel(noun: string): string {
  const word = noun.trim().toLowerCase();
  return word === '' ? 'New note' : `New ${word}`;
}
