import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_ALTERNATE_NAMES = 1000;

export async function writeDownload(
  directory: string,
  name: string,
  bytes: Uint8Array
): Promise<string> {
  if (
    !name ||
    /[\\/:*?"<>|\p{Cc}]/u.test(name) ||
    /[. ]$/u.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
  ) {
    throw new Error('Invalid download filename');
  }

  const path = join(directory, name);
  try {
    await writeFile(path, bytes, { flag: 'wx' });
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const dot = name.lastIndexOf('.');
    for (let attempt = 1; attempt <= MAX_ALTERNATE_NAMES; attempt += 1) {
      const suffix = ` (${attempt})`;
      const candidate =
        dot > 0 ? `${name.slice(0, dot)}${suffix}${name.slice(dot)}` : `${name}${suffix}`;
      const alternate = join(directory, candidate);
      try {
        await writeFile(alternate, bytes, { flag: 'wx' });
        return alternate;
      } catch (alternateError) {
        if ((alternateError as NodeJS.ErrnoException).code !== 'EEXIST') throw alternateError;
      }
    }
    throw new Error(`Could not find an available filename for ${name}`, { cause: error });
  }
}
