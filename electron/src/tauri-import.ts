import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COPIED = ['permissions.json', 'sentry-consent'];

// The core data directory is shared with Tauri; only these per-app files need copying.
export function importTauriConfig(sourceDirs: string[], userData: string): void {
  const source = sourceDirs.find((dir) => existsSync(dir));
  if (!source) return;
  mkdirSync(userData, { recursive: true });

  for (const name of COPIED) {
    const target = join(userData, name);
    if (!existsSync(join(source, name)) || existsSync(target)) continue;
    copyFileSync(join(source, name), target);
  }

  const settings = join(userData, 'settings.json');
  const smoothScrolling = join(source, 'smooth_scrolling');
  if (existsSync(settings) || !existsSync(smoothScrolling)) return;
  if (readFileSync(smoothScrolling, 'utf8').trim() === '0') {
    writeFileSync(settings, JSON.stringify({ smoothScrolling: false }));
  }
}
