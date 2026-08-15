/**
 * frontend/src/components/modals/AboutModal.test.tsx
 *
 * Test suite for AboutModal.
 * Covers key behaviors and edge cases for AboutModal.
 */

import { KeyboardProvider } from '@ui/shortcuts';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appInfoMock = vi.hoisted(() => ({
  GetAppInfo: vi.fn(),
  CheckForUpdates: vi.fn(),
  DownloadApplicationUpdate: vi.fn(),
  RestartAndApplyApplicationUpdate: vi.fn(),
  SkipApplicationUpdate: vi.fn(),
}));

const runtimeMock = vi.hoisted(() => ({
  eventsOn: vi.fn(
    (_name: string, _callback: (payload?: Record<string, unknown>) => void) => () => undefined
  ),
  openURL: vi.fn(),
}));

const errorMock = vi.hoisted(() => ({
  reportOperationalError: vi.fn(),
}));

vi.mock('@core/backend-api', () => ({
  GetAppInfo: appInfoMock.GetAppInfo,
  CheckForUpdates: appInfoMock.CheckForUpdates,
  DownloadApplicationUpdate: appInfoMock.DownloadApplicationUpdate,
  RestartAndApplyApplicationUpdate: appInfoMock.RestartAndApplyApplicationUpdate,
  SkipApplicationUpdate: appInfoMock.SkipApplicationUpdate,
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: runtimeMock.eventsOn,
  openURL: runtimeMock.openURL,
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: errorMock.reportOperationalError,
}));

vi.mock('@assets/luxury-yacht-logo.png', () => ({ __esModule: true, default: 'logo.png' }));
vi.mock('@assets/captain-k8s-color.png', () => ({ __esModule: true, default: 'captain.png' }));

type AboutModalModule = typeof import('./AboutModal');
type AboutModalComponent = AboutModalModule['default'];
type AboutModalProps = React.ComponentProps<AboutModalComponent>;

