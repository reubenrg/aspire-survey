/**
 * Pins the shared error-translation module every admin store now delegates
 * to, replacing 12 near-identical local copies. Covers the stable `.code`
 * mapping (so a UI can branch on it, not just display `.message`), the
 * per-call-site override mechanism stores use for a code whose meaning is
 * context-specific, the NotAuthorised subclass several pages already check
 * with `instanceof` for a dedicated "access denied" screen, and the
 * RPC-payload variant for the `{error: 'some_code'}` JSON-result pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, NotAuthorised, permissionDenied, toDomainError, rpcErrorFrom } from '../Aspire-Survey/src/admin/domainError.ts';

test('a 42501 becomes a NotAuthorised with the standard wording', () => {
  const err = toDomainError({ code: '42501', message: 'permission denied' }, 'edit this survey');
  assert.ok(err instanceof NotAuthorised);
  assert.equal(err.code, 'FORBIDDEN');
  assert.equal(err.message, 'You do not have permission to edit this survey.');
});

test('a 23505 becomes a CONFLICT with a generic message by default', () => {
  const err = toDomainError({ code: '23505', message: 'duplicate key' }, 'add this row');
  assert.equal(err.code, 'CONFLICT');
  assert.match(err.message, /already exists/);
});

test('an override for a specific Postgres code replaces the generic message, keeping the right domain code', () => {
  const err = toDomainError(
    { code: '23505', message: 'duplicate key value violates unique constraint "employees_code_key"' },
    'add this employee',
    { '23505': 'An employee with this code already exists in this workspace.' },
  );
  assert.equal(err.code, 'CONFLICT');
  assert.equal(err.message, 'An employee with this code already exists in this workspace.');
  // The raw constraint name never reaches the message.
  assert.doesNotMatch(err.message, /employees_code_key/);
});

test('23502 and 23514 both map to VALIDATION_ERROR', () => {
  assert.equal(toDomainError({ code: '23502', message: 'x' }, 'save this').code, 'VALIDATION_ERROR');
  assert.equal(toDomainError({ code: '23514', message: 'x' }, 'save this').code, 'VALIDATION_ERROR');
});

test('an unrecognised Postgres code falls back to the raw message rather than hiding it', () => {
  const err = toDomainError({ code: '55555', message: 'some other Postgres condition' }, 'do this');
  assert.equal(err.code, 'UNKNOWN');
  assert.equal(err.message, 'some other Postgres condition');
});

test('a missing message and an unrecognised code falls back to the action phrase, never a blank message', () => {
  const err = toDomainError({ code: undefined, message: '' }, 'do this');
  assert.equal(err.message, 'Could not do this.');
});

test('permissionDenied() produces the exact same shape toDomainError uses for 42501', () => {
  const a = permissionDenied('view this report');
  const b = toDomainError({ code: '42501', message: 'x' }, 'view this report');
  assert.equal(a.message, b.message);
  assert.equal(a.code, b.code);
  assert.ok(a instanceof NotAuthorised);
});

test('rpcErrorFrom returns null when the payload carries no error key, so a call site can trust a plain success', () => {
  assert.equal(rpcErrorFrom(undefined, {}), null);
  assert.equal(rpcErrorFrom(null, {}), null);
});

test('rpcErrorFrom maps not_authorised to a NotAuthorised instance with the supplied wording', () => {
  const err = rpcErrorFrom('not_authorised', { not_authorised: 'You need the analyst role or higher to see this.' });
  assert.ok(err instanceof NotAuthorised);
  assert.equal(err?.message, 'You need the analyst role or higher to see this.');
});

test('rpcErrorFrom falls back to a safe generic message for a key the caller did not name', () => {
  const err = rpcErrorFrom('some_unexpected_code', {});
  assert.ok(err instanceof DomainError);
  assert.equal(err?.code, 'UNKNOWN');
  assert.match(err!.message, /some_unexpected_code/);
});
