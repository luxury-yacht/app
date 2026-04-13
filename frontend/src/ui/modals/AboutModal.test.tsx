/**
 * frontend/src/components/modals/AboutModal.test.tsx
 *
 * Test suite for AboutModal.
 * Covers key behaviors and edge cases for AboutModal.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts';

const appInfoMock = vi.hoisted(() => ({
  GetAppInfo: vi.fn(),
}));

const runtimeMock = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
  BrowserOpenURL: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppInfo: appInfoMock.GetAppInfo,
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMock.eventsOn,
  EventsOff: runtimeMock.eventsOff,
  BrowserOpenURL: runtimeMock.BrowserOpenURL,
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
    runtimeMock.eventsOn.mockReset();
    runtimeMock.eventsOff.mockReset();
    runtimeMock.BrowserOpenURL.mockReset();
    appInfoMock.GetAppInfo.mockReset();
    document.body.style.overflow = '';
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

    expect(runtimeMock.BrowserOpenURL).toHaveBeenCalledWith('https://wails.io/');

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
    const overlay = document.querySelector('.modal-overlay') as HTMLDivElement | null;
    expect(container).toBeTruthy();
    expect(overlay).toBeTruthy();

    act(() => {
      container?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
