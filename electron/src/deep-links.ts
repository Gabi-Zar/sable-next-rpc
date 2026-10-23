// Keep callback schemes aligned with the builder configs and nativeRedirectUri.
export function deepLinkSchemes(identifier: string): string[] {
  return identifier === 'moe.sable.client' || identifier === 'moe.sable.client.sandboxed'
    ? ['moe.sable.app', 'sable']
    : ['moe.sable.next'];
}

export function deepLinksIn(argv: string[], schemes: string[]): string[] {
  return argv.filter((arg) => {
    try {
      const url = new URL(arg);
      return schemes.includes(url.protocol.slice(0, -1));
    } catch {
      return false;
    }
  });
}
