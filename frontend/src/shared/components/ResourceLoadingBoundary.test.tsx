/**
 * frontend/src/shared/components/ResourceLoadingBoundary.test.tsx
 *
 * The loading gate in front of resource tables: a spinner until the first
 * result, the content as soon as partial data arrives when partial rendering
 * is allowed, and, while auto-refresh is off, a paused notice instead of a
 * spinner that would never resolve. Runs inside the production shell, which
 * owns the auto-refresh preference, over a faked backend (test-utils/appState).
 */

import { describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import ResourceLoadingBoundary from './ResourceLoadingBoundary';

const app = installAppStateHarness();

const start = async (): Promise<MountedApp> => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  return app.render(null);
};

const content = (view: MountedApp) =>
  view.container.querySelector('[data-testid="content"]')?.textContent ?? null;
const spinner = (view: MountedApp) => view.container.querySelector('.loading-spinner-container');

describe('ResourceLoadingBoundary', () => {
  it('shows a spinner instead of the content until the first result', async () => {
    const view = await start();

    await view.show(
      <ResourceLoadingBoundary loading dataLength={0} hasLoaded={false}>
        <div data-testid="content">content</div>
      </ResourceLoadingBoundary>
    );

    expect(spinner(view)).not.toBeNull();
    expect(content(view)).toBeNull();
  });

  it('renders partial data while the rest is still loading when partial rendering is allowed', async () => {
    const view = await start();

    await view.show(
      <ResourceLoadingBoundary loading dataLength={2} hasLoaded={false} allowPartial>
        <div data-testid="content">ready</div>
      </ResourceLoadingBoundary>
    );

    expect(spinner(view)).toBeNull();
    expect(content(view)).toBe('ready');
  });

  it('shows the paused notice instead of a spinner while auto-refresh is off before the first result', async () => {
    app.preferences({ autoRefreshEnabled: false });
    const view = await start();

    await view.show(
      <ResourceLoadingBoundary loading={false} dataLength={0} hasLoaded={false}>
        <div data-testid="content">content</div>
      </ResourceLoadingBoundary>
    );

    expect(view.container.querySelector('output')?.textContent).toContain(
      'Auto-refresh is disabled'
    );
    expect(spinner(view)).toBeNull();
    expect(content(view)).toBeNull();
  });
});
