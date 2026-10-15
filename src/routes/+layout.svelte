<script lang="ts">
  import { onMount } from 'svelte';
  import { on } from 'svelte/events';
  import type { Snippet } from 'svelte';
  import { isTauri } from '@tauri-apps/api/core';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { type as osType } from '@tauri-apps/plugin-os';
  import IconContext from 'phosphor-svelte/lib/IconContext';
  import '../styles.css';
  import { createCoreClient } from '#lib/core/client.svelte.js';
  import { provideCoreClient } from '#lib/core/context.js';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import TitleBar from '#lib/ui/TitleBar.svelte';
  import SessionRestoreError from '#lib/ui/SessionRestoreError.svelte';
  import AccountLocked from '#lib/features/sidebar/AccountLocked.svelte';
  import favicon from '#lib/assets/favicon.png';
  import { trackKeyboardInset } from '#lib/platform/keyboard.js';
  import { trackInspectorShortcut } from '#lib/platform/devtools.js';
  import { trackZoomShortcuts } from '#lib/platform/zoom-shortcuts.js';
  import { suppressNativeContextMenu } from '#lib/platform/context-menu.js';
  import { blockEdgeNavigation } from '#lib/platform/edge-navigation.js';
  import { systemDark } from '#lib/platform/system-theme.js';
  import { hostsServiceWorker, registerServiceWorker } from '#lib/platform/service-worker.js';
  import { notificationPermalink } from '#lib/features/notifications/notification-link.js';
  import { guardTouchClicks } from '#lib/ui/trailing-click.js';
  import {
    applyDesktopWindowSettings,
    setWindowFullscreen,
    supportsDesktopWindow,
    titleBarKind,
  } from '#lib/platform/window-decorations.js';
  import { runtimeConfig } from '#lib/config/runtime-config.js';
  import { applyDeploymentDefaults, preferences } from '#lib/settings/preferences.svelte.js';
  import {
    activeCustomThemeCss,
    activeTweakCss,
    hydrateCatalogThemes,
    updateCatalogThemes,
    themePreview,
  } from '#lib/settings/custom-themes.svelte.js';
  import {
    applyCustomTheme,
    applyCustomTweaks,
    applyFontFamily,
    applyQuickCss,
    applyTheme,
    resolveTheme,
  } from '#lib/settings/theme.js';
  import { shouldReduceMotion } from '#lib/ui/motion.js';
  import { ALERT_MODULES, provideAlertProviders } from '#lib/features/sidebar/alerts.js';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
  const core = createCoreClient();
  provideCoreClient(core);
  const alertProviders = ALERT_MODULES.map((component) => component.priorityProvider());
  provideAlertProviders(alertProviders);
  let titlebar = $derived(titleBarKind(preferences.useCustomTitleBar));

  onMount(() => {
    void hydrateCatalogThemes().then(updateCatalogThemes);

    if (isTauri()) {
      document.documentElement.dataset.tauriOs = osType();
    }

    const stopTrackingKeyboard = trackKeyboardInset();
    const stopGuardingClicks = guardTouchClicks();
    const stopInspectorShortcut = trackInspectorShortcut();
    const stopZoomShortcuts = trackZoomShortcuts();
    const stopSuppressingContextMenu = suppressNativeContextMenu();
    const stopBlockingEdgeNavigation = blockEdgeNavigation();
    void registerServiceWorker();
    void runtimeConfig().then((config) => {
      applyDeploymentDefaults(config.settingsDefaults);
    });
    void core.start();
    return () => {
      stopTrackingKeyboard();
      stopGuardingClicks();
      stopInspectorShortcut();
      stopZoomShortcuts();
      stopSuppressingContextMenu();
      stopBlockingEdgeNavigation();
      core.stop();
    };
  });

  $effect(() => {
    if (!hostsServiceWorker()) return;

    return on(navigator.serviceWorker, 'message', (event) => {
      if (page.route.id?.startsWith('/(app)')) return;
      const message = (event as MessageEvent).data as
        | { type?: string; roomId?: string; userId?: string; eventId?: string }
        | undefined;
      if (message?.type !== 'sable:open-room' || message.roomId === undefined) return;
      void goto(notificationPermalink(message.roomId, message.eventId, message.userId));
    });
  });

  $effect(() => {
    document.documentElement.dataset.clientDecorations = titlebar ?? 'off';

    void applyDesktopWindowSettings({
      closeToTray: preferences.closeToTray,
      minimizeToTray: preferences.minimizeToTray,
      showSystemTrayIcon: preferences.showSystemTrayIcon,
      useCustomTitleBar: preferences.useCustomTitleBar,
    }).catch((error: unknown) => {
      console.debug('[sable window] the desktop window settings were not applied', error);
    });
  });

  $effect(() => {
    document.documentElement.style.setProperty('--font-scale', String(preferences.pageZoom));
    document.documentElement.style.setProperty('--text-scale', String(preferences.textScale));
    document.documentElement.dataset.highContrast = preferences.highContrast ? 'on' : 'off';
    document.documentElement.dataset.reducedMotion = shouldReduceMotion() ? 'on' : 'off';
    document.documentElement.dataset.twitterEmoji = preferences.twitterEmoji ? 'on' : 'off';
    document.documentElement.dataset.blurMedia = preferences.blurMedia ? 'on' : 'off';
    document.documentElement.dataset.blurAvatars = preferences.blurAvatars ? 'on' : 'off';
    document.documentElement.dataset.blurEmotes = preferences.blurEmotes ? 'on' : 'off';
  });

  $effect(() => {
    const preview = themePreview.current;
    if (preview) {
      applyTheme(preview.kind, systemDark.current);
      applyCustomTheme(preview.css);
      return;
    }
    applyTheme(preferences.theme, systemDark.current);
    applyCustomTheme(activeCustomThemeCss(resolveTheme(preferences.theme, systemDark.current)));
  });

  $effect(() => {
    applyCustomTweaks(activeTweakCss());
  });

  $effect(() => {
    applyQuickCss(preferences.quickCss);
  });

  $effect(() => {
    applyFontFamily(preferences.fontFamily);
  });
</script>

<svelte:window ononline={() => void hydrateCatalogThemes()} />
<svelte:document
  onvisibilitychange={() => {
    if (document.visibilityState === 'visible') void updateCatalogThemes();
  }}
  onfullscreenchange={() => {
    if (!supportsDesktopWindow()) return;
    setWindowFullscreen(document.fullscreenElement !== null).catch((error: unknown) => {
      console.debug('[sable window] the window fullscreen state was not applied', error);
    });
  }}
/>

<svelte:head>
  <title>Sable</title>
  <link rel="icon" href={favicon} />
</svelte:head>

<!-- Icons ride along with a labelled control, so `role="img"` would only add a
     nameless node to the tree. -->
<IconContext values={{ 'aria-hidden': true }}>
  {#if titlebar}
    <TitleBar kind={titlebar} />
  {/if}

  <TooltipProvider>
    {#if core.accountLocked}
      <AccountLocked />
    {:else if core.restoreFailed}
      <SessionRestoreError />
    {:else}
      {@render children()}
    {/if}
  </TooltipProvider>
</IconContext>
