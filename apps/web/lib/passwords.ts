/**
 * Passwords that guessing tools try first. Auth enforces the length; this catches the obvious
 * ones before they're sent. (Hosted Supabase can also refuse leaked passwords.)
 */
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '11111111',
  '00000000',
  '12341234',
  '11223344',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'qwertyui',
  'qwerty123',
  'qwertyuiop',
  'asdfghjk',
  'iloveyou',
  'abcd1234',
  '1q2w3e4r',
  'letmein1',
  'welcome1',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'trustno1',
  'gigacad1',
  'gigacad123',
  'solidworks',
]);

/** Why a new password is too easy to guess, or null when it's fine to send. */
export function commonPasswordProblem(password: string): string | null {
  const plain = password.toLowerCase();
  if (COMMON.has(plain) || /^(.)\1+$/.test(password)) return 'That password is one of the first ones people guess. Choose another.';
  return null;
}
