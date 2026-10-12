/**
 * Everyday English words (P29-06): what a misheard spelling must never be.
 * A term's variant is rewritten wherever it stands as a word, so `mark` as a
 * variant of `Marq` would rewrite every mark anyone ever made. The list is
 * short on purpose — the words a transcript is mostly made of — and is one
 * guard among several: a suggestion is also held to the names the vault
 * already has, and nothing is written until a person accepts it.
 */
const WORDS = `
a about above across act add after again against age ago agree all almost alone along already also
although always am among an and another answer any anyone anything are area around as ask at away
back bad be because become been before began begin behind being believe below best better between
big bit both bring build business but buy by call came can cannot care case change check clear close
come company could cut data date day days deal did different do does doing done down during each
early easy either else end enough even ever every everyone everything example fact far feel few
find first five follow for form found four friday from full further gave get give go goes going
gone good got great group had half hand hard has have he hear heard help her here high him his hold
home how however i idea if important in into is issue it its itself just keep kind knew know known
large last late later least leave left less let like line list little long look lot made main make
man many mark may maybe me mean meet meeting might mind minute monday month more morning most move
much must my name near need never new next nice no not note notes nothing now number of off often
ok okay old on once one only open or order other our out over own part people perhaps place plan
point possible put question quite rather read ready real really right run said same saturday saw
say see seem seen send sense set several shall she should show side since small so some someone
something soon sorry sort start still stop such sunday sure take talk team tell ten than thank
thanks that the their them then there these they thing things think this those though thought
three through thursday time to today together told tomorrow too took top toward try tuesday turn
two under understand until up update upon us use used very want was way we wednesday week well went
were what when where whether which while who whole whose why will with within without word work
would yeah year yes yesterday yet you your
january february march april june july august september october november december
call calls email emails file files flag item items page plan plans project report review ship
status step steps sync task tasks test tests ticket
`;

const COMMON = new Set(WORDS.split(/\s+/).filter((word) => word !== ''));

/** Whether a word is an everyday one, in any case. */
export function isCommonWord(word: string): boolean {
  return COMMON.has(word.toLowerCase());
}
