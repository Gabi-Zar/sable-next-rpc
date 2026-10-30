import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { LoginFlowsView } from '#src/generated/protocol';

vi.mock('#lib/platform/deep-links.js', () => ({
  deliversDeepLinks: () => true,
}));

const browser = vi.hoisted(() => ({ navigate: vi.fn(() => Promise.resolve()), close: vi.fn() }));

vi.mock('#lib/platform/external-auth.js', () => ({
  isDesktopAuthClient: vi.fn(() => true),
  openSystemAuthUrl: vi.fn(() => Promise.resolve()),
  openExternalAuthWindow: vi.fn(() => browser),
  openExternalAuthUrl: vi.fn(() => Promise.resolve()),
  startInAppAuthSession: vi.fn(() => Promise.resolve(null)),
}));

import {
  startInAppAuthSession,
  openSystemAuthUrl,
  isDesktopAuthClient,
} from '#lib/platform/external-auth.js';
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
  vi.mocked(isDesktopAuthClient).mockReturnValue(true);
  vi.mocked(openSystemAuthUrl).mockResolvedValue(undefined);
});

describe('RedirectController', () => {
  test.each(['login', 'register'] as const)(
    'completes in-app %s without opening another browser',
    async (intent) => {
      vi.mocked(isDesktopAuthClient).mockReturnValue(false);
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
      expect(completeOidcLogin).toHaveBeenCalledExactlyOnceWith(callback);
      expect(browser.navigate).not.toHaveBeenCalled();
      expect(
        intent === 'login' ? onNavigateLoginVerification : onNavigateRegistrationRecovery
      ).toHaveBeenCalledOnce();
      if (intent === 'login') expect(onMarkLoggedIn).toHaveBeenCalledOnce();
      else expect(onMarkOnboardingPending).toHaveBeenCalledWith('@test:example.org');
    }
  );

  test('does not open another browser after iOS cancellation', async () => {
    vi.mocked(isDesktopAuthClient).mockReturnValue(false);
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
    expect(browser.navigate).not.toHaveBeenCalled();
    expect(controller.isLaunching).toBe(false);
    expect(controller.systemBrowserUrl).toBeNull();
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

test('keeps the native popup until OAuth returns and then closes it', async () => {
  const controller = new RedirectController({
    core: {
      startOidcLogin: vi.fn().mockResolvedValue('https://auth.example.org/authorize'),
      completeOidcLogin: vi.fn().mockResolvedValue(undefined),
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
  expect(browser.navigate).toHaveBeenCalledWith(
    'https://auth.example.org/authorize',
    expect.stringContaining(':/login')
  );
  expect(browser.close).not.toHaveBeenCalled();
  await controller.complete('moe.sable.next:/login?code=example&state=example');
  expect(browser.close).toHaveBeenCalledOnce();
  controller.cleanup();
  expect(browser.close).toHaveBeenCalledOnce();
});

function fallbackController() {
  const core = {
    startOidcLogin: vi.fn().mockResolvedValue('https://auth.example.org/authorize?state=original'),
    completeOidcLogin: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new RedirectController({
    core: core as never,
    getHomeserver: () => 'matrix.example.org',
    getValidationError: () => null,
    validateHomeserver: vi.fn().mockResolvedValue(flows),
    onMarkLoggedIn: vi.fn(),
    onMarkOnboardingPending: vi.fn(),
    onNavigateLoginVerification: vi.fn().mockResolvedValue(undefined),
    onNavigateRegistrationRecovery: vi.fn().mockResolvedValue(undefined),
  });
  return { controller, core };
}

test('continues the same OAuth transaction in the system browser', async () => {
  const { controller, core } = fallbackController();
  await controller.launch('oidc', undefined, 'login');
  await controller.openInBrowser();
  expect(openSystemAuthUrl).toHaveBeenCalledExactlyOnceWith(
    'https://auth.example.org/authorize?state=original'
  );
  expect(browser.close).toHaveBeenCalledOnce();
  expect(core.startOidcLogin).toHaveBeenCalledOnce();
  const callback = 'moe.sable.next:/login?code=example&state=original';
  await controller.complete(callback);
  expect(core.completeOidcLogin).toHaveBeenCalledExactlyOnceWith(callback);
  expect(controller.systemBrowserUrl).toBeNull();
});

test('keeps the popup if the system browser fails to open', async () => {
  const { controller } = fallbackController();
  await controller.launch('oidc', undefined, 'login');
  vi.mocked(openSystemAuthUrl).mockRejectedValueOnce('Browser unavailable');
  await controller.openInBrowser();
  expect(controller.loginError).toBe('Browser unavailable');
  expect(browser.close).not.toHaveBeenCalled();
  expect(controller.isOpeningSystemBrowser).toBe(false);
  await controller.openInBrowser();
  expect(browser.close).toHaveBeenCalledOnce();
});

test('offers the system browser when desktop popup creation fails', async () => {
  browser.navigate.mockRejectedValueOnce('Window creation failed');
  const { controller, core } = fallbackController();
  await controller.launch('oidc', undefined, 'login');
  await controller.openInBrowser();
  expect(openSystemAuthUrl).toHaveBeenCalledOnce();
  expect(core.startOidcLogin).toHaveBeenCalledOnce();
});

test('removes the system browser action when the flow is disposed', async () => {
  const { controller } = fallbackController();
  await controller.launch('oidc', undefined, 'login');
  controller.cleanup();
  await controller.openInBrowser();
  expect(openSystemAuthUrl).not.toHaveBeenCalled();
});
