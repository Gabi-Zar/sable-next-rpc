import { describe, expect, it, vi } from 'vitest';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { AuthFlowController, LOGGED_IN_MARKER, readReturningUser } from './auth-flow.svelte';

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
  const flows = { password: true } as never;

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
