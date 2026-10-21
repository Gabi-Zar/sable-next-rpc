import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  callbackChannelName,
  createRedirectUri,
  redirectLoginType,
  scrubbedCallbackPath,
  nativeRedirectUri,
} from './redirect';

describe('redirect authentication', () => {
  test('classifies only complete OAuth and SSO responses', () => {
    expect(redirectLoginType('https://next.sable.moe/login?code=code&state=state')).toBe('oidc');
    expect(redirectLoginType('https://next.sable.moe/login?error=denied&state=state')).toBe('oidc');
    expect(redirectLoginType('https://next.sable.moe/login?loginToken=token')).toBe('sso');
    expect(redirectLoginType('https://next.sable.moe/login?code=code')).toBeNull();
    expect(redirectLoginType('https://next.sable.moe/login?state=state')).toBeNull();
    expect(redirectLoginType('https://next.sable.moe/login?loginToken=')).toBeNull();
    expect(
      redirectLoginType('https://next.sable.moe/login?loginToken=one&loginToken=two')
    ).toBeNull();
    expect(
      redirectLoginType('https://next.sable.moe/login?code=code&error=denied&state=state')
    ).toBeNull();
    expect(redirectLoginType('not a URL')).toBeNull();
  });

  test('reads an MSC2964 fragment response', () => {
    expect(redirectLoginType('https://next.sable.moe/login#code=code&state=state')).toBe('oidc');
    expect(redirectLoginType('https://next.sable.moe/login#error=denied&state=state')).toBe('oidc');
    expect(redirectLoginType('https://next.sable.moe/login#code=code')).toBeNull();
    expect(redirectLoginType('https://next.sable.moe/login?iss=server#code=code&state=state')).toBe(
      'oidc'
    );
    expect(redirectLoginType('https://next.sable.moe/login?code=code&state=state#section')).toBe(
      'oidc'
    );
  });

  test('adds a correlation value only to legacy SSO', () => {
    expect(createRedirectUri('sso', 'https://next.sable.moe/login', 'nonce')).toBe(
      'https://next.sable.moe/login?sable_sso_state=nonce'
    );
    expect(createRedirectUri('oidc', 'https://next.sable.moe/login', 'nonce')).toBe(
      'https://next.sable.moe/login'
    );
    expect(createRedirectUri('oidc', 'moe.sable.app:/login', 'nonce')).toBe('moe.sable.app:/login');
  });

  describe('native callback URI forms', () => {
    afterEach(() => vi.unstubAllGlobals());

    test('stable keeps the v1 schemes', () => {
      vi.stubGlobal('__SABLE_STABLE__', true);
      expect(nativeRedirectUri('oidc')).toBe('moe.sable.app:/login');
      expect(nativeRedirectUri('sso')).toBe('sable://login');
    });

    test('nightly and development use their own scheme', () => {
      vi.stubGlobal('__SABLE_STABLE__', false);
      expect(nativeRedirectUri('oidc')).toBe('moe.sable.next:/login');
      expect(nativeRedirectUri('sso')).toBe('moe.sable.next://login');
    });

    test.each([true, false])(
      'Electron uses the schemes its package registers (stable=%s)',
      (stable) => {
        vi.stubGlobal('__SABLE_STABLE__', stable);
        vi.stubGlobal('sableElectron', {});
        expect(nativeRedirectUri('oidc')).toBe(
          stable ? 'moe.sable.app:/login' : 'moe.sable.next:/login'
        );
        expect(nativeRedirectUri('sso')).toBe(stable ? 'sable://login' : 'moe.sable.next://login');
      }
    );
  });

  test('uses protocol state to isolate callback channels', () => {
    expect(callbackChannelName('https://next.sable.moe/login?code=code&state=oauth', 'popup')).toBe(
      'sable-auth-callback:oauth'
    );
    expect(callbackChannelName('https://next.sable.moe/login#code=code&state=oauth', 'popup')).toBe(
      'sable-auth-callback:oauth'
    );
    expect(
      callbackChannelName(
        'https://next.sable.moe/login?sable_sso_state=sso&loginToken=token',
        'popup'
      )
    ).toBe('sable-auth-callback:sso');
  });

  test('removes credentials from the callback location', () => {
    expect(scrubbedCallbackPath('https://next.sable.moe/login?code=code&state=state#section')).toBe(
      '/login#section'
    );
    expect(scrubbedCallbackPath('https://next.sable.moe/login?loginToken=token')).toBe('/login');
    expect(scrubbedCallbackPath('https://next.sable.moe/login#code=code&state=state')).toBe(
      '/login'
    );
  });
});
