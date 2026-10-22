/**
 * frontend/src/test-utils/appState/harness.bootstrap.test.tsx
 *
 * Every harness mount runs the production window bootstrap before it renders:
 * persisted preferences hydrate first and the window learns its identity. These
 * tests hold the app to that order through the boundary.
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import { installAppStateHarness } from './harness';

const app = installAppStateHarness({ windowName: 'workspace-1' });

describe('menu events addressed to windows', () => {
  const openSettingsFrom = async (sender: string | undefined) => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    const view = await app.render(null);
    await act(async () => {
      app.events.emit('open-settings', null, { sender });
    });
    return view.owners().viewState?.isSettingsOpen;
  };

  it('opens settings for an event this window sent', async () => {
    expect(await openSettingsFrom('workspace-1')).toBe(true);
  });

  it('ignores an event addressed to another window', async () => {
    expect(await openSettingsFrom('workspace-2')).toBe(false);
  });

  it('opens settings for a broadcast event', async () => {
    expect(await openSettingsFrom(undefined)).toBe(true);
  });
});

describe('a window that starts with auto-refresh persisted off', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const startPaused = async () => {
    vi.useFakeTimers();
    app.preferences({ autoRefreshEnabled: false });
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    app.startScreen(dev);
    const overviewScope = buildClusterRefreshScope('cluster-overview', dev.clusterId);
    const view = await app.mountApp();
    return { dev, overviewScope, view };
  };

  it('shows the paused state and opens no stream from its first render', async () => {
    const { view } = await startPaused();

    expect(app.streams.requests()).toEqual([]);
    const connectivity = view.container.querySelector('.status-indicator-dot[data-status]');
    expect(connectivity?.getAttribute('data-status')).toBe('inactive');
  });

  it('reads only the visible overview, and nothing more as polling time passes', async () => {
    const { overviewScope } = await startPaused();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    await app.settle();

    const reads = app.snapshots.reads();
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((read) => read.domain === 'cluster-overview')).toBe(true);
    expect(reads.every((read) => read.scope === overviewScope)).toBe(true);
    expect(app.streams.requests()).toEqual([]);
  });

  it('still reads the visible scopes when the user refreshes', async () => {
    await startPaused();
    const readsBefore = app.snapshots.reads().length;

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, bubbles: true })
      );
    });
    await app.settle();

    expect(app.snapshots.reads().length).toBeGreaterThan(readsBefore);
    expect(app.streams.requests()).toEqual([]);
  });
});
