import { expect, test, vi } from 'vitest';

import { LocalNetworkBlockedError } from '#lib/platform/local-network.js';
import { CoreError } from '#src/transport';

import { authenticationError, logAuthenticationFailure } from './registration-errors';

test('explains unsupported Sliding Sync separately from a network failure', () => {
  expect(authenticationError(new CoreError({ code: 'sliding_sync_unsupported' }))).toBe(
    'This homeserver does not support Sliding Sync.'
  );
  expect(authenticationError(new CoreError({ code: 'unavailable' }))).not.toBe(
    authenticationError(new CoreError({ code: 'sliding_sync_unsupported' }))
  );
});

test('a sign-in blocked by the browser names the homeserver to exempt', () => {
  const message = authenticationError(new LocalNetworkBlockedError('matrix.lan'));

  expect(message).toContain('matrix.lan');
  expect(message).not.toBe(authenticationError(new CoreError({ code: 'unavailable' })));
});

test('names the operation and code, and warns for an outcome the user can retry', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  logAuthenticationFailure('oidc_register_complete', new CoreError({ code: 'unavailable' }));
  expect(warn).toHaveBeenCalledWith(
    '[sable:auth] authentication failed: oidc_register_complete unavailable',
    expect.anything()
  );
  expect(error).not.toHaveBeenCalled();

  logAuthenticationFailure('password_login', new Error('boom'));
  expect(error).toHaveBeenCalledWith(
    '[sable:auth] authentication failed: password_login unexpected',
    expect.anything()
  );

  error.mockRestore();
  warn.mockRestore();
});
