import type { WebRtcIpPolicy } from '#lib/settings/preferences.svelte.js';
import type { ScreenAudioChoice } from './screen-audio-stream';
import type { DesktopWindowSettings, DesktopWindowState } from './window-decorations';

export interface ElectronSettings {
  hardwareAcceleration: boolean;
  hardwareVideoAcceleration: boolean;
  webRtcIpPolicy: WebRtcIpPolicy;
}

export interface ScreenShareCandidate {
  id: string;
  name: string;
  thumbnail: string;
}

export interface ElectronBridge {
  platform: string;
  applyWindowSettings(settings: DesktopWindowSettings): Promise<DesktopWindowState | null>;
  applySettings(settings: ElectronSettings): void;
  takeDeepLinks(): Promise<string[]>;
  onDeepLinks(callback: (urls: string[]) => void): () => void;
  screenAudioApps(): Promise<string[]>;
  startScreenAudio(selection: Exclude<ScreenAudioChoice, { kind: 'none' }>): Promise<string>;
  stopScreenAudio(): Promise<void>;
  onScreenSharePick(pick: (sources: ScreenShareCandidate[]) => Promise<string | null>): () => void;
}

export function electronBridge(): ElectronBridge | undefined {
  return (globalThis as { sableElectron?: ElectronBridge }).sableElectron;
}

export function isElectron(): boolean {
  return electronBridge() !== undefined;
}
