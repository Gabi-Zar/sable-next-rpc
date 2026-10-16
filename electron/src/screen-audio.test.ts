import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const native = vi.hoisted(() => ({
  load: vi.fn(),
  hasPipeWire: vi.fn(() => true),
  list: vi.fn<() => Record<string, string>[]>(() => []),
  link: vi.fn(() => true),
  unlink: vi.fn(),
  unmute: vi.fn(),
}));
vi.mock('electron', () => ({ app: { getAppMetrics: () => [{ name: 'Audio Service', pid: 42 }] } }));
vi.mock('node:module', () => ({ createRequire: () => native.load }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('__dirname', '/native');
  native.hasPipeWire.mockReturnValue(true);
  native.list.mockReturnValue([]);
  native.link.mockReturnValue(true);
  native.load.mockImplementation(() => ({
    PatchBay: class {
      static hasPipeWire = native.hasPipeWire;
      list = native.list;
      link = native.link;
      unlink = native.unlink;
      unmute = native.unmute;
    },
  }));
});

afterEach(() => vi.unstubAllGlobals());

test('distinguishes backend load failures from an empty source list', async () => {
  native.load.mockImplementation(() => {
    throw new Error('missing addon');
  });
  const audio = await import('./screen-audio');
  expect(audio.listApps()).toEqual({ apps: [], status: 'unavailable' });
});

test('reports incompatible system runtimes', async () => {
  native.load.mockImplementation(() => {
    throw new Error('GLIBCXX_3.4.32 not found');
  });
  const audio = await import('./screen-audio');
  expect(audio.listApps().status).toBe('incompatible');
});

test('allows native PipeWire streams without pipewire-pulse', async () => {
  native.hasPipeWire.mockReturnValue(false);
  const audio = await import('./screen-audio');
  expect(audio.listApps().status).toBe('pipewire-pulse-missing');
  audio.start({ kind: 'system', exclude: [] });
  expect(native.link).toHaveBeenCalled();
});

test('keeps same-name streams distinct and excludes the call and input devices', async () => {
  const output = { 'application.name': 'Firefox', 'media.class': 'Stream/Output/Audio' };
  native.list.mockReturnValue([
    { ...output, 'application.process.id': '10', 'node.name': 'firefox-10', 'media.name': 'Music' },
    { ...output, 'application.process.id': '20', 'node.name': 'firefox-20', 'media.name': 'Video' },
    { ...output, 'application.process.id': '42' },
    { ...output, 'media.class': 'Stream/Input/Audio' },
    { ...output, 'device.id': '3' },
  ]);
  const audio = await import('./screen-audio');
  const { apps } = audio.listApps();
  expect(apps.map((app) => app.label)).toEqual(['Firefox (Music · 10)', 'Firefox (Video · 20)']);
  expect(apps[0].id).not.toBe(apps[1].id);
  audio.start({ kind: 'apps', include: [apps[1].id] });
  expect(native.link).toHaveBeenCalledWith(
    expect.objectContaining({
      include: [
        {
          'application.name': 'Firefox',
          'application.process.id': '20',
          'node.name': 'firefox-20',
          'media.name': 'Video',
        },
      ],
    })
  );
});

test('starts muted and ignores unmute after stopping', async () => {
  const audio = await import('./screen-audio');
  audio.start({ kind: 'system', exclude: ['Spotify'] });
  expect(native.link).toHaveBeenCalledWith({
    mute: true,
    exclude: [
      { 'application.process.id': '42' },
      { 'media.class': 'Stream/Input/Audio' },
      { 'application.name': 'Spotify' },
    ],
    workaround: [],
  });
  expect(native.unmute).not.toHaveBeenCalled();
  audio.unmute();
  expect(native.unmute).toHaveBeenCalledOnce();
  audio.stop();
  audio.unmute();
  expect(native.unmute).toHaveBeenCalledOnce();
  expect(native.unlink).toHaveBeenCalledOnce();
});

test('enables the microphone workaround only when requested', async () => {
  const audio = await import('./screen-audio');
  audio.start({ kind: 'apps', include: ['mpv'], workaround: true });
  expect(native.link).toHaveBeenCalledWith(
    expect.objectContaining({
      workaround: [{ 'application.process.id': '42', 'media.name': 'RecordStream' }],
    })
  );
});

test('rejects empty and malformed source selections', async () => {
  const audio = await import('./screen-audio');
  expect(() => audio.start({ kind: 'apps', include: [] })).toThrow('no audio source selected');
  expect(() => audio.start({ kind: 'apps', include: ['pipewire:{}'] })).toThrow(
    'invalid audio source'
  );
  expect(native.link).not.toHaveBeenCalled();
});

test('cleans up a failed link without unmuting it', async () => {
  native.link.mockReturnValue(false);
  const audio = await import('./screen-audio');
  expect(() => audio.start({ kind: 'system', exclude: [] })).toThrow(
    'screen audio could not be linked'
  );
  expect(native.unlink).toHaveBeenCalledOnce();
  audio.unmute();
  expect(native.unmute).not.toHaveBeenCalled();
});
