import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { LoadRetry } from './load-retry';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('retries after the media retry delays, doubling each time', () => {
  const retry = vi.fn();
  const load = new LoadRetry();

  load.schedule(retry);
  vi.advanceTimersByTime(1_999);
  expect(retry).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(retry).toHaveBeenCalledTimes(1);

  load.schedule(retry);
  vi.advanceTimersByTime(3_999);
  expect(retry).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(retry).toHaveBeenCalledTimes(2);
});

test('stops retrying after six attempts', () => {
  const retry = vi.fn();
  const load = new LoadRetry();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    load.schedule(retry);
    vi.advanceTimersByTime(3_600_000);
  }

  expect(retry).toHaveBeenCalledTimes(6);
});

test('keeps one pending retry however often it is scheduled', () => {
  const retry = vi.fn();
  const load = new LoadRetry();

  load.schedule(retry);
  load.schedule(retry);
  load.schedule(retry);
  vi.advanceTimersByTime(3_600_000);

  expect(retry).toHaveBeenCalledTimes(1);
});

test('cancelling drops the pending retry but keeps the backoff', () => {
  const retry = vi.fn();
  const load = new LoadRetry();

  load.schedule(retry);
  vi.advanceTimersByTime(2_000);
  load.schedule(retry);
  load.cancel();
  vi.advanceTimersByTime(3_600_000);
  expect(retry).toHaveBeenCalledTimes(1);

  load.schedule(retry);
  vi.advanceTimersByTime(3_999);
  expect(retry).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(retry).toHaveBeenCalledTimes(2);
});

test('resetting starts the backoff over', () => {
  const retry = vi.fn();
  const load = new LoadRetry();

  load.schedule(retry);
  vi.advanceTimersByTime(2_000);
  load.reset();

  load.schedule(retry);
  vi.advanceTimersByTime(2_000);
  expect(retry).toHaveBeenCalledTimes(2);
});
