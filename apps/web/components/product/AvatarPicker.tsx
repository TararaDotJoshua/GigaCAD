'use client';

import { startTransition, useActionState, useState } from 'react';
import { uploadAvatar, type ActionState } from '../../app/(product)/actions';
import { safeAction } from '../../lib/safe-action';
import { FormStatus } from './ActionButton';

const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 1024 * 1024;
/** Avatars show at most 240px wide; twice that stays sharp on dense screens. */
const SIDE = 512;

/**
 * Prepares a chosen image for upload: checks that it opens, and turns anything large (a
 * phone photo, say) into a 512px square, so it fits the 1 MB limit and loads quickly.
 */
async function prepare(file: File): Promise<File | string> {
  if (!TYPES.has(file.type)) return 'Upload a PNG, JPEG, or WebP image.';
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    return 'That image can’t be opened. It may be damaged; try another.';
  }
  try {
    if (file.size <= MAX_BYTES && image.width <= SIDE * 2 && image.height <= SIDE * 2) return file;
    const side = Math.min(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(SIDE, side);
    const context = canvas.getContext('2d')!;
    // JPEG has no transparency; a transparent PNG gets a white background instead of black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob || blob.size > MAX_BYTES) return 'Upload an image of 1 MB or less.';
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
  } finally {
    image.close();
  }
}

/** One step: choosing an image uploads it. */
export function AvatarPicker({ hasAvatar }: { hasAvatar: boolean }) {
  // A failed request (offline, say) shows here instead of replacing Settings with the error page.
  const [state, action, pending] = useActionState((previous: ActionState, data: FormData) => safeAction(() => uploadAvatar(previous, data)), {});
  const [problem, setProblem] = useState<ActionState | null>(null);
  const [preparing, setPreparing] = useState(false);
  const busy = pending || preparing;

  async function choose(input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared either way, so choosing the same file again still counts as a change.
    input.value = '';
    if (!file) return;
    setPreparing(true);
    const ready = await prepare(file);
    setPreparing(false);
    if (typeof ready === 'string') return setProblem({ error: ready });
    setProblem(null);
    const form = new FormData();
    form.set('avatar', ready);
    startTransition(() => action(form));
  }

  return (
    <div className="avatar-picker">
      <label className={`btn btn-secondary${busy ? ' is-disabled' : ''}`}>
        {busy ? 'Uploading…' : hasAvatar ? 'Choose a new image…' : 'Choose an image…'}
        <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(event) => void choose(event.target)} />
      </label>
      <small className="field-hint">A PNG, JPEG, or WebP. Large images are cropped to a square and made smaller.</small>
      <FormStatus state={problem ?? state} />
    </div>
  );
}
