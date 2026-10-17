import { notFound } from 'next/navigation';

export const metadata = { title: 'Not found' };

/** A mistyped address inside a project, like /owner/project/settngs: the project's own 404, in the shell. */
export default function UnknownProjectPage(): never {
  notFound();
}
