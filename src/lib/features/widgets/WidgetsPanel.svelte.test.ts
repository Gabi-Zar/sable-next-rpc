// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableIframePageLoading": true } }

import { screen, within } from '@testing-library/svelte';
import { renderWithTooltips } from '#lib/test-support/render-with-tooltips.js';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('#lib/core/context.js');

import { core } from '#lib/core/__mocks__/context.js';

core.session = { account_id: 'a', user_id: '@erwan:example.org', device_id: 'DEV' };

import IntegrationManagerDialog from './IntegrationManagerDialog.svelte';
import WidgetsPanel from './WidgetsPanel.svelte';
import type { RoomWidget } from './widget-content.js';

afterEach(() => {
  localStorage.clear();
});

const widgets: RoomWidget[] = [
  {
    id: 'widget-1',
    type: 'm.custom',
    url: 'https://widget.example/app?user=$matrix_user_id&wid=$matrix_widget_id',
    name: 'Jitsi',
    data: {},
  },
  {
    id: 'widget-2',
    type: 'm.custom',
    url: 'https://other.example/app',
    name: 'Other',
    data: {},
  },
];

const commonProps = {
  roomId: '!room:example.org',
  userId: '@erwan:example.org',
  displayName: 'Erwan',
  avatarUrl: 'mxc://example.org/avatar',
};

const panel = () => screen.getByRole('complementary', { name: 'Widgets' });

test('shows an empty message when there are no widgets', () => {
  const { container } = renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets: [],
    onClose: vi.fn(),
  });

  expect(screen.getByText('This room has no widgets.')).toBeInTheDocument();
  expect(container.querySelector('iframe')).not.toBeInTheDocument();
});

test('lists the widgets without starting any', () => {
  const { container } = renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets,
    onClose: vi.fn(),
  });

  expect(screen.getByRole('button', { name: 'Jitsi' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Other' })).toBeInTheDocument();
  expect(container.querySelector('iframe')).not.toBeInTheDocument();
});

test('renders a sandboxed iframe for the chosen widget, templated', async () => {
  const user = userEvent.setup();
  renderWithTooltips(WidgetsPanel, { ...commonProps, widgets, onClose: vi.fn() });
  await user.click(screen.getByRole('button', { name: 'Jitsi' }));

  const iframe = screen.getByTitle<HTMLIFrameElement>('Jitsi');
  expect(iframe.tagName).toBe('IFRAME');
  expect(iframe).toHaveAttribute('sandbox', expect.stringContaining('allow-scripts'));
  expect(iframe).toHaveAttribute('allow', expect.stringContaining('camera'));
  const src = new URL(iframe.src);
  expect(src.searchParams.get('user')).toBe(commonProps.userId);
  expect(src.searchParams.get('wid')).toBe('widget-1');
});

test('the back button stops the widget and returns to the list', async () => {
  const user = userEvent.setup();
  const { container } = renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets,
    onClose: vi.fn(),
  });

  await user.click(screen.getByRole('button', { name: 'Other' }));
  expect(screen.getByTitle('Other').tagName).toBe('IFRAME');

  await user.click(screen.getByRole('button', { name: 'Back to widgets' }));

  expect(container.querySelector('iframe')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Jitsi' })).toBeInTheDocument();
});

test('shows a remove action only when the caller can manage widgets', async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets,
    canManage: true,
    onClose: vi.fn(),
    onRemove,
  });

  await user.click(within(panel()).getByRole('button', { name: 'Remove Jitsi' }));
  expect(onRemove).not.toHaveBeenCalled();

  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Remove Jitsi' }));

  expect(onRemove).toHaveBeenCalledWith('widget-1');
});

test('omits the remove action when the caller cannot manage widgets', () => {
  renderWithTooltips(WidgetsPanel, { ...commonProps, widgets, canManage: false, onClose: vi.fn() });

  expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
});

test('calls onClose from the close button', async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  renderWithTooltips(WidgetsPanel, { ...commonProps, widgets, onClose });

  await user.click(screen.getByRole('button', { name: 'Close widgets' }));
  expect(onClose).toHaveBeenCalled();
});

test('resizes the side panel and reopens at that width', async () => {
  const user = userEvent.setup();
  const props = { ...commonProps, widgets: [], onClose: vi.fn() };
  const first = renderWithTooltips(WidgetsPanel, props);

  screen.getByRole('slider', { name: 'Resize widgets' }).focus();
  await user.keyboard('{ArrowLeft}');
  expect(panel().style.width).toBe('23rem');
  first.unmount();

  renderWithTooltips(WidgetsPanel, props);
  expect(panel().style.width).toBe('23rem');
});

test('leaves the drawer variant unresizable', () => {
  renderWithTooltips(WidgetsPanel, { ...commonProps, widgets: [], modal: true, onClose: vi.fn() });

  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});

