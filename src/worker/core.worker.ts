/// <reference lib="webworker" />

import init, { SableCore, setLogHandler, setPanicHandler } from '#src/generated/wasm/sable_wasm.js';
import { clearSession, loadSession, saveSession } from '#lib/platform/session-storage.js';
import { createCoreWorkerBoundary } from './core-worker-boundary';

declare const self: SharedWorkerGlobalScope;

const core = init().then(() => {
  // Before the constructor, so a panic while opening the session store still
  // carries its Rust message.
  setPanicHandler(crash);

  const instance = new SableCore(
    'sable-next',
    () => loadSession(),
    (bytes: Uint8Array) => saveSession(bytes),
    () => clearSession(),
    new URLSearchParams(self.location.search).get('log')
  );

  return instance;
});

const boundary = createCoreWorkerBoundary(core);

// A trap unwinds only its own call, so close the worker rather than keep re-entering a corrupted module; the next connect builds a fresh one.
function crash(message: string): void {
  boundary.handlePanic(message);
  setTimeout(() => {
    self.close();
  }, 0);
}

// A SharedWorker's runtime failures never reach the pages that opened it, so
// they ride the same channel as a Rust panic. A failed `init()` lands here too.
self.addEventListener('error', (event) => {
  crash(`worker error: ${event.message}`);
});
self.addEventListener('unhandledrejection', (event) => {
  crash(`unhandled rejection in worker: ${String(event.reason)}`);
});

void core.then((instance) => {
  setLogHandler(boundary.handleLog);
  instance.subscribeEvents(boundary.handleEvent);
});

self.onconnect = (connect: MessageEvent) => {
  const port = connect.ports[0];
  boundary.connect({
    postMessage: (message, transfer) => {
      if (transfer) port.postMessage(message, { transfer });
      else port.postMessage(message);
    },
    get onmessage() {
      return port.onmessage;
    },
    set onmessage(handler) {
      port.onmessage = handler;
    },
    get onmessageerror() {
      return port.onmessageerror;
    },
    set onmessageerror(handler) {
      port.onmessageerror = handler;
    },
    start: () => {
      port.start();
    },
  });
};
