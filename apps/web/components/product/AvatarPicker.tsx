'use client';

import { useActionState, useRef } from 'react';
import { uploadAvatar } from '../../app/(product)/actions';
import { FormStatus } from './ActionButton';

/** One step: choosing an image uploads it. */
export function AvatarPicker({ hasAvatar }: { hasAvatar: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(uploadAvatar, {});
  return (
    <form ref={form} action={action} className="avatar-picker">
      <label className={`btn btn-secondary${pending ? ' is-disabled' : ''}`}>
        {pending ? 'Uploading…' : hasAvatar ? 'Choose a new image…' : 'Choose an image…'}
        <input
          name="avatar"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={pending}
          onChange={(event) => event.target.files?.length && form.current?.requestSubmit()}
        />
      </label>
      <small className="field-hint">A square PNG, JPEG, or WebP of 1 MB or less.</small>
      <FormStatus state={state} />
    </form>
  );
}
