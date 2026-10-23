export type AudioRequest = { id: number; rootPid: number } & (
  | { command: 'list' }
  | { command: 'start'; include: string[] }
  | { command: 'stop' }
);

export type AudioResponse =
  | { type: 'reply'; id: number; value?: string[]; error?: string }
  | { type: 'frames'; data: Uint8Array };
