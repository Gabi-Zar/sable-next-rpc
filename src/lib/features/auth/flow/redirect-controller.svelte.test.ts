import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { LoginFlowsView } from '#src/generated/protocol';

vi.mock('#lib/platform/deep-links.js', () => ({
  deliversDeepLinks: () => true,
}));

vi.mock('#lib/platform/external-auth.js', () => ({
  openExternalAuthUrl: vi.fn(() => Promise.resolve()),
  startInAppAuthSession: vi.fn(() => Promise.resolve(null)),
}));

import { openExternalAuthUrl, startInAppAuthSession } from '#lib/platform/external-auth.js';
import { RedirectController } from './redirect-controller.svelte';

const flows: LoginFlowsView = {
  password: false,
  oidc: true,
  oidc_registration: true,
  qr_login: false,
  sso: false,
  oauth_aware_preferred: true,
  sso_identity_providers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(startInAppAuthSession).mockResolvedValue(null);
});

describe('RedirectController', () => {
  test.each(['login', 'register'] as const)(
    'completes in-app %s without opening the external browser',
    async (intent) => {
      const callback = 'moe.sable.next:/login?code=example&state=example';
      vi.mocked(startInAppAuthSession).mockResolvedValue(callback);
      const completeOidcLogin = vi.fn().mockResolvedValue(undefined);
      const onMarkLoggedIn = vi.fn();
      const onMarkOnboardingPending = vi.fn();
      const onNavigateLoginVerification = vi.fn().mockResolvedValue(undefined);
      const onNavigateRegistrationRecovery = vi.fn().mockResolvedValue(undefined);
      const controller = new RedirectController({
        core: {
          startOidcLogin: vi.fn().mockResolvedValue('https://auth.example.org/authorize'),
          completeOidcLogin,
          session: { user_id: '@test:example.org' },
        } as never,
        getHomeserver: () => 'matrix.example.org',
        getValidationError: () => null,
        validateHomeserver: vi.fn().mockResolvedValue(flows),
        onMarkLoggedIn,
        onMarkOnboardingPending,
        onNavigateLoginVerification,
        onNavigateRegistrationRecovery,
      });
      await controller.launch('oidc', undefined, intent);
      await vi.waitFor(() => {
        expect(controller.isCompleting).toBe(false);
      });
      expect(completeOidcLogin).toHaveBeenCalledExactlyOnceWith(callback);
      expect(openExternalAuthUrl).not.toHaveBeenCalled();
      expect(
        intent === 'login' ? onNavigateLoginVerification : onNavigateRegistrationRecovery
      ).toHaveBeenCalledOnce();
      if (intent === 'login') expect(onMarkLoggedIn).toHaveBeenCalledOnce();
      else expect(onMarkOnboardingPending).toHaveBeenCalledWith('@test:example.org');
    }
  );

  test('does not open an external browser when the iOS session is cancelled', async () => {
    vi.mocked(startInAppAuthSession).mockRejectedValueOnce('user_cancelled');
    const controller = new RedirectController({
      core: {
        startOidcLogin: vi.fn().mockResolvedValue('https://auth.example.org/authorize'),
      } as never,
      getHomeserver: () => 'matrix.example.org',
      getValidationError: () => null,
      validateHomeserver: vi.fn().mockResolvedValue(flows),
      onMarkLoggedIn: vi.fn(),
      onMarkOnboardingPending: vi.fn(),
      onNavigateLoginVerification: vi.fn().mockResolvedValue(undefined),
      onNavigateRegistrationRecovery: vi.fn().mockResolvedValue(undefined),
    });
    await controller.launch('oidc', undefined, 'login');
    expect(controller.loginError).toBe('user_cancelled');
    expect(openExternalAuthUrl).not.toHaveBeenCalled();
    expect(controller.isLaunching).toBe(false);
  });

  test('starts only one provider login while a launch is pending', async () => {
    let resolveValidation: (value: LoginFlowsView) => void = () => {
      throw new Error('Validation was not started');
    };
    const validateHomeserver = vi.fn(
      () => new Promise<LoginFlowsView>((resolve) => (resolveValidation = resolve))
    );
    const startOidcLogin = vi.fn(() => Promise.resolve('https://auth.example.org/authorize'));
    const controller = new RedirectController({
      core: { startOidcLogin } as never,
      getHomeserver: () => 'matrix.example.org',
      getValidationError: () => null,
      validateHomeserver,
      onMarkLoggedIn: vi.fn(),
      onMarkOnboardingPending: vi.fn(),
      onNavigateLoginVerification: vi.fn(() => Promise.resolve()),
      onNavigateRegistrationRecovery: vi.fn(() => Promise.resolve()),
    });

    const first = controller.launch('oidc', undefined, 'login');
    const second = controller.launch('oidc', undefined, 'login');

    expect(validateHomeserver).toHaveBeenCalledOnce();

    resolveValidation(flows);
    await Promise.all([first, second]);

    expect(startOidcLogin).toHaveBeenCalledOnce();
  });
});
