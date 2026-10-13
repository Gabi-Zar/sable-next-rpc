// @vitest-environment happy-dom

import i18next from 'i18next';
import { flushSync } from 'svelte';
import { expect, test } from 'vitest';

import { currentLocale, i18n, setLanguage, t } from './i18n.js';

test('a language change re-runs t() and currentLocale() reads', async () => {
  const seen: string[] = [];
  const locales: string[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(t('timeline.members'));
      locales.push(currentLocale());
    });
  });

  try {
    flushSync();
    expect(seen.at(-1)).toBe('Members');
    expect(locales.at(-1)).toBe('en');

    await setLanguage('fr');
    flushSync();

    expect(seen.at(-1)).toBe('Membres');
    expect(locales.at(-1)).toBe('fr');
  } finally {
    stop();
    await setLanguage('en');
  }
});

test('i18n.t reads re-run when a bundle adds a translation', () => {
  const seen: string[] = [];
  const stop = $effect.root(() => {
    $effect(() => {
      seen.push(i18n.t('probe', { ns: 'zz' }));
    });
  });

  try {
    flushSync();
    expect(seen.at(-1)).toBe('probe');

    i18next.addResource('en', 'zz', 'probe', 'Probe');
    flushSync();

    expect(seen.at(-1)).toBe('Probe');
  } finally {
    stop();
    i18next.removeResourceBundle('en', 'zz');
  }
});