test('a manager adds a widget by name and URL, and an invalid URL cannot be submitted', async () => {
  const onAdd = vi.fn().mockResolvedValue(undefined);
  renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets: [],
    canManage: true,
    onAdd,
    onClose: vi.fn(),
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add custom widget' }));
  const add = screen.getByRole('button', { name: 'Add widget' });

  await user.type(screen.getByLabelText('Widget name'), 'Doom');
  await user.type(screen.getByLabelText(/Widget URL/), 'not a url');
  expect(add).toBeDisabled();

  await user.clear(screen.getByLabelText(/Widget URL/));
  await user.type(screen.getByLabelText(/Widget URL/), 'https://doom.example/play');
  await user.click(add);

  expect(onAdd).toHaveBeenCalledWith('Doom', 'https://doom.example/play');
});

test('a non-manager sees no add form', () => {
  renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets: [],
    onAdd: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.queryByLabelText('Widget name')).not.toBeInTheDocument();
});

test('the integration manager opens from the manager actions', async () => {
  const integrationManagerUrl = vi.fn().mockReturnValue(new Promise(() => undefined));
  const integrationManagerTerms = vi.fn().mockResolvedValue([]);
  (core as unknown as Record<string, unknown>).rpc = {
    session: { integrationManagerUrl, integrationManagerTerms },
  };
  renderWithTooltips(WidgetsPanel, {
    ...commonProps,
    widgets: [],
    canManage: true,
    onAdd: vi.fn(),
    onClose: vi.fn(),
  });
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Integration manager' }));

  await vi.waitFor(() => {
    expect(integrationManagerUrl).toHaveBeenCalledWith({ room_id: '!room:example.org' });
  });
});

test('the integration manager closes when its own origin asks to', async () => {
  const integrationManagerUrl = vi.fn().mockResolvedValue('https://manager.example/open');
  const integrationManagerTerms = vi.fn().mockResolvedValue([]);
  (core as unknown as Record<string, unknown>).rpc = {
    session: { integrationManagerUrl, integrationManagerTerms },
  };
  const onClose = vi.fn();
  renderWithTooltips(IntegrationManagerDialog, {
    open: true,
    roomId: '!room:example.org',
    onClose,
  });
  await vi.waitFor(() => {
    expect(screen.getByTitle('Integration manager')).toBeInTheDocument();
  });

  const send = (origin: string) =>
    window.dispatchEvent(new MessageEvent('message', { origin, data: { action: 'close_scalar' } }));
  send('https://elsewhere.example');
  expect(onClose).not.toHaveBeenCalled();
  send('https://manager.example');
  expect(onClose).toHaveBeenCalledOnce();
});

test('the integration manager asks for its terms before opening', async () => {
  const integrationManagerUrl = vi.fn().mockResolvedValue('https://manager.example/open');
  const integrationManagerTerms = vi
    .fn()
    .mockResolvedValue([{ url: 'https://manager.example/tos', name: 'Terms of Service' }]);
  const acceptIntegrationManagerTerms = vi.fn().mockResolvedValue(null);
  (core as unknown as Record<string, unknown>).rpc = {
    session: { integrationManagerUrl, integrationManagerTerms, acceptIntegrationManagerTerms },
  };
  renderWithTooltips(IntegrationManagerDialog, {
    open: true,
    roomId: '!room:example.org',
    onClose: vi.fn(),
  });
  const user = userEvent.setup();

  expect(await screen.findByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
    'href',
    'https://manager.example/tos'
  );
  expect(integrationManagerUrl).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Accept' }));

  expect(acceptIntegrationManagerTerms).toHaveBeenCalledWith({
    urls: ['https://manager.example/tos'],
  });
  await vi.waitFor(() => {
    expect(screen.getByTitle('Integration manager')).toBeInTheDocument();
  });
});

test('the integration manager stays on its terms when accepting fails', async () => {
  const integrationManagerUrl = vi.fn().mockResolvedValue('https://manager.example/open');
  const integrationManagerTerms = vi
    .fn()
    .mockResolvedValue([{ url: 'https://manager.example/tos', name: 'Terms of Service' }]);
  const acceptIntegrationManagerTerms = vi.fn().mockRejectedValue(new Error('refused'));
  (core as unknown as Record<string, unknown>).rpc = {
    session: { integrationManagerUrl, integrationManagerTerms, acceptIntegrationManagerTerms },
  };
  renderWithTooltips(IntegrationManagerDialog, {
    open: true,
    roomId: '!room:example.org',
    onClose: vi.fn(),
  });
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: 'Accept' }));

  expect(await screen.findByText('Could not record your acceptance. Try again.')).toBeVisible();
  expect(integrationManagerUrl).not.toHaveBeenCalled();
});
