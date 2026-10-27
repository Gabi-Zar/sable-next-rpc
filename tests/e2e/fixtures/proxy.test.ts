import { strict as assert } from 'node:assert';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from 'vitest';

import { HomeserverProxy } from './proxy';

test('keeps login discovery routed through the proxy', async () => {
  const login = {
    access_token: 'token',
    user_id: '@reader:test.local',
    well_known: {
      'm.homeserver': { base_url: 'http://advertised.invalid' },
      'm.identity_server': { base_url: 'https://identity.invalid' },
    },
  };
  const upstream = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(login));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  assert(address !== null && typeof address !== 'string');
  const proxy = await HomeserverProxy.start(`http://127.0.0.1:${String(address.port)}`);
  try {
    const response = await fetch(`${proxy.baseUrl}/_matrix/client/v3/login`, {
      method: 'POST',
      body: '{}',
    });

    await expect(response.json()).resolves.toEqual({
      ...login,
      well_known: {
        ...login.well_known,
        'm.homeserver': { base_url: proxy.baseUrl },
      },
    });
  } finally {
    await proxy.stop();
    upstream.closeAllConnections();
    upstream.close();
    await once(upstream, 'close');
  }
});
