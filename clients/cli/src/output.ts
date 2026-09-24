import type { Context } from './context.js';
import { ApiError, CliError } from './errors.js';

/**
 * Human-readable text by default; with --json, exactly one JSON document on stdout.
 * Progress and prompts go to stderr so they never mix with results.
 */
export class Output {
  constructor(
    private readonly ctx: Context,
    readonly json: boolean,
  ) {}

  /** The command's result. `text` is shown to people; `data` is the --json document. */
  result(data: unknown, text: string | readonly string[]): void {
    if (this.json) {
      this.ctx.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    const lines = typeof text === 'string' ? [text] : text;
    if (lines.length > 0) this.ctx.stdout.write(`${lines.join('\n')}\n`);
  }

  /** Progress for people; silent with --json. */
  progress(message: string): void {
    if (!this.json) this.ctx.stderr.write(`${message}\n`);
  }

  /** Something the user must see even with --json (e.g. the sign-in code). */
  notice(message: string): void {
    this.ctx.stderr.write(`${message}\n`);
  }

  error(error: unknown): void {
    const normalized = normalizeError(error);
    if (this.json) {
      this.ctx.stderr.write(`${JSON.stringify({ error: normalized }, null, 2)}\n`);
      return;
    }
    const lines = [`error: ${normalized.message}`];
    const details = describeDetails(normalized.code, normalized.details);
    if (details) lines.push(...details.map((line) => `  ${line}`));
    if (normalized.hint) lines.push(`hint: ${normalized.hint}`);
    this.ctx.stderr.write(`${lines.join('\n')}\n`);
  }
}

export interface NormalizedError {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly hint?: string;
  readonly details?: unknown;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: error.message,
      ...(error instanceof ApiError ? { status: error.status } : {}),
      ...(error.hint ? { hint: error.hint } : {}),
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'internal', message };
}

/** Turns the API's structured error details into readable lines for the common cases. */
function describeDetails(code: string, details: unknown): string[] | undefined {
  if (details === undefined || details === null) return undefined;
  if (Array.isArray(details)) {
    return details.map((item) =>
      typeof item === 'object' && item !== null && 'message' in item
        ? `${'path' in item && item.path ? `${String(item.path)}: ` : ''}${String(item.message)}`
        : JSON.stringify(item),
    );
  }
  if (typeof details !== 'object') return [String(details)];
  const record = details as Record<string, unknown>;
  if (Array.isArray(record.paths)) return (record.paths as unknown[]).map(String);
  if (code === 'approval_required' && Array.isArray(record.blockers)) {
    return (record.blockers as { kind: string; have?: number; need?: number }[]).map(describeBlocker);
  }
  if (code === 'candidate_invalid' && Array.isArray(record.errors)) {
    return (record.errors as Record<string, unknown>[]).map((item) => JSON.stringify(item));
  }
  if (code === 'checked_out' || code === 'stale_head' || code === 'main_moved') return undefined;
  return [JSON.stringify(details)];
}

export function describeBlocker(blocker: { kind: string; have?: number | undefined; need?: number | undefined; eligible?: number | undefined }): string {
  switch (blocker.kind) {
    case 'needs_approvals':
      return `needs approvals: ${blocker.have ?? 0} of ${blocker.need ?? 0}`;
    case 'not_enough_eligible_approvers':
      return `not enough eligible approvers: ${blocker.eligible ?? 0} of ${blocker.need ?? 0}`;
    case 'rebuild_missing':
      return 'needs a rebuild report for the current candidate';
    case 'rebuild_stale':
      return 'the rebuild report is for an older candidate';
    case 'rebuild_failed':
      return 'the rebuild report failed';
    default:
      return blocker.kind;
  }
}

/** Left-aligned columns separated by two spaces. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)));
  const format = (row: readonly string[]) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ')
      .trimEnd();
  return [format(header), ...rows.map(format)];
}

export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : '-';
}

export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
