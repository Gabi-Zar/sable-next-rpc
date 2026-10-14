import { afterEach, describe, expect, it, vi } from 'vitest';

import { androidBackAction, installAndroidBack } from './android-back.js';
import { isAndroid } from './os.js';

vi.mock('./os.js', () => ({ isAndroid: vi.fn(() => true) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(isAndroid).mockReturnValue(true);
});

describe('androidBackAction', () => {
  it('steps back through the app history first', () => {
    expect(androidBackAction(true, '/rooms/a', '/rooms')).toBe('back');
    expect(androidBackAction(true, '/rooms', '/rooms')).toBe('back');
  });

  it('lands on home when a cold start has nothing behind it', () => {
    expect(androidBackAction(false, '/rooms/a', '/rooms')).toBe('home');
  });

  it('leaves the app from home with no history', () => {
    expect(androidBackAction(false, '/rooms', '/rooms')).toBe('exit');
  });
});

describe('installAndroidBack', () => {
  const stubHistory = (canGoBack: boolean) => {
    const back = vi.fn();
    vi.stubGlobal('window', { navigation: { canGoBack } });
    vi.stubGlobal('history', { back, length: 1 });
    return back;
  };

  it('does nothing off Android', () => {
    vi.mocked(isAndroid).mockReturnValue(false);
    stubHistory(true);
    installAndroidBack({ pathname: () => '/rooms', homePath: '/rooms', goHome: vi.fn() });
    expect(window.__sableAndroidBack).toBeUndefined();
  });

  it('consumes back by popping history', () => {
    const back = stubHistory(true);
    const goHome = vi.fn();
    installAndroidBack({ pathname: () => '/rooms/a', homePath: '/rooms', goHome });
    expect(window.__sableAndroidBack?.()).toBe(true);
    expect(back).toHaveBeenCalledOnce();
    expect(goHome).not.toHaveBeenCalled();
  });

  it('goes home from a cold-start room and then lets the app leave', () => {
    const back = stubHistory(false);
    const goHome = vi.fn();
    let pathname = '/rooms/a';
    installAndroidBack({ pathname: () => pathname, homePath: '/rooms', goHome });
    expect(window.__sableAndroidBack?.()).toBe(true);
    expect(goHome).toHaveBeenCalledOnce();
    pathname = '/rooms';
    expect(window.__sableAndroidBack?.()).toBe(false);
    expect(back).not.toHaveBeenCalled();
  });

  it('removes only its own handler on cleanup', () => {
    stubHistory(true);
    const cleanup = installAndroidBack({
      pathname: () => '/',
      homePath: '/rooms',
      goHome: vi.fn(),
    });
    const next = () => true;
    window.__sableAndroidBack = next;
    cleanup();
    expect(window.__sableAndroidBack).toBe(next);
    delete window.__sableAndroidBack;
  });
});
