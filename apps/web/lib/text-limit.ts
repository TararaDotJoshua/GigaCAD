/** Characters as the API and database count them: code points, so an emoji isn't counted twice for its UTF-16 halves. */
export const characterCount = (value: string) => [...value].length;

/** The longest start of `text`, in whole characters as people see them, that fits in `room` code points. */
function fitGraphemes(text: string, room: number): string {
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (characterCount(out + segment) > room) break;
    out += segment;
  }
  return out;
}

/**
 * Applies a text edit within a limit. Only the inserted text is cut, never what was already
 * there, so typing or pasting in the middle of a full field doesn't eat its end. Returns the
 * new value and where the caret goes when the edit was cut.
 */
export function limitEdit(before: string, after: string, max: number): { value: string; caret: number | null } {
  if (characterCount(after) <= max) return { value: after, caret: null };
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const kept = before.slice(0, start) + before.slice(before.length - end);
  const inserted = fitGraphemes(after.slice(start, after.length - end), Math.max(0, max - characterCount(kept)));
  return { value: before.slice(0, start) + inserted + before.slice(before.length - end), caret: start + inserted.length };
}
