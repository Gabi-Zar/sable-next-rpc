import { expect, test, vi } from 'vitest';

const landed = vi.hoisted((): unknown[] => []);

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  addPluginListener: vi.fn(),
  invoke: vi.fn(async (_command: string, args: { roomId: string | null }) => {
    await new Promise((resolve) => setTimeout(resolve, args.roomId === null ? 20 : 0));
    landed.push(args.roomId);
  }),
}));
vi.mock('./os.js', () => ({ isAndroid: () => true }));

import { setNativeOpenConversation } from './native-notifications';

test('leaving one room never lands after opening the next', async () => {
  void setNativeOpenConversation(null, null);
  await setNativeOpenConversation('@me:example.org', '!next:example.org');

  expect(landed).toEqual([null, '!next:example.org']);
});
