import { dialog, type BrowserWindow, type Session } from 'electron';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const GRANTED = new Set([
  'clipboard-sanitized-write',
  'display-capture',
  'fullscreen',
  'notifications',
  'persistent-storage',
  'screen-wake-lock',
  'speaker-selection',
]);

const PROMPTS: Record<string, string> = {
  microphone: 'Sable wants to use your microphone.',
  camera: 'Sable wants to use your camera.',
  location: 'Sable wants to access your location.',
};

const systemAsks = process.platform === 'darwin';

function readGrants(path: string): string[] {
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as unknown[]).filter(
      (kind): kind is string => typeof kind === 'string' && kind in PROMPTS
    );
  } catch {
    return [];
  }
}

function kindsOf(permission: string, mediaTypes: readonly string[] = []): string[] | null {
  if (permission === 'geolocation') return ['location'];
  if (permission !== 'media' || mediaTypes.length === 0) return null;
  return mediaTypes.map((type) => (type === 'audio' ? 'microphone' : 'camera'));
}

export function enforcePermissions(
  session: Session,
  grantsPath: string,
  isAppUrl: (url: string | undefined) => boolean,
  window: () => BrowserWindow | null
): void {
  const grants = new Set(readGrants(grantsPath));
  const granted = (kinds: string[]) => systemAsks || kinds.every((kind) => grants.has(kind));

  async function confirm(kinds: string[]): Promise<boolean> {
    const parent = window();
    const options = {
      type: 'question' as const,
      message:
        kinds.length === 1 ? PROMPTS[kinds[0]] : 'Sable wants to use your microphone and camera.',
      buttons: ['Allow', 'Deny'],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = await (parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options));
    if (response !== 0) return false;
    for (const kind of kinds) grants.add(kind);
    await writeFile(grantsPath, JSON.stringify([...grants].sort()));
    return true;
  }

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!isAppUrl(contents.getURL())) {
      callback(false);
      return;
    }
    if (GRANTED.has(permission)) {
      callback(true);
      return;
    }
    const kinds = kindsOf(permission, 'mediaTypes' in details ? details.mediaTypes : undefined);
    if (!kinds) {
      callback(false);
      return;
    }
    if (granted(kinds)) {
      callback(true);
      return;
    }
    void confirm(kinds).then(callback, () => {
      callback(false);
    });
  });

  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (!isAppUrl(details.embeddingOrigin ?? requestingOrigin)) return false;
    if (GRANTED.has(permission)) return true;
    const mediaTypes =
      details.mediaType && details.mediaType !== 'unknown' ? [details.mediaType] : [];
    const kinds = kindsOf(permission, mediaTypes);
    return kinds !== null && granted(kinds);
  });
}
