import { describe, expect, it, vi } from 'vitest';
import type { LoginFlowsView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { AuthFlowController, LOGGED_IN_MARKER, readReturningUser } from './auth-flow.svelte';

const flows: LoginFlowsView = {
  password: true,
  oidc: false,
  oidc_registration: false,
  sso: false,
  qr_login: false,
  oauth_aware_preferred: false,
  sso_identity_providers: [],
};

describe('auth flow state helpers', () => {
  it('restores the returning-user marker', () => {
    const storage = {
      getItem: (key: string) => (key === LOGGED_IN_MARKER ? 'true' : null),
    } as Storage;
    expect(readReturningUser(storage)).toBe(true);
  });

  it('fails closed when no browser storage is available', () => {
    expect(readReturningUser(undefined)).toBe(false);
    expect(readReturningUser(null)).toBe(false);
    expect(
      readReturningUser({
        getItem: () => {
          throw new Error('denied');
        },
      } as unknown as Storage)
    ).toBe(false);
  });
});

describe('the initial homeserver check', () => {
  it('does not ask a homeserver or show an error when the field starts empty', async () => {
    const loginFlows = vi.fn(() => Promise.resolve(flows));
    const flow = new AuthFlowController({ loginFlows } as unknown as CoreClient, '', null);

    await flow.validateInitialHomeserver();

    expect(loginFlows).not.toHaveBeenCalled();
    expect(flow.error).toBeNull();
  });

  it('checks the prefilled homeserver', async () => {
    const loginFlows = vi.fn(() => Promise.resolve(flows));
    const flow = new AuthFlowController(
      { loginFlows } as unknown as CoreClient,
      'one.example',
      null
    );

    await flow.validateInitialHomeserver();

    expect(loginFlows).toHaveBeenCalledWith('one.example');
  });
});

describe('provider validation', () => {
  it('stays unready until validation succeeds and resets when edited', async () => {
    const result = Promise.withResolvers<typeof flows>();
    const flow = new AuthFlowController(
      { loginFlows: () => result.promise } as unknown as CoreClient,
      'one.example',
      null
    );
    expect(flow.loginProviderReady).toBe(false);
    const pending = flow.validateInitialHomeserver();
    expect(flow.loginProviderReady).toBe(false);
    result.resolve(flows);
    await pending;
    expect(flow.loginProviderReady).toBe(true);

    flow.clearLoginHomeserverValidation();
    expect(flow.loginFlows).toBe(flows);
    expect(flow.loginProviderReady).toBe(false);
  });

  it('ignores validation for the previous provider', async () => {
    const result = Promise.withResolvers<typeof flows>();
    const flow = new AuthFlowController(
      { loginFlows: () => result.promise } as unknown as CoreClient,
      'one.example',
      null
    );
    const pending = flow.validateInitialHomeserver();
    flow.homeserverInput('two.example');
    result.resolve(flows);
    await pending;
    expect(flow.loginProviderReady).toBe(false);
  });

  it('stays unready after a validation error', async () => {
    const flow = new AuthFlowController(
      {
        loginFlows: () => Promise.reject(new Error('Provider unavailable')),
      } as unknown as CoreClient,
      'one.example',
      null
    );
    await flow.validateInitialHomeserver();
    expect(flow.error).toBeTruthy();
    expect(flow.loginProviderReady).toBe(false);
  });
});
