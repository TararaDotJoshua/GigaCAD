import { describe, expect, it } from 'vitest';
import { commonPasswordProblem } from './passwords';

describe('common passwords', () => {
  it('turns away the ones guessed first, in any case', () => {
    for (const password of ['12345678', 'Password', 'PASSWORD123', 'aaaaaaaaa']) expect(commonPasswordProblem(password)).not.toBeNull();
  });

  it('lets ordinary passwords through', () => {
    for (const password of ['correct horse battery', 'Gr1pper-v2!', '12345679x']) expect(commonPasswordProblem(password)).toBeNull();
  });
});
