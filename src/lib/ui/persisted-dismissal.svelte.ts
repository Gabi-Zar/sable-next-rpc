import { readText, writeText } from '#lib/platform/local-json.js';

export function persistedDismissal(key: string) {
  let dismissedFor = $state(readText(key));

  return {
    get dismissedFor() {
      return dismissedFor;
    },
    dismiss(id: string | null): void {
      dismissedFor = id;
      if (id !== null) writeText(key, id);
    },
  };
}
