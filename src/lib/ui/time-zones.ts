export const SYSTEM_TIME_ZONE = 'auto';

export function timeZoneValues(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return [SYSTEM_TIME_ZONE, ...(zones.includes('UTC') ? zones : ['UTC', ...zones])];
  } catch {
    return [SYSTEM_TIME_ZONE, 'UTC'];
  }
}
