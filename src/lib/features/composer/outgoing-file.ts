import type { StagedFile } from '#lib/composer/composer-files.js';
import { uprightJpeg } from '#lib/ui/upright-jpeg.js';

import { jpegFromHeic } from './heic-to-jpeg';
import { stripMetadata } from './strip-metadata';

export async function outgoingFile(item: StagedFile): Promise<File> {
  const file = await jpegFromHeic(item.file);
  const upright = await uprightJpeg(file);
  return stripMetadata(
    upright === file
      ? file
      : new File([upright], file.name, { type: upright.type, lastModified: file.lastModified }),
    item.metadata
  );
}
