import type { CallIntent, CallMode, CallModeReason, Rpc } from '#src/generated/protocol';

export type CallGrant = {
  session: number;
  url: string;
  jwt: string;
  identity: string;
  encryptMedia: boolean;
  mode?: 'legacy' | 'compatibility' | 'matrix_2';
  modeReason?: CallModeReason;
  stickyAvailable?: boolean;
  peerModes?: CallMode[];
  canPublish?: boolean;
  publisherId?: string;
  backends?: CallBackendGrant[];
};

export type CallBackendGrant = { id: string; url: string; jwt: string; identity: string };

export async function joinCall(
  rpc: Rpc,
  roomId: string,
  livekitServiceUrl: string | null = null,
  mode: CallMode | null = null,
  intent: CallIntent | null = null
): Promise<CallGrant> {
  const response = await rpc.calls.joinCall({
    room_id: roomId,
    livekit_service_url: livekitServiceUrl,
    mode: mode ?? null,
    intent,
  });
  return {
    session: response.session,
    url: response.url,
    jwt: response.jwt,
    identity: response.identity,
    encryptMedia: response.encrypt_media,
    mode: response.mode,
    modeReason: response.mode_reason,
    stickyAvailable: response.sticky_available,
    peerModes: response.peer_modes,
    canPublish: response.can_publish,
    publisherId: response.publisher_id,
    backends: response.backends,
  };
}
