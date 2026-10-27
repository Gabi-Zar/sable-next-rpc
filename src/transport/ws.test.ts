import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { CoreEvent } from '#src/generated/protocol';
import { createWsTransport } from './ws';

const reload = vi.fn();

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readonly url: string;
  binaryType: BinaryType = 'arraybuffer';
  readyState = 0;

  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    const event = new Event('close') as CloseEvent;
    Object.assign(event, { code, reason });
    this.dispatchEvent(event);
  }

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  receiveBinary(data: ArrayBuffer): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  disconnect(): void {
    this.readyState = 3;
    const event = new Event('close') as CloseEvent;
    Object.assign(event, { code: 1006, reason: 'lost' });
    this.dispatchEvent(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  reload.mockReset();
  FakeWebSocket.instances = [];
  vi.stubGlobal('location', {
    href: 'https://sable.test/rooms',
    reload,
  });
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openTransport() {
  const transport = createWsTransport({
    url: 'http://server.test/ws',
  });
  await vi.advanceTimersByTimeAsync(0);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({ server: { version: '0.1.0', run_id: 'run-1' } });
  return { transport, socket };
}

test('maps websocket RPC replies and server errors', async () => {
  const transport = createWsTransport({
    url: 'http://server.test/ws',
  });
  await vi.advanceTimersByTimeAsync(0);
  const socket = FakeWebSocket.instances[0];
  expect(socket.url).toBe('ws://server.test/ws');
  socket.open();

  const reply = transport.call('session.restore', {});
  expect(socket.sent).toEqual([JSON.stringify({ id: 1, method: 'session.restore', params: {} })]);
  socket.receive({ id: 1, ok: { account_id: 'a1' } });
  await expect(reply).resolves.toEqual({ account_id: 'a1' });

  const failure = transport.call('session.restore', {});
  socket.receive({ id: 2, error: { code: 'not_logged_in' } });
  await expect(failure).rejects.toMatchObject({ detail: { code: 'not_logged_in' } });
  transport.close();
});

test('reconnects with backoff and sends new calls after the socket returns', async () => {
  const { transport, socket } = await openTransport();
  socket.disconnect();
  await vi.advanceTimersByTimeAsync(250);

  const reconnected = FakeWebSocket.instances[1];
  expect(reconnected.url).toBe('ws://server.test/ws?run_id=run-1');
  reconnected.open();
  const pending = transport.call('session.list_accounts', {});
  expect(reconnected.sent).toContain(
    JSON.stringify({ id: 1, method: 'session.list_accounts', params: {} })
  );
  reconnected.receive({ id: 1, ok: [] });
  await expect(pending).resolves.toEqual([]);
  transport.close();
});

test('delivers events to subscribers', async () => {
  const { transport, socket } = await openTransport();
  const events: CoreEvent[] = [];
  transport.subscribe((event) => events.push(event));
  socket.receive({ event: { type: 'session_ended', reason: 'server stopped' } });
  expect(events).toEqual([{ type: 'session_ended', reason: 'server stopped' }]);
  transport.close();
});

test('reconnects with the run id and last received event', async () => {
  const { transport, socket } = await openTransport();
  const events: CoreEvent[] = [];
  transport.subscribe((event) => events.push(event));
  socket.receive({ event: { type: 'session_ended', reason: 'one' }, seq: 7, run_id: 'run-1' });
  socket.receive({ event: { type: 'session_ended', reason: 'one' }, seq: 7, run_id: 'run-1' });
  expect(events).toEqual([{ type: 'session_ended', reason: 'one' }]);
  socket.disconnect();
  await vi.advanceTimersByTimeAsync(250);
  expect(FakeWebSocket.instances[1].url).toBe(
    'ws://server.test/ws?run_id=run-1&last_received_event=7'
  );
  transport.close();
});

test('reloads after the server cannot replay the event gap', async () => {
  const { transport, socket } = await openTransport();
  socket.receive({ reset: true });
  expect(reload).toHaveBeenCalledOnce();
  transport.close();
});

test('uses authenticated HTTP endpoints for media and binary sends', async () => {
  const { transport, socket } = await openTransport();
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/media/')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    return new Response(
      url.includes('/upload') ? JSON.stringify('mxc://example.org/uploaded') : null,
      {
        status: url.includes('/upload') ? 200 : 204,
        headers: { 'content-type': 'application/json' },
      }
    );
  });
  vi.stubGlobal('fetch', fetchMock);

  await expect(transport.fetchMedia('mxc://example.org/media', 96, 96)).resolves.toEqual(
    new Uint8Array([1, 2, 3])
  );
  await expect(transport.uploadMedia('image/png', new Uint8Array([4]))).resolves.toBe(
    'mxc://example.org/uploaded'
  );
  await expect(
    transport.sendAttachment({
      roomId: '!room:example.org',
      filename: 'a.png',
      mime: 'image/png',
      bytes: new Uint8Array([4]),
    })
  ).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(socket.readyState).toBe(1);
  transport.close();
});
