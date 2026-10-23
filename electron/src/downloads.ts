import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
    const stamp = `-${String(Date.now())}`;
    const candidate =
      dot > 0 ? `${name.slice(0, dot)}${stamp}${name.slice(dot)}` : `${name}${stamp}`;
    const alternate = join(directory, candidate);
    await writeFile(alternate, bytes, { flag: 'wx' });
    return alternate;
  }
}
