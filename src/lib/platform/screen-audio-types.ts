export interface ScreenAudioApp {
  id: string;
  label: string;
}

export interface ScreenAudioListing {
  apps: ScreenAudioApp[];
  status: 'available' | 'pipewire-pulse-missing' | 'unavailable' | 'incompatible';
}
