import type { UpdateChannel, WebRtcIpPolicy } from '#lib/settings/preferences.svelte.js';
import type { ScreenAudioChoice } from './screen-audio-stream';
import type { ScreenAudioListing } from './screen-audio-types';
import type { DesktopWindowSettings, DesktopWindowState } from './window-decorations';

export interface ElectronSettings {
  hardwareAcceleration: boolean;
  hardwareVideoAcceleration: boolean;
  smoothScrolling: boolean;
  webRtcIpPolicy: WebRtcIpPolicy;
  updateChannel: UpdateChannel;
}

export interface ScreenShareCandidate {
  id: string;
  name: string;
  thumbnail: string;
}

export interface ElectronBridge {
  platform: string;
  applyWindowSettings(settings: DesktopWindowSettings): Promise<DesktopWindowState | null>;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  isWindowMaximized(): Promise<boolean>;
  onWindowMaximized(callback: (maximized: boolean) => void): () => void;
  applySettings(settings: ElectronSettings): void;
  setTelemetryConsent(enabled: boolean): void;
  takeDeepLinks(): Promise<string[]>;
  onDeepLinks(callback: (urls: string[]) => void): () => void;
  screenAudioApps(): Promise<ScreenAudioListing>;
  startScreenAudio(selection: Exclude<ScreenAudioChoice, { kind: 'none' }>): Promise<string>;
  stopScreenAudio(): Promise<void>;
  unmuteScreenAudio(): Promise<void>;
  checkForUpdate(): Promise<{ version: string; notes: string | undefined } | null>;
  downloadUpdate(onProgress: (percent: number) => void): Promise<void>;
  installUpdate(): Promise<void>;
  onScreenSharePick(pick: (sources: ScreenShareCandidate[]) => Promise<string | null>): () => void;
}

export function electronBridge(): ElectronBridge | undefined {
  return (globalThis as { sableElectron?: ElectronBridge }).sableElectron;
}

export function isElectron(): boolean {
  return electronBridge() !== undefined;
}
