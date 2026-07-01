/**
 * Detects when a copilot query is written in Somali, so the assistant can
 * reply correctly in Somali even when the UI's selected language is still
 * English/Arabic (a first-time store owner who hasn't touched the language
 * switcher yet should still get a correct Somali answer when they type in
 * Somali).
 */
const SOMALI_MARKERS = [
  'maanta', 'immisa', 'sideen', 'sidee', 'macmiil', 'macaamiisha', 'macaamiil',
  'deyn', 'deynta', 'lacag', 'lacagta', "faa'iido", "faa'iidada", 'faaiido',
  'khasaaraha', 'khasaare', 'kharashka', 'kharashaadka', 'kharash', 'alaabta',
  'alaab', 'baayacmushtar', 'iibsaday', 'iibiyay', 'iibka', 'iibsi', 'warbixin',
  'warbixinta', 'sanduuqa', 'kaydka', 'baakhad', 'qiimaha', 'ganacsi',
  'ganacsiga', 'dukaan', 'dukaanka', 'bixiyay', 'helay', 'maxaa', 'waxaan',
  'waxay', 'sicir', 'khayraad', 'ayaa', 'macmiilka', 'alaabooyinka',
  'shirkadda', 'bakhaarka', 'bakhaar', 'wax', 'lagu', 'ku', 'oo', 'iyo',
  'tahay', 'kuma', 'badan', 'yar', 'guud', 'todobaad', 'bisha', 'bilka',
  'caafimaad', 'saami', 'macaash', 'faafinta', 'liiska', 'liis',
];

const SOMALI_REGEX = new RegExp(`\\b(${SOMALI_MARKERS.join('|')})\\b`, 'i');

/** Returns true if the text looks like Somali based on common business vocabulary. */
export function isSomaliQuery(text: string): boolean {
  return SOMALI_REGEX.test(text);
}
