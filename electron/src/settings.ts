import type { WebContents } from 'electron';
import { readFileSync } from 'node:fs';

type WebRtcIpPolicy = Parameters<WebContents['setWebRTCIPHandlingPolicy']>[0];

const WEBRTC_IP_POLICIES: readonly WebRtcIpPolicy[] = [
  'default',
  'default_public_and_private_interfaces',
  'default_public_interface_only',
  'disable_non_proxied_udp',
];

export interface Settings {
  hardwareAcceleration: boolean;
  hardwareVideoAcceleration: boolean;
  smoothScrolling: boolean;
  webRtcIpPolicy: WebRtcIpPolicy;
}

const DEFAULTS: Settings = {
  hardwareAcceleration: true,
  hardwareVideoAcceleration: true,
  smoothScrolling: true,
  webRtcIpPolicy: 'default',
};

export function sanitize(value: unknown): Settings {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const flag = (key: 'hardwareAcceleration' | 'hardwareVideoAcceleration' | 'smoothScrolling') =>
    typeof stored[key] === 'boolean' ? stored[key] : DEFAULTS[key];
  const policy = WEBRTC_IP_POLICIES.find((candidate) => candidate === stored.webRtcIpPolicy);

  return {
    hardwareAcceleration: flag('hardwareAcceleration'),
    hardwareVideoAcceleration: flag('hardwareVideoAcceleration'),
    smoothScrolling: flag('smoothScrolling'),
    webRtcIpPolicy: policy ?? DEFAULTS.webRtcIpPolicy,
  };
}

export function readSettings(path: string): Settings {
  try {
    return sanitize(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return DEFAULTS;
  }
}
