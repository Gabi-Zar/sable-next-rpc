export interface VoiceMediaRecorder {
  readonly mimeType: string;
  state: RecordingState;
  onstart: ((event: Event) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  ondataavailable: ((event: BlobEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

export interface VoiceRecordingSession {
  recorder: VoiceMediaRecorder;
  dispose: () => void;
}
