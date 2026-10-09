import * as DesktopUpdateAlert from '#lib/ui/DesktopUpdateAlert.svelte';
import * as RecoveryIncompleteAlert from '#lib/ui/RecoveryIncompleteAlert.svelte';
import * as UnverifiedDeviceAlert from '#lib/ui/UnverifiedDeviceAlert.svelte';
import * as WebUpdateAlert from '#lib/ui/WebUpdateAlert.svelte';
import { createContext, type Component } from 'svelte';

export type Priority = null | 'update' | 'warning' | 'security';

// Banner modules export a function returning a priority provider, which decides when the banner renders and is passed back in its props.

export type PriorityProvider<S = object> = { get priority(): Priority; dismiss(): void } & S;

type BannerModule<S> = {
  default: Component<PriorityProvider<S>>;
  priorityProvider(): PriorityProvider<S>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ALERT_MODULES: BannerModule<any>[] = [
  UnverifiedDeviceAlert,
  RecoveryIncompleteAlert,
  WebUpdateAlert,
  DesktopUpdateAlert,
];

export const [useAlertProviders, provideAlertProviders] =
  createContext<PriorityProvider<unknown>[]>();
