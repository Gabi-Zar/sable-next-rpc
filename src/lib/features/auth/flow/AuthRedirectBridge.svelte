<script lang="ts">
  import { onMount } from 'svelte';
  import { readText, removeLocalValue, writeText } from '#lib/platform/local-json.js';

  import {
    callbackChannelName,
    redirectLoginType,
    scrubbedCallbackPath,
  } from '#lib/auth/redirect.js';
  import {
    currentDeepLinks,
    deliversDeepLinks,
    subscribeDeepLinks,
  } from '#lib/platform/deep-links.js';

  interface Props {
    onCallback: (url: string) => void;
    onRegistrationComplete: () => void;
    onCallbackWindow: () => void;
  }

  let { onCallback, onRegistrationComplete, onCallbackWindow }: Props = $props();
  const HANDLED_CALLBACK_KEY = 'sable-handled-auth-callback';
  let removeDeepLinkListener: (() => void) | undefined;
  let disposed = false;

  function handOffCallbackWindow(callbackUrl: string): void {
    onCallbackWindow();
    const callbackChannel = new BroadcastChannel(callbackChannelName(callbackUrl, window.name));
    callbackChannel.postMessage(callbackUrl);
    callbackChannel.close();
    history.replaceState(history.state, '', scrubbedCallbackPath(callbackUrl));
    window.setTimeout(() => {
      window.close();
    }, 0);
  }

  function handleStorage(event: StorageEvent): void {
    if (event.key !== 'sable-registration-complete' || !event.newValue) return;
    removeLocalValue(event.key);
    onRegistrationComplete();
  }

  function handleCallback(url: string): void {
    if (url === readText(HANDLED_CALLBACK_KEY)) return;
    writeText(HANDLED_CALLBACK_KEY, url);
    onCallback(url);
  }

  async function watchDeepLinks(): Promise<void> {
    const unlisten = await subscribeDeepLinks((urls) => {
      const url = urls.find((candidate) => redirectLoginType(candidate));
      if (url) handleCallback(url);
    });

    if (disposed) {
      unlisten();
      return;
    }
    removeDeepLinkListener = unlisten;

    const url = (await currentDeepLinks()).find((candidate) => redirectLoginType(candidate));
    if (url) handleCallback(url);
  }

  onMount(() => {
    const callbackUrl = window.location.href;
    if (deliversDeepLinks()) void watchDeepLinks();
    else if (redirectLoginType(callbackUrl)) handOffCallbackWindow(callbackUrl);

    return () => {
      disposed = true;
      removeDeepLinkListener?.();
    };
  });
</script>

<svelte:window onstorage={handleStorage} />
