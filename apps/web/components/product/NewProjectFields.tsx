'use client';

import { useState } from 'react';

/** Name and address fields; the address follows the name until you edit it. */
export function NewProjectFields({ owner }: { owner: string }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [edited, setEdited] = useState(false);
  const derived = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
  const value = edited ? slug : derived;
  return (
    <>
      <label className="field">
        <span>Name</span>
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required autoFocus />
      </label>
      <label className="field">
        <span>Address</span>
        <span className="field-prefixed">
          <span className="mono muted">{owner}/</span>
          <input
            name="slug"
            className="mono"
            value={value}
            onChange={(event) => {
              setEdited(true);
              setSlug(event.target.value.toLowerCase());
            }}
            pattern="[a-z0-9](?:[a-z0-9._\-]{0,98}[a-z0-9])?"
            title="Lowercase letters, digits, dots, dashes, or underscores"
            spellCheck={false}
            required
          />
        </span>
      </label>
    </>
  );
}
