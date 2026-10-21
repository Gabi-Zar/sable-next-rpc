import { electronBridge } from './electron.js';
import { pickFiles } from './files.js';
import { isNativeMobile } from './os.js';

/**
 * Svelte action for `<input type="file">`: where the webview has no picker of its own (native mobile
 * and Electron), open the native dialog instead and hand the files back to the input's `change`
 * handler. Desktop webviews keep their built-in picker.
 */
export function nativeFilePicker(node: HTMLInputElement) {
  let picking = false;

  function open(event: MouseEvent): void {
    if (picking || event.defaultPrevented || (!electronBridge() && !isNativeMobile())) return;

    event.preventDefault();
    picking = true;
    void pickFiles(node.accept || '*/*')
      .then((picked) => {
        if (!picked || picked.length === 0) return;

        const transfer = new DataTransfer();
        for (const file of node.multiple ? picked : picked.slice(0, 1)) {
          transfer.items.add(file);
        }
        node.files = transfer.files;
        node.dispatchEvent(new Event('change', { bubbles: true }));
      })
      .catch((error: unknown) => {
        console.debug('[sable files] native picker hand-off failed', error);
      })
      .finally(() => {
        picking = false;
      });
  }

  node.addEventListener('click', open);

  return {
    destroy() {
      node.removeEventListener('click', open);
    },
  };
}
