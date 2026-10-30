import { beforeEach, describe, expect, test, vi } from 'vitest';

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  platform: vi.fn(() => 'ios'),
}));

vi.mock('@tauri-apps/api/core', () => native);
vi.mock('@tauri-apps/plugin-os', () => ({ platform: native.platform }));
vi.mock('./electron', () => ({ isElectron: () => false }));

import { openExternalAuthUrl, startInAppAuthSession } from './external-auth';

beforeEach(() => {
  vi.clearAllMocks();
  native.isTauri.mockReturnValue(true);
  native.platform.mockReturnValue('ios');
  native.invoke.mockResolvedValue(undefined);
});

describe('authentication browsers', () => {
  test.each(['ios', 'android'])('keeps authentication pages inside %s', async (platform) => {
    native.platform.mockReturnValue(platform);
    await openExternalAuthUrl('https://matrix.example.org/register');
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('open_in_app_auth_url', {
      url: 'https://matrix.example.org/register',
    });
  });

  test.each(['linux', 'windows', 'macos'])(
    'uses the external URL command on %s',
    async (platform) => {
      native.platform.mockReturnValue(platform);
      await openExternalAuthUrl('https://matrix.example.org/register');
      expect(native.invoke).toHaveBeenCalledExactlyOnceWith('open_external_url', {
        url: 'https://matrix.example.org/register',
      });
    }
  );

  test('opens approval synchronously outside Tauri', async () => {
    native.isTauri.mockReturnValue(false);
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    try {
      const pending = openExternalAuthUrl('https://auth.example.org/device');
      expect(open).toHaveBeenCalledExactlyOnceWith(
        'https://auth.example.org/device',
        '_blank',
        'noopener'
      );
      await pending;
      expect(native.invoke).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('returns the iOS authentication callback', async () => {
    const callback = 'moe.sable.next:/oidc?code=example';
    native.invoke.mockResolvedValue(callback);
    await expect(startInAppAuthSession('https://auth.example.org', callback)).resolves.toBe(
      callback
    );
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('plugin:auth-session|start', {
      authUrl: 'https://auth.example.org',
      callbackUrlScheme: 'moe.sable.next',
      ephemeral: false,
    });
  });

  test('does not replace a cancelled iOS session with an external browser', async () => {
    native.invoke.mockRejectedValue('user_cancelled');
    await expect(
      startInAppAuthSession('https://auth.example.org', 'moe.sable.next:/oidc')
    ).rejects.toBe('user_cancelled');
    expect(native.invoke).toHaveBeenCalledOnce();
  });

  test('leaves other platforms to their existing authentication flow', async () => {
    native.platform.mockReturnValue('android');
    await expect(
      startInAppAuthSession('https://auth.example.org', 'moe.sable.next:/oidc')
    ).resolves.toBeNull();
    native.isTauri.mockReturnValue(false);
    await expect(
      startInAppAuthSession('https://auth.example.org', 'https://app.example.org/oidc')
    ).resolves.toBeNull();
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
