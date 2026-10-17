/** An error the user can act on. `code` is stable for scripts; `hint` says what to do next. */
export class CliError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(code: string, message: string, options: { hint?: string | undefined; details?: unknown } = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }
}

/** The API answered with an error body. */
export class ApiError extends CliError {
  readonly status: number;

  constructor(status: number, code: string, message: string, options: { hint?: string | undefined; details?: unknown } = {}) {
    super(code, message, options);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Next steps for API errors the CLI knows how to recover from. */
const API_HINTS: Readonly<Record<string, string>> = {
  unauthorized: 'Run `giga login` to sign in again.',
  stale_head: 'Someone committed to this branch since your last sync. Run `giga pull`, then commit again.',
  not_checked_out: 'Run `giga checkout` to take the branch before committing.',
  checked_out: 'Ask them to check it in, or have a maintainer force-release the lock on gigacad.site.',
  branch_not_open: 'Only open branches can be changed. A frozen branch unfreezes when its release request is closed.',
  main_moved: 'Run `giga rr candidate` to rebuild the candidate on the latest release.',
  approval_required: 'See what is missing with `giga rr show`.',
  stale_candidate: 'The candidate changed since you reviewed it. Look again with `giga rr show`, then retry.',
  no_changes: 'These picks leave main as it is. Change them with `giga rr picks`, or close the request with `giga rr close`.',
  release_request_finished: 'This release request is finished; nothing about it can change. See `giga rr list --all`.',
  candidate_invalid: 'Fix the pick errors shown by `giga rr diff`, then try again.',
  expired_token: 'Run `giga login` again to get a new code.',
};

export function hintFor(code: string): string | undefined {
  return API_HINTS[code];
}
