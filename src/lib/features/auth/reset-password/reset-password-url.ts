import { resolve } from '$app/paths';

const ADD_ACCOUNT = '?addAccount=1';

export function resetPasswordHref(homeserver: string, addAccount = false): string {
  const server = `server=${encodeURIComponent(homeserver.trim())}`;
  return resolve(`reset-password?${addAccount ? 'addAccount=1&' : ''}${server}`);
}

export function loginHref(
  homeserver: string,
  defaultHomeserver: string,
  addAccount = false
): string {
  const server = homeserver.trim();
  const suffix = addAccount ? ADD_ACCOUNT : '';
  if (!server || server === defaultHomeserver || /[/?#]/.test(server)) {
    return resolve('login') + suffix;
  }
  return resolve('/(auth)/login/[homeserver]', { homeserver: encodeURIComponent(server) }) + suffix;
}
