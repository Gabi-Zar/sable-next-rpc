export const server = (process.env.FORGEJO_URL ?? 'https://git.sable.moe').replace(/\/+$/, '');
export const repository = process.env.FORGEJO_REPOSITORY ?? 'SableClient/sable-next';

export async function forgejo(method, path, { json, body, allow404 = false } = {}) {
  const token = process.env.FORGEJO_TOKEN;
  if (!token) throw new Error('FORGEJO_TOKEN is required');
  const response = await fetch(`${server}/api/v1/repos/${repository}${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      ...(json !== undefined && { 'Content-Type': 'application/json' }),
    },
    ...(json === undefined ? body && { body } : { body: JSON.stringify(json) }),
  });
  if (response.status === 404 && allow404) return undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
