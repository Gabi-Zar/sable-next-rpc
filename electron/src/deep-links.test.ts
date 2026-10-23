import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

import { deepLinksIn, deepLinkSchemes } from './deep-links';

test.each([
  ['moe.sable.client', 'stable', ['moe.sable.app', 'sable']],
  ['moe.sable.client.sandboxed', 'stable', ['moe.sable.app', 'sable']],
  ['moe.sable.next.nightly', 'nightly', ['moe.sable.next']],
  ['moe.sable.next', 'nightly', ['moe.sable.next']],
])('%s matches the %s packaged schemes', (identifier, flavor, expected) => {
  const schemes = deepLinkSchemes(identifier);
  expect(schemes).toEqual(expected);
  const config = readFileSync(
    new URL(`../electron-builder.${flavor}.yml`, import.meta.url),
    'utf8'
  );
  const packagedSchemes = [...config.matchAll(/^ {6}- (.+)$/gm)].map((match) => match[1]);
  expect(schemes).toEqual(packagedSchemes);
});

test('extracts OIDC and SSO callbacks from argv', () => {
  const callbacks = ['moe.sable.next:/login?code=a&state=b', 'moe.sable.next://login?loginToken=c'];
  expect(
    deepLinksIn(
      ['/opt/Sable Nightly/sable-nightly', '--flag', ...callbacks],
      deepLinkSchemes('moe.sable.next.nightly')
    )
  ).toEqual(callbacks);
});

test('matches schemes case-insensitively and preserves callback parameters', () => {
  const callback = 'MOE.SABLE.NEXT:/login?code=CaseSensitive&state=a%2Fb';
  expect(deepLinksIn([callback], deepLinkSchemes('moe.sable.next.nightly'))).toEqual([callback]);
});

test('rejects invalid URLs and other flavors', () => {
  const argv = [
    'sable://login?loginToken=a',
    'moe.sable.app:/login?code=b&state=c',
    'moe.sable.next:/login?code=d&state=e',
    'moe.sable.client:/login',
    'moe.sable.next.nightly:/login',
    'sable-app://app',
    'https://sable.moe',
    '--url=sable://login',
    'sable://[invalid',
  ];
  expect(deepLinksIn(argv, deepLinkSchemes('moe.sable.client'))).toEqual(argv.slice(0, 2));
  expect(deepLinksIn(argv, deepLinkSchemes('moe.sable.next.nightly'))).toEqual([argv[2]]);
});
