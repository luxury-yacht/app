/**
 * frontend/src/ui/status/UpdateStatus.test.tsx
 *
 * Covers the header update chip: it appears only for the states that need the
 * user's attention, carries no hover surface of its own, and opens About on
 * click. Release detail (versions, notes, links) belongs to the About modal, so
 * the chip must not render or fetch any of it.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readAppInfoMock, browserOpenURLMock, setIsAboutOpenMock } = vi.hoisted(() => ({
  readAppInfoMock: vi.fn(),
  browserOpenURLMock: vi.fn(),
  setIsAboutOpenMock: vi.fn(),
}));

vi.mock('@/core/app-state-access', () => ({
  requestAppState: ({ read }: { read: () => unknown }) => Promise.resolve(read()),
  readAppInfo: () => readAppInfoMock(),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: vi.fn(() => () => undefined),
  openURL: (...args: unknown[]) => browserOpenURLMock(...args),
}));

vi.mock('@core/contexts/ModalStateContext', () => ({
  useModalState: () => ({ setIsAboutOpen: setIsAboutOpenMock }),
}));

import UpdateStatus from './UpdateStatus';

describe('UpdateStatus', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    readAppInfoMock.mockReset();
    browserOpenURLMock.mockReset();
    setIsAboutOpenMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderAndSettle = async () => {
    await act(async () => {
      root.render(null);
    });
    await act(async () => {
      root.render(<UpdateStatus />);
    });
    // Flush the app-info promise + the resulting state update.
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders a bare clickable chip that opens About and carries no hover surface', async () => {
    readAppInfoMock.mockResolvedValue({
      update: {
        status: 'available',
        currentVersion: '1.10.0',
        availableVersion: '1.10.1',
        publishedAt: '2026-07-05T12:00:00Z',
        releaseNotes: '- Fixed metrics permission notice\n- Moved the update chip to the header',
        canInstall: true,
      },
    });

    await renderAndSettle();

    const chip = container.querySelector(
      '[data-testid="update-status-chip"]'
    ) as HTMLButtonElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('Update available');

    // The chip is the whole surface: no tooltip wrapper, and none of the release
    // detail that used to hang off it. That detail now lives in the About modal.
    expect(container.querySelector('.tooltip-wrapper')).toBeNull();
    expect(container.querySelector('[class*="tooltip"]')).toBeNull();
    expect(container.textContent).not.toContain('1.10.1');
    expect(container.textContent).not.toContain('2026-07-05');
    expect(container.textContent).not.toContain('Fixed metrics permission notice');
    expect(container.textContent).not.toContain('Full release notes');

    // Clicking opens About; it never starts a download, opens a URL, or
    // otherwise bypasses the app-owned update workflow.
    act(() => {
      chip?.click();
    });
    expect(setIsAboutOpenMock).toHaveBeenCalledWith(true);
    expect(browserOpenURLMock).not.toHaveBeenCalled();
  });

  it('renders nothing when no update is available', async () => {
    readAppInfoMock.mockResolvedValue({ update: { status: 'current' } });

    await renderAndSettle();

    expect(container.querySelector('[data-testid="update-status-chip"]')).toBeNull();
  });

  it('covers renders compact parameterized state and opens About cases', async () => {
    for (const [status, label] of [
      ['downloading', 'Downloading update…'],
      ['verifying', 'Verifying update…'],
      ['preparing', 'Preparing update…'],
      ['ready', 'Restart to update'],
      ['check-error', 'Update needs attention'],
      ['prepare-error', 'Update needs attention'],
      ['restart-error', 'Update needs attention'],
      ['apply-error', 'Update needs attention'],
    ]) {
      readAppInfoMock.mockResolvedValue({ update: { status, availableVersion: '1.10.1' } });

      await renderAndSettle();

      const chip = container.querySelector(
        '[data-testid="update-status-chip"]'
      ) as HTMLButtonElement;
      expect(chip.textContent).toContain(label);
      act(() => chip.click());
      expect(setIsAboutOpenMock).toHaveBeenCalledWith(true);
    }
  });

  it('covers stays out of the header for parameterized cases', async () => {
    for (const status of ['disabled', 'idle', 'checking', 'skipped']) {
      readAppInfoMock.mockResolvedValue({ update: { status } });

      await renderAndSettle();

      expect(container.querySelector('[data-testid="update-status-chip"]')).toBeNull();
    }
  });
});
