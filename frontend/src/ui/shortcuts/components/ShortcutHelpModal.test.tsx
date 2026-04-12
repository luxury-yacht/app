/**
 * frontend/src/ui/shortcuts/components/ShortcutHelpModal.test.tsx
 *
 * Test suite for ShortcutHelpModal.
 * Covers key behaviors and edge cases for ShortcutHelpModal.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShortcutHelpModal } from './ShortcutHelpModal';

const getAvailableShortcutsMock = vi.fn();
const useKeyboardSurfaceMock = vi.fn();

vi.mock('../context', () => ({
  useKeyboardContext: () => ({
    getAvailableShortcuts: getAvailableShortcutsMock,
    currentContext: { view: 'global' },
    registerSurface: vi.fn(),
    unregisterSurface: vi.fn(),
    updateSurface: vi.fn(),
    dispatchNativeAction: vi.fn().mockReturnValue(false),
  }),
  useOptionalKeyboardContext: () => null,
}));

vi.mock('../surfaces', () => ({
  useKeyboardSurface: (...args: unknown[]) => useKeyboardSurfaceMock(...args),
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
    useKeyboardSurfaceMock.mockReset();
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

    const groups = document.querySelectorAll('.shortcut-group');
    expect(groups).toHaveLength(1);
    expect(groups[0].querySelectorAll('.shortcut-item')).toHaveLength(2);
    expect(document.querySelector('.shortcut-help-modal')?.getAttribute('role')).toBe('dialog');
    expect(useKeyboardSurfaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'modal',
        blocking: true,
        suppressShortcuts: true,
      })
    );
  });

  it('handles closing animation and re-enables shortcuts', async () => {
    vi.useFakeTimers();
    getAvailableShortcutsMock.mockReturnValue([]);
    const onClose = vi.fn();

    await renderModal({ isOpen: true, onClose });
    await renderModal({ isOpen: false, onClose });

    const overlay = document.querySelector('.shortcut-help-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain('closing');

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(document.querySelector('.shortcut-help-modal-overlay')).toBeNull();
  });

  it('closes on Escape key press', async () => {
    const onClose = vi.fn();
    getAvailableShortcutsMock.mockReturnValue([]);

    await renderModal({ isOpen: true, onClose });

    const surfaceOptions =
      useKeyboardSurfaceMock.mock.calls[useKeyboardSurfaceMock.mock.calls.length - 1]?.[0];
    expect(surfaceOptions).toBeTruthy();
    surfaceOptions.onEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on slash through the modal surface handler', async () => {
    const onClose = vi.fn();
    getAvailableShortcutsMock.mockReturnValue([]);

    await renderModal({ isOpen: true, onClose });

    const surfaceOptions =
      useKeyboardSurfaceMock.mock.calls[useKeyboardSurfaceMock.mock.calls.length - 1]?.[0];
    expect(surfaceOptions).toBeTruthy();
    expect(surfaceOptions.onKeyDown({ key: '/' })).toBe(true);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
