import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ObjPanelLogsSettingsModal from './ObjPanelLogsSettingsModal';
import ObjPanelLogsSettings from '@modules/object-panel/components/ObjectPanel/Logs/ObjPanelLogsSettings';
import { KeyboardProvider } from '@ui/shortcuts';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Logs/ObjPanelLogsSettings', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="obj-panel-logs-settings-content" />),
}));

describe('ObjPanelLogsSettingsModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ObjPanelLogsSettingsModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('closes on Escape through the shared modal surface', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjPanelLogsSettingsModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via overlay click but ignores clicks inside the modal', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjPanelLogsSettingsModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });

    const overlay = document.querySelector(
      '.obj-panel-logs-settings-modal-overlay'
    ) as HTMLDivElement | null;
    const modal = document.querySelector('.obj-panel-logs-settings-modal') as HTMLDivElement | null;

    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('maintains closing animation before unmounting and restores scroll lock', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjPanelLogsSettingsModal isOpen onClose={onClose} />
        </KeyboardProvider>
      );
    });
    expect(document.body.style.overflow).toBe('hidden');

    act(() => {
      root.render(
        <KeyboardProvider>
          <ObjPanelLogsSettingsModal isOpen={false} onClose={onClose} />
        </KeyboardProvider>
      );
    });

    expect(
      document.querySelector('.obj-panel-logs-settings-modal')?.classList.contains('closing')
    ).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(document.querySelector('.obj-panel-logs-settings-modal')).toBeNull();
    expect(document.body.style.overflow).toBe('');

    vi.useRealTimers();
  });

  it('renders Object Panel Logs Tab Settings content on open', async () => {
    const logSettingsSpy = vi.mocked(ObjPanelLogsSettings);
    logSettingsSpy.mockClear();

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ObjPanelLogsSettingsModal isOpen onClose={vi.fn()} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(logSettingsSpy).toHaveBeenCalled();
  });
});
