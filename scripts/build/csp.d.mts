export function browserCsp(directives: Record<string, string>): Record<string, string>;
export function inlineScripts(html: string): string[];
export function cspHeader(directives: Record<string, string>, scripts?: string[]): string;
export function writeCspHeaders(
  directory: string,
  directives: Record<string, string>
): Promise<void>;
