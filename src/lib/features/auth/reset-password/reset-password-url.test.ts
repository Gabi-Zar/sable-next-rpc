import { describe, expect, it } from 'vitest';
import { loginHref, resetPasswordHref } from './reset-password-url';

describe('password reset links', () => {
  it('carries the homeserver to the reset page', () => {
    expect(resetPasswordHref(' example.org ')).toBe('/reset-password?server=example.org');
  });

  it('returns to the sign-in route of the same homeserver', () => {
    expect(loginHref('example.org', 'matrix.org')).toBe('/login/example.org');
    expect(loginHref('matrix.org', 'matrix.org')).toBe('/login');
    expect(loginHref('https://example.org/path', 'matrix.org')).toBe('/login');
  });

  it('keeps the add-account flag across the reset round trip', () => {
    expect(resetPasswordHref('example.org', true)).toBe(
      '/reset-password?addAccount=1&server=example.org'
    );
    expect(loginHref('example.org', 'matrix.org', true)).toBe('/login/example.org?addAccount=1');
    expect(loginHref('matrix.org', 'matrix.org', true)).toBe('/login?addAccount=1');
  });
});
