import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { fieldFor, messageFor, sentence } from './messages';
import { pendingText } from './pending';
import { failedRequestMessage } from './safe-action';

const invalid = (path: string, message: string) => new ApiError(400, 'invalid_request', 'The request is invalid', [{ path, message }]);

describe('error messages', () => {
  it('turns validator text into field copy and names the field', () => {
    expect(messageFor(invalid('name', 'Too small: expected string to have >=1 characters'))).toBe('Enter a name.');
    expect(messageFor(invalid('title', 'Too big: expected string to have <=200 characters'))).toBe('Shorten the title.');
    expect(fieldFor(invalid('slug', 'Use lowercase letters, digits, dots, dashes, or underscores'))).toBe('slug');
    expect(messageFor(invalid('slug', 'Use lowercase letters, digits, dots, dashes, or underscores'))).toBe('Use lowercase letters, digits, dots, dashes, or underscores.');
  });

  it('words known codes for people and always ends with a full stop', () => {
    expect(messageFor(new ApiError(404, 'not_found', 'User not found'))).toBe('That no longer exists. Refresh the page to see where things are now.');
    expect(messageFor(new ApiError(400, 'owner_role_fixed', "The project owner's role can't be changed"))).toBe('The project owner’s role can’t be changed.');
    expect(messageFor(new ApiError(409, 'name_taken', '"a.txt" already exists in this folder', { name: 'a.txt' }))).toBe('There’s already something named a.txt in this folder.');
    expect(messageFor(new ApiError(409, 'some_new_code', 'Something new happened'))).toBe('Something new happened.');
    expect(sentence('Done!')).toBe('Done!');
  });

  it('says offline when the browser is', () => {
    expect(failedRequestMessage(false)).toBe('You’re offline. Reconnect, then try again.');
    expect(failedRequestMessage(true)).toMatch(/didn’t go through/);
  });
});

describe('pending labels', () => {
  it('come from the button’s verb', () => {
    expect(pendingText('Create branch')).toBe('Creating…');
    expect(pendingText('Save approval rules')).toBe('Saving…');
    expect(pendingText('Force-release lock')).toBe('Releasing…');
    expect(pendingText('Sign out')).toBe('Signing out…');
    expect(pendingText('Frobnicate')).toBe('Working…');
  });
});
