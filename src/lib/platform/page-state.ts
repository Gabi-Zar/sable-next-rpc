import { goto } from '$app/navigation';

/** Sets `page.state` on the current URL without navigating. */
export function setPageState(state: App.PageState, replace = false): Promise<void> {
  // The rule exempts the current URL ('') only for the deprecated pushState/replaceState.
  // eslint-disable-next-line svelte/no-navigation-without-resolve
  return goto('', { shallow: true, replace, state });
}
