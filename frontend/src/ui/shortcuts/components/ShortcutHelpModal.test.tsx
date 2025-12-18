import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShortcutHelpModal } from './ShortcutHelpModal';

const getAvailableShortcutsMock = vi.fn();
const setEnabledMock = vi.fn();

vi.mock('../context', () => ({
  useKeyboardContext: () => ({
    getAvailableShortcuts: getAvailableShortcutsMock,
    currentContext: { view: 'global' },
    setEnabled: setEnabledMock,
  }),
}));

describe('ShortcutHelpModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    getAvailableShortcutsMock.mockReset();
    setEnabledMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const renderModal = async (props: React.ComponentProps<typeof ShortcutHelpModal>) => {
    await act(async () => {
      root.render(<ShortcutHelpModal {...props} />);
      await Promise.resolve();
    });
  };

  it('renders shortcut groups when open', async () => {
    getAvailableShortcutsMock.mockReturnValue([
      {
        category: 'Global',
        shortcuts: [
          {
            key: '/',
            description: 'Open help',
            modifiers: { meta: true },
          },
          {
            key: 'ArrowUp',
            description: 'Move up',
          },
        ],
      },
    ]);

    await renderModal({ isOpen: true, onClose: vi.fn() });

    const groups = container.querySelectorAll('.shortcut-group');
    expect(groups).toHaveLength(1);
    expect(groups[0].querySelectorAll('.shortcut-item')).toHaveLength(2);
    expect(setEnabledMock).toHaveBeenCalledWith(false);
  });

  it('handles closing animation and re-enables shortcuts', async () => {
    vi.useFakeTimers();
    getAvailableShortcutsMock.mockReturnValue([]);
    const onClose = vi.fn();

    await renderModal({ isOpen: true, onClose });
    await renderModal({ isOpen: false, onClose });

    const overlay = container.querySelector('.shortcut-help-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain('closing');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(container.querySelector('.shortcut-help-modal-overlay')).toBeNull();
    expect(setEnabledMock).toHaveBeenCalledWith(true);
  });

  it('closes on Escape key press', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    getAvailableShortcutsMock.mockReturnValue([]);

    await renderModal({ isOpen: true, onClose });

    await act(async () => {
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escapeEvent);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
