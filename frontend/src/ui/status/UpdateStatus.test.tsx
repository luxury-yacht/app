/**
 * frontend/src/ui/status/UpdateStatus.test.tsx
 *
 * Covers the header update chip: it appears only when an update is available,
 * opens the release URL on click, and wires version/release details into the
 * hover tooltip. The shared Tooltip is mocked to expose its `content` so the
 * test asserts THIS component's wiring, not Tooltip's hover/portal internals.
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readAppInfoMock, browserOpenURLMock } = vi.hoisted(() => ({
  readAppInfoMock: vi.fn(),
  browserOpenURLMock: vi.fn(),
}));

vi.mock('@/core/app-state-access', () => ({
  requestAppState: ({ read }: { read: () => unknown }) => Promise.resolve(read()),
  readAppInfo: () => readAppInfoMock(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: (...args: unknown[]) => browserOpenURLMock(...args),
}));

vi.mock('@wailsjs/go/models', () => ({ backend: {} }));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ content, children }: { content: ReactNode; children: ReactNode }) => (
    <span data-testid="tooltip">
      {children}
      <span data-testid="tooltip-content">{content}</span>
    </span>
  ),
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderAndSettle = async () => {
    await act(async () => {
      root.render(<UpdateStatus />);
    });
    // Flush the app-info promise + the resulting state update.
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders a clickable info chip with version + release notes, and links to the notes page', async () => {
    readAppInfoMock.mockResolvedValue({
      update: {
        currentVersion: '1.10.0',
        latestVersion: '1.10.1',
        publishedAt: '2026-07-05T12:00:00Z',
        currentPublishedAt: '2026-06-20T12:00:00Z',
        releaseUrl: 'https://example.com/releases/v1.10.1',
        releaseNotes: '- Fixed metrics permission notice\n- Moved the update chip to the header',
        isUpdateAvailable: true,
      },
    });

    await renderAndSettle();

    const chip = container.querySelector(
      '[data-testid="update-status-chip"]'
    ) as HTMLButtonElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('Update available');

    // Tooltip shows New/Current rows, each "<version> (YYYY-MM-DD)", plus the
    // release notes preview. Dates format from UTC, so they're timezone-stable.
    const tooltip = container.querySelector('[data-testid="tooltip-content"]');
    expect(tooltip?.textContent).toContain('New');
    expect(tooltip?.textContent).toContain('Current');
    expect(tooltip?.textContent).toContain('1.10.1');
    expect(tooltip?.textContent).toContain('1.10.0');
    expect(tooltip?.textContent).toContain('(2026-07-05)');
    expect(tooltip?.textContent).toContain('(2026-06-20)');
    const notes = container.querySelector('[data-testid="update-status-notes"]');
    expect(notes?.textContent).toContain('Fixed metrics permission notice');
    // The markdown stripper is applied: bullets render as • (not raw "- ").
    expect(notes?.textContent).toContain('•');

    // Clicking the chip opens the release/downloads page.
    act(() => {
      chip?.click();
    });
    expect(browserOpenURLMock).toHaveBeenCalledWith('https://example.com/releases/v1.10.1');

    // The "Full release notes" link opens the version's tag page.
    const notesLink = container.querySelector(
      '[data-testid="update-status-notes-link"]'
    ) as HTMLButtonElement | null;
    act(() => {
      notesLink?.click();
    });
    expect(browserOpenURLMock).toHaveBeenCalledWith(
      'https://github.com/luxury-yacht/app/releases/tag/1.10.1'
    );
  });

  it('renders nothing when no update is available', async () => {
    readAppInfoMock.mockResolvedValue({ update: { isUpdateAvailable: false } });

    await renderAndSettle();

    expect(container.querySelector('[data-testid="update-status-chip"]')).toBeNull();
  });

  it('renders nothing when the update has no release URL', async () => {
    readAppInfoMock.mockResolvedValue({
      update: { isUpdateAvailable: true, latestVersion: '1.10.1', releaseUrl: '' },
    });

    await renderAndSettle();

    expect(container.querySelector('[data-testid="update-status-chip"]')).toBeNull();
  });
});
