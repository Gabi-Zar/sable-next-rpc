import { invoke, isTauri } from '@tauri-apps/api/core';
import { uint8ArrayToBase64 } from 'uint8array-extras';

export async function copyImage(png: Blob | Promise<Blob>): Promise<void> {
  if (isTauri()) {
    const { type } = await import('@tauri-apps/plugin-os');
    if (type() === 'android') {
      const bytes = new Uint8Array(await (await png).arrayBuffer());
      await invoke('copy_image_to_clipboard', { image: uint8ArrayToBase64(bytes) });
      return;
    }
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
