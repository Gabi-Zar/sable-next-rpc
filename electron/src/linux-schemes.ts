import { app } from 'electron';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function quote(argument: string): string {
  return `"${argument.replace(/["`$\\]/g, '\\$&')}"`;
}

function run(command: string, args: string[]): void {
  execFile(command, args, (error) => {
    if (error) console.warn(`[sable deep links] ${command} failed`, error.message);
  });
}

function currentHandler(mimeType: string): string {
  try {
    return execFileSync('xdg-mime', ['query', 'default', mimeType], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function claimSchemes(applications: string, identifier: string, schemes: string[]): void {
  const exec = process.defaultApp
    ? ['env', `SABLE_IDENTIFIER=${identifier}`, process.execPath, resolve(app.getAppPath())]
    : [process.env.APPIMAGE ?? process.execPath];
  const mimeTypes = schemes.map((scheme) => `x-scheme-handler/${scheme}`);
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Sable',
    `Exec=${[...exec.map(quote), '%u'].join(' ')}`,
    'Terminal=false',
    `MimeType=${mimeTypes.join(';')};`,
    'NoDisplay=true',
    '',
  ].join('\n');

  const name = `${identifier}-handler.desktop`;
  const path = join(applications, name);
  if (!existsSync(path) || readFileSync(path, 'utf8') !== entry) {
    mkdirSync(applications, { recursive: true });
    writeFileSync(path, entry);
    run('update-desktop-database', [applications]);
  }
  for (const mimeType of mimeTypes) {
    const handler = currentHandler(mimeType);
    if (handler === '' || handler === name) run('xdg-mime', ['default', name, mimeType]);
  }
}
