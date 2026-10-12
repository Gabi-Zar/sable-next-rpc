import type { CoreCommands } from '#lib/core/commands.svelte.js';

export const ADDED_SERVERS_ACCOUNT_DATA_TYPE = 'moe.sable.added_servers';

const SERVER_NAME = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

type ServersApi = Pick<CoreCommands, 'accountData' | 'setAccountData'>;

export function isServerName(value: string): boolean {
  return SERVER_NAME.test(value);
}

function addedServers(content: unknown): string[] {
  if (typeof content !== 'object' || content === null) return [];
  const servers = (content as { servers?: unknown }).servers;
  return Array.isArray(servers)
    ? servers.filter((server): server is string => typeof server === 'string')
    : [];
}

function sameServer(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export async function readAddedServers(commands: ServersApi): Promise<string[]> {
  return addedServers(await commands.accountData(ADDED_SERVERS_ACCOUNT_DATA_TYPE));
}

export async function addServer(commands: ServersApi, server: string): Promise<string[]> {
  const current = await readAddedServers(commands);
  if (current.some((entry) => sameServer(entry, server))) return current;
  const servers = [...current, server];
  await commands.setAccountData(ADDED_SERVERS_ACCOUNT_DATA_TYPE, { servers });
  return servers;
}

export async function removeServer(commands: ServersApi, server: string): Promise<string[]> {
  const servers = (await readAddedServers(commands)).filter((entry) => !sameServer(entry, server));
  await commands.setAccountData(ADDED_SERVERS_ACCOUNT_DATA_TYPE, { servers });
  return servers;
}

export function exploreServers(
  own: string | null,
  featured: readonly string[],
  added: readonly string[]
): string[] {
  const servers: string[] = own ? [own] : [];
  for (const server of [...featured, ...added]) {
    if (!servers.some((entry) => sameServer(entry, server))) servers.push(server);
  }
  return servers;
}
