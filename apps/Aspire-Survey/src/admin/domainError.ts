/**
 * One place to turn a raw PostgREST/Postgres error - or an RPC's own
 * {error: 'some_code'} JSON payload - into a message an admin screen can
 * show directly. Never leaks a SQL error, a table/column name, or a bare
 * Postgres code; every store previously reimplemented this translation
 * itself (12 near-identical copies), with the underlying meaning
 * (forbidden vs. not found vs. a duplicate vs. a bad value) never named
 * anywhere - `.code` on the results here is that stable, machine-checkable
 * name, alongside the same human-readable `.message` every call site
 * already expected.
 */

export type DomainErrorCode =
  | 'FORBIDDEN' | 'NOT_FOUND' | 'INVALID_STATE' | 'VALIDATION_ERROR' | 'CONFLICT' | 'UNKNOWN';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'DomainError';
  }
}

/**
 * Its own subclass, not just `DomainError` with code FORBIDDEN: several
 * pages already do `e instanceof NotAuthorised` to show a dedicated
 * "you don't have access to this" screen instead of a generic error
 * banner, and that check needs to keep working unchanged.
 */
export class NotAuthorised extends DomainError {
  constructor(message: string) {
    super('FORBIDDEN', message);
    this.name = 'NotAuthorised';
  }
}

/** The wording every existing 42501 / not_authorised translation already used. */
export function permissionDenied(action: string): NotAuthorised {
  return new NotAuthorised(`You do not have permission to ${action}.`);
}

interface PostgrestLikeError {
  code?: string;
  message: string;
}

/**
 * Translates a raw Supabase/PostgREST error into a DomainError.
 *
 * `overrides` lets one call site give a Postgres code a meaning specific to
 * what it was doing (e.g. a 23505 on `employees` is "this employee code
 * already exists"; on `survey_members` it's "already a team member") without
 * every store reimplementing the whole switch. Keyed by Postgres error code.
 */
export function toDomainError(
  error: PostgrestLikeError,
  action: string,
  overrides: Partial<Record<string, string>> = {},
): DomainError {
  const code = error.code;
  if (code && overrides[code]) {
    return new DomainError(codeForPg(code), overrides[code]!);
  }

  switch (code) {
    case '42501':
      return permissionDenied(action);
    case '23505':
      return new DomainError('CONFLICT', `Could not ${action}: that already exists.`);
    case '23502':
    case '23514':
      return new DomainError('VALIDATION_ERROR', `Could not ${action}: a required value is missing or invalid.`);
    case '23503':
      return new DomainError('VALIDATION_ERROR', `Could not ${action}: this refers to something that no longer exists.`);
    case 'PGRST301':
    case '401':
      return new DomainError('UNKNOWN', 'Your sign-in has expired. Reload the page to sign in again.');
    case 'PGRST205':
      return new DomainError('UNKNOWN', 'That table is not available yet. Its setup SQL may not have been run.');
    default:
      return new DomainError('UNKNOWN', error.message || `Could not ${action}.`);
  }
}

function codeForPg(pgCode: string): DomainErrorCode {
  if (pgCode === '42501') return 'FORBIDDEN';
  if (pgCode === '23505') return 'CONFLICT';
  if (pgCode === '23502' || pgCode === '23514' || pgCode === '23503') return 'VALIDATION_ERROR';
  return 'UNKNOWN';
}

/**
 * For the RPCs in this codebase that return `{error: 'not_authorised'}` /
 * `{error: 'no_table'}` / etc. as part of a successful JSON response rather
 * than throwing a Postgres error. `messages` supplies the exact wording for
 * whichever of those keys a given call site cares about; a key present in
 * the payload but missing from `messages` still gets a safe, generic
 * fallback rather than silently passing through unhandled. Returns null
 * when the payload carries no error at all, so a call site can
 * `const err = rpcErrorFrom(payload.error, {...}); if (err) throw err;`.
 */
export function rpcErrorFrom(
  errorKey: string | undefined | null,
  messages: Partial<Record<string, string>>,
): DomainError | null {
  if (!errorKey) return null;
  const message = messages[errorKey] ?? `This couldn't be completed (${errorKey}).`;
  if (errorKey === 'not_authorised') return new NotAuthorised(message);
  if (errorKey === 'not_found') return new DomainError('NOT_FOUND', message);
  return new DomainError('UNKNOWN', message);
}
