/** Longest branch name. Names become folders under `Branches/`, so they stay short. */
export const MAX_BRANCH_NAME_LENGTH = 100;

/** Letters, digits, dots, dashes, and underscores, starting and ending with a letter or digit. */
export const BRANCH_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

/**
 * The same rule for an HTML `pattern` attribute, which browsers compile with the `v` flag,
 * where a bare `-` in a class is an error. Anchors are implied.
 */
export const BRANCH_NAME_HTML_PATTERN = '[A-Za-z0-9](?:[A-Za-z0-9._\\-]{0,98}[A-Za-z0-9])?';

/** `main` is the product's word for the released line, so no branch can take it. */
const RESERVED_BRANCH_NAMES = ['main'];

/** What's wrong with a branch name, as a sentence without its final period, or null when it's fine. */
export function branchNameProblem(name: string): string | null {
  if (name.length === 0) return 'Enter a branch name';
  if (name.length > MAX_BRANCH_NAME_LENGTH) return `Use at most ${MAX_BRANCH_NAME_LENGTH} characters`;
  if (/\s/.test(name)) return 'Use dashes or underscores instead of spaces';
  if (/[^A-Za-z0-9._-]/.test(name)) return 'Use only letters, digits, dots, dashes, and underscores';
  if (!BRANCH_NAME_PATTERN.test(name)) return 'Start and end with a letter or digit';
  if (RESERVED_BRANCH_NAMES.includes(name.toLowerCase())) return `${name} is the released line. Pick another name`;
  return null;
}
