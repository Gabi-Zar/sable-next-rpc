import { createContext } from 'svelte';

interface SettingsAnchors {
  link: (anchor: string) => string;
  highlighted: () => string | null;
}

const [getAnchors, setAnchors, hasAnchors] = createContext<SettingsAnchors>();

export function provideSettingsAnchors(anchors: SettingsAnchors): void {
  setAnchors(anchors);
}

export function settingsAnchors(): SettingsAnchors | undefined {
  return hasAnchors() ? getAnchors() : undefined;
}
