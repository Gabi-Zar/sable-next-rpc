import { readJson, writeJson } from '#lib/platform/local-json.js';

interface Usage {
  score: number;
  at: number;
}

const STORAGE_KEY = 'sable.composer.suggestionUsage';
const MAX_ENTRIES = 200;
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const FORGET_BELOW = 0.05;

let entries: Record<string, Usage> = readJson(STORAGE_KEY, parseUsage, {});

export function parseUsage(value: unknown, now = Date.now()): Record<string, Usage> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, Usage> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && entry > 0) {
      parsed[id] = { score: entry, at: now };
    } else if (
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as Usage).score === 'number' &&
      typeof (entry as Usage).at === 'number'
    ) {
      parsed[id] = { score: (entry as Usage).score, at: (entry as Usage).at };
    }
  }
  return parsed;
}

function decayed(entry: Usage | undefined, now: number): number {
  if (!entry) return 0;
  return entry.score * 0.5 ** (Math.max(0, now - entry.at) / HALF_LIFE_MS);
}

export function usageOf(id: string, now = Date.now()): number {
  return decayed(entries[id], now);
}

export function byUsage(left: string, right: string): number {
  const now = Date.now();
  return usageOf(right, now) - usageOf(left, now);
}

export function rememberSuggestion(id: string, now = Date.now()): void {
  const next: Record<string, Usage> = {
    ...entries,
    [id]: { score: usageOf(id, now) + 1, at: now },
  };
  entries = Object.fromEntries(
    Object.entries(next)
      .map(([key, entry]) => [key, { score: decayed(entry, now), at: now }] as const)
      .filter(([, entry]) => entry.score >= FORGET_BELOW)
      .sort((left, right) => right[1].score - left[1].score)
      .slice(0, MAX_ENTRIES)
  );
  writeJson(STORAGE_KEY, entries);
}
