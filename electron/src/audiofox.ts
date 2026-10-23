import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { release } from 'node:os';
import type { ScreenAudioListing } from '../../src/lib/platform/screen-audio-types';
import type { AudioRequest, AudioResponse } from './audiofox-protocol';

const REQUEST_TIMEOUT = 5000;
const STOP_TIMEOUT = 300;
interface Pending {
  resolve: (value: string[] | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
interface Host {
  child: UtilityProcess;
  ready: boolean;
  pending: Map<number, Pending>;
  frames?: (data: Buffer) => void;
}
let host: Host | undefined;
let sequence = 0;

export function supported(platform = process.platform, version = release()): boolean {
  if (platform === 'linux') return true;
  if (platform === 'win32') return Number(version.split('.')[2]) >= 20348;
  const [major, minor] = version.split('.').map(Number);
  return platform === 'darwin' && (major > 23 || (major === 23 && minor >= 2));
}
export const available = supported();

function rejectPending(current: Host, error: Error): void {
  for (const pending of current.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  current.pending.clear();
}

function terminate(current: Host, error: Error): void {
  if (host !== current) return;
  host = undefined;
  rejectPending(current, error);
  current.child.kill();
  current.frames?.(Buffer.alloc(0));
}

function worker(): Host {
  if (host) return host;
  const child = utilityProcess.fork(join(__dirname, 'audiofox-host.cjs'), [], {
    serviceName: 'Sable Audio',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const current: Host = { child, ready: false, pending: new Map() };
  host = current;
  child.stderr?.on('data', (data: Buffer) => process.stderr.write(data));
  child.once('spawn', () => {
    current.ready = true;
  });
  child.once('exit', (code) => {
    terminate(current, new Error(`Audio process exited (${code})`));
  });
  child.on('message', (message: AudioResponse) => {
    if (host !== current) return;
    if (message.type === 'frames') {
      current.frames?.(Buffer.from(message.data));
      child.postMessage({ command: 'ack' });
      return;
    }
    const pending = current.pending.get(message.id);
    if (!pending) return;
    current.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.value);
  });
  return current;
}

function request(current: Host, command: AudioRequest): Promise<string[] | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      terminate(current, new Error('Audio capture timed out'));
    }, REQUEST_TIMEOUT);
    current.pending.set(command.id, { resolve, reject, timer });
    const send = (): void => {
      if (host !== current) return;
      try {
        current.child.postMessage(command);
      } catch (error) {
        terminate(current, error instanceof Error ? error : new Error(String(error)));
      }
    };
    if (current.ready) send();
    else current.child.once('spawn', send);
  });
}

export async function listApps(): Promise<ScreenAudioListing> {
  const apps = await request(worker(), { command: 'list', id: ++sequence, rootPid: process.pid });
  return {
    status: 'available',
    apps: (apps ?? []).map((id) => ({ id, label: id.slice('audiofox:'.length) })),
  };
}

export function sourceName(id: string): string | undefined {
  return id.startsWith('audiofox:') ? id.slice('audiofox:'.length) : undefined;
}

export async function start(include: string[], frames: (data: Buffer) => void): Promise<void> {
  stop();
  const current = worker();
  current.frames = frames;
  try {
    await request(current, { command: 'start', id: ++sequence, rootPid: process.pid, include });
  } catch (error) {
    if (host === current) stop();
    throw error;
  }
}

export function stop(): void {
  const current = host;
  if (!current) return;
  host = undefined;
  rejectPending(current, new Error('Audio capture stopped'));
  const timer = setTimeout(() => {
    current.child.kill();
  }, STOP_TIMEOUT);
  current.child.once('exit', () => {
    clearTimeout(timer);
  });
  const send = (): void => {
    try {
      current.child.postMessage({ command: 'stop', id: ++sequence, rootPid: process.pid });
    } catch {
      clearTimeout(timer);
      current.child.kill();
    }
  };
  if (current.ready) send();
  else current.child.once('spawn', send);
}