const renderModal = async (props: AboutModalProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const { default: AboutModal } = await import('./AboutModal');

  await act(async () => {
    root.render(
      <KeyboardProvider>
        <AboutModal {...props} />
      </KeyboardProvider>
    );
  });

  return {
    container,
    root,
    rerender: async (newProps: AboutModalProps) => {
      await act(async () => {
        root.render(
          <KeyboardProvider>
            <AboutModal {...newProps} />
          </KeyboardProvider>
        );
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('AboutModal', () => {
  beforeEach(() => {
    runtimeMock.eventsOn.mockReset().mockReturnValue(() => undefined);
    runtimeMock.openURL.mockReset();
    appInfoMock.GetAppInfo.mockReset();
    appInfoMock.CheckForUpdates.mockReset();
    appInfoMock.DownloadApplicationUpdate.mockReset();
    appInfoMock.RestartAndApplyApplicationUpdate.mockReset();
    appInfoMock.SkipApplicationUpdate.mockReset();
    errorMock.reportOperationalError.mockReset();
    document.body.style.overflow = '';
  });

  it('reports a rejected update command without closing the About surface', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.9.0',
      update: {
        status: 'check-error',
        currentVersion: '1.9.0',
        canCheck: true,
        canInstall: true,
        error: 'network unavailable',
      },
    });
    appInfoMock.CheckForUpdates.mockRejectedValue(new Error('offline'));
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    const check = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Check Again'
    );
    await act(async () => check?.click());

    expect(errorMock.reportOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'AboutModal',
      action: 'checkApplicationUpdate',
    });
    expect(document.body.textContent).toContain('Couldn’t check for updates.');
    await modal.unmount();
  });

  it('requires separate download and restart consent while following live backend state', async () => {
    let updateHandler: ((payload: Record<string, unknown>) => void) | undefined;
    runtimeMock.eventsOn.mockImplementation((name: string, callback: typeof updateHandler) => {
      if (name === 'app-update') {
        updateHandler = callback;
      }
      return () => undefined;
    });
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.9.0',
      update: {
        status: 'available',
        currentVersion: '1.9.0',
        availableVersion: '2.0.0',
        releaseNotes: '## Safer updates',
        canCheck: true,
        canInstall: true,
      },
    });
    appInfoMock.DownloadApplicationUpdate.mockResolvedValue({ status: 'downloading' });
    appInfoMock.RestartAndApplyApplicationUpdate.mockResolvedValue({ status: 'ready' });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain('Luxury Yacht 2.0.0 is available.');
    expect(document.body.textContent).toContain('Safer updates');
    const download = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Download Update'
    );
    expect(download).toBeTruthy();
    await act(async () => download?.click());
    expect(appInfoMock.DownloadApplicationUpdate).toHaveBeenCalledWith('2.0.0');
    expect(appInfoMock.RestartAndApplyApplicationUpdate).not.toHaveBeenCalled();

    await act(async () => {
      updateHandler?.({
        status: 'ready',
        currentVersion: '1.9.0',
        availableVersion: '2.0.0',
        canInstall: true,
      });
    });
    expect(document.body.textContent).toContain('Luxury Yacht 2.0.0 is ready to install.');
    const restart = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restart & Apply'
    );
    expect(restart).toBeTruthy();
    await act(async () => restart?.click());
    expect(appInfoMock.RestartAndApplyApplicationUpdate).toHaveBeenCalledTimes(1);

    await modal.unmount();
  });

  it('persists the exact offered version before dismissing it', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.9.0',
      update: {
        status: 'available',
        currentVersion: '1.9.0',
        availableVersion: '2.0.0',
        canCheck: true,
        canInstall: true,
      },
    });
    appInfoMock.SkipApplicationUpdate.mockResolvedValue({
      status: 'current',
      currentVersion: '1.9.0',
      canCheck: true,
      canInstall: true,
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    const skip = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Skip This Version'
    );
    expect(skip).toBeTruthy();
    await act(async () => skip?.click());

    expect(appInfoMock.SkipApplicationUpdate).toHaveBeenCalledWith('2.0.0');
    expect(appInfoMock.DownloadApplicationUpdate).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Luxury Yacht 2.0.0 is available.');

    await modal.unmount();
  });

  it('shows reason-specific notification-only recovery without staging', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '2.0.0',
      update: {
        status: 'available',
        currentVersion: '2.0.0',
        availableVersion: '2.1.0',
        canCheck: true,
        canInstall: false,
        eligibilityReason: 'linux-package-managed',
        recoveryTarget: 'linux-packages',
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain(
      'This installation is managed by your system package manager.'
    );
    expect(document.body.textContent).toContain('View Linux Packages');
    expect(document.body.textContent).not.toContain('Download Update');
    expect(appInfoMock.DownloadApplicationUpdate).not.toHaveBeenCalled();

    await modal.unmount();
  });

  it('uses the persisted attempt recovery target after an apply failure', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.9.0',
      update: {
        status: 'apply-error',
        currentVersion: '1.9.0',
        availableVersion: '2.0.0',
        canCheck: false,
        canInstall: false,
        eligibilityReason: 'linux-package-managed',
        recoveryTarget: 'mac-download',
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    expect(document.body.textContent).toContain(
      'The update couldn’t be applied. Luxury Yacht is still on 1.9.0.'
    );
    expect(document.body.textContent).toContain('View macOS Download');
    expect(document.body.textContent).not.toContain('View Linux Packages');

    await modal.unmount();
  });

  it('notes an up-to-date app beside the version and drops the update section', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '2.0.0-beta.2',
      update: {
        status: 'current',
        currentVersion: '2.0.0-beta.2',
        canCheck: true,
        canInstall: true,
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    // The note owns its own line: the version stays bare, and the note is a
    // sibling element rather than a parenthetical inside it.
    expect(document.querySelector('.about-version')?.textContent).toBe('Version 2.0.0-beta.2');
    expect(document.querySelector('.about-version-note')?.textContent).toBe(
      'no newer version is available'
    );
    expect(document.querySelector('.about-update')).toBeNull();
    expect(document.body.textContent).not.toContain('Luxury Yacht is up to date.');
    expect(document.querySelector('.about-hero')?.textContent).not.toContain('(');

    await modal.unmount();
  });

  it('keeps the version line bare while an update is pending', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.10.0',
      update: {
        status: 'available',
        currentVersion: '1.10.0',
        availableVersion: '1.10.1',
        canCheck: true,
        canInstall: true,
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    expect(document.querySelector('.about-version')?.textContent).toBe('Version 1.10.0');
    expect(document.querySelector('.about-update')).not.toBeNull();

    await modal.unmount();
  });

  it('presents the release detail that used to live in the header tooltip', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.10.0',
      update: {
        status: 'available',
        currentVersion: '1.10.0',
        availableVersion: '1.10.1',
        releaseName: 'Luxury Yacht 1.10.1',
        publishedAt: '2026-07-05T12:00:00Z',
        releaseNotes: '## Highlights\n\n- Fixed **metrics** permission notice',
        canCheck: true,
        canInstall: true,
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    const notes = document.querySelector('[data-testid="about-release-notes"]');
    expect(notes?.textContent).toContain('Highlights');
    // The markdown stripper is applied: bullets render as • (not raw "- ").
    expect(notes?.textContent).toContain('• Fixed metrics permission notice');
    expect(document.body.textContent).toContain('Luxury Yacht 1.10.1');
    expect(document.body.textContent).toContain('2026-07-05');

    // The actions and the notes link outrank the notes preview, so they come
    // first in the card — and therefore first in tab order too.
    const cardBlocks = Array.from(document.querySelector('.about-update')?.children ?? []).map(
      (child) => child.className
    );
    expect(cardBlocks).toContain('about-update-actions');
    expect(cardBlocks).toContain('about-release');
    expect(cardBlocks.indexOf('about-update-actions')).toBeLessThan(
      cardBlocks.indexOf('about-release')
    );

    const notesLink = document.querySelector(
      '[data-testid="about-release-notes-link"]'
    ) as HTMLAnchorElement | null;
    expect(notesLink).toBeTruthy();
    await act(async () => notesLink?.click());
    // Release tags carry the conventional `v` prefix; availableVersion does not.
    expect(runtimeMock.openURL).toHaveBeenCalledWith(
      'https://github.com/luxury-yacht/app/releases/tag/v1.10.1'
    );

    await modal.unmount();
  });

  it('styles update actions with the shared button vocabulary', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.10.0',
      update: {
        status: 'available',
        currentVersion: '1.10.0',
        availableVersion: '1.10.1',
        canCheck: true,
        canInstall: true,
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    const buttons = Array.from(document.querySelectorAll('.about-update-actions button'));
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Download Update',
      'Skip This Version',
    ]);
    expect(buttons[0]?.className).toContain('button save');
    expect(buttons[1]?.className).toContain('button generic');
    // The undefined `p-btn` / `p-prim-col` classes are not part of this app's
    // vocabulary and left the actions unstyled.
    expect(document.querySelector('[class*="p-btn"]')).toBeNull();

    await modal.unmount();
  });

  it('states the update status as a sentence, with no status pill', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.10.0',
      update: {
        status: 'ready',
        currentVersion: '1.10.0',
        availableVersion: '1.10.1',
        canCheck: true,
        canInstall: true,
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    // The message is the status; a pill above it only repeated the sentence.
    expect(document.querySelector('.about-update-message')?.textContent).toBe(
      'Luxury Yacht 1.10.1 is ready to install.'
    );
    expect(document.querySelector('.about-update .status-chip')).toBeNull();
    expect(document.body.textContent).not.toContain('Restart to update');

    await modal.unmount();
  });

  it('omits the release block when the check found no release', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.10.0',
      update: {
        status: 'check-error',
        currentVersion: '1.10.0',
        canCheck: true,
        canInstall: true,
        error: 'network unavailable',
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    expect(document.querySelector('[data-testid="about-release-notes"]')).toBeNull();
    expect(document.querySelector('[data-testid="about-release-notes-link"]')).toBeNull();
    expect(document.body.textContent).toContain('Couldn’t check for updates.');

    await modal.unmount();
  });

  it('does not render an out-of-range progress value', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.9.0',
      update: {
        status: 'downloading',
        currentVersion: '1.9.0',
        availableVersion: '2.0.0',
        canCheck: true,
        canInstall: true,
        progressPercent: 150,
      },
    });
    const modal = await renderModal({ isOpen: true, onClose: vi.fn() });
    await act(async () => Promise.resolve());

    expect(document.querySelector('progress')).toBeNull();
    expect(document.body.textContent).not.toContain('150%');

    await modal.unmount();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders beta metadata and opens external links', async () => {
    const expiry = new Date('2025-12-25T00:00:00Z');
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '1.2.3',
      isBeta: true,
      expiryDate: expiry.toISOString(),
    });
    const onClose = vi.fn();

    const { unmount } = await renderModal({
      isOpen: true,
      onClose,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Version 1.2.3');
    expect(document.body.textContent).toContain('Beta expires');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.querySelector('.about-modal')?.getAttribute('role')).toBe('dialog');
    expect(document.querySelector('.about-modal')?.getAttribute('aria-modal')).toBe('true');

    const wailsLink = Array.from(document.querySelectorAll('a')).find((link) =>
      link.textContent?.includes('Wails')
    );
    expect(wailsLink).toBeTruthy();

    await act(async () => {
      wailsLink?.click();
    });

    expect(runtimeMock.openURL).toHaveBeenCalledWith('https://v3.wails.io');

    await unmount();
  });

  it('closes on Escape while open', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({
      version: '2.0.0',
      isBeta: false,
      expiryDate: null,
    });
    const onClose = vi.fn();

    const modal = await renderModal({
      isOpen: true,
      onClose,
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await modal.unmount();
  });

  it('closes via overlay click but ignores clicks inside modal', async () => {
    appInfoMock.GetAppInfo.mockResolvedValue({ version: '3.0.0' });
    const onClose = vi.fn();
    const modal = await renderModal({
      isOpen: true,
      onClose,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const container = document.querySelector('.about-modal') as HTMLDivElement | null;
    const backdropDismiss = document.querySelector<HTMLButtonElement>('.modal-backdrop-dismiss');
    expect(container).toBeTruthy();
    expect(backdropDismiss).toBeTruthy();

    act(() => {
      container?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      backdropDismiss?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await modal.unmount();
  });

  it('handles GetAppInfo failures gracefully and hides overlay after animation', async () => {
    vi.useFakeTimers();
    const error = new Error('boom');
    appInfoMock.GetAppInfo.mockImplementation(() => Promise.reject(error));
    const onClose = vi.fn();

    const modal = await renderModal({
      isOpen: true,
      onClose,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('.modal-content')?.textContent).toContain('Version Loading...');

    await modal.rerender({ isOpen: false, onClose });
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
    expect(document.querySelector('.modal-overlay')?.classList.contains('closing')).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(document.querySelector('.modal-overlay')).toBeNull();
    vi.useRealTimers();
    await modal.unmount();
  });

  it('does not render when closed', async () => {
    const { unmount } = await renderModal({
      isOpen: false,
      onClose: vi.fn(),
    });

    expect(document.querySelector('.about-modal')).toBeNull();
    await unmount();
  });
});
