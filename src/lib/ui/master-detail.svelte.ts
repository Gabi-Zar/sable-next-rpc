import { AppLayout } from './app-layout.svelte.js';

export function createMasterDetail<T extends string>(
  section: () => T | null,
  fallback: () => T | null
) {
  const appLayout = new AppLayout();
  const desktop = $derived(appLayout.current);
  const openSection = $derived(section() ?? (desktop ? fallback() : null));
  const showList = $derived(desktop || section() === null);
  const showContent = $derived(desktop || section() !== null);

  return {
    get desktop() {
      return desktop;
    },
    get openSection() {
      return openSection;
    },
    get showList() {
      return showList;
    },
    get showContent() {
      return showContent;
    },
  };
}
