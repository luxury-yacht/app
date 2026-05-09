/**
 * frontend/src/core/settings/clusterThemeAutoApply.test.ts
 *
 * Tests for guarded cluster theme auto-apply sequencing.
 */

import { describe, expect, it, vi } from 'vitest';
import { autoApplyClusterTheme } from './clusterThemeAutoApply';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('autoApplyClusterTheme', () => {
  it('applies the matching theme and replays appearance overrides when current', async () => {
    const applyTheme = vi.fn().mockResolvedValue(undefined);
    const hydrateAppPreferences = vi.fn().mockResolvedValue({});
    const applyAppearanceOverrides = vi.fn();

    await autoApplyClusterTheme({
      selectedClusterName: 'prod',
      isCurrent: () => true,
      matchThemeForCluster: vi.fn().mockResolvedValue({ id: 'prod-theme' }),
      applyTheme,
      hydrateAppPreferences,
      applyAppearanceOverrides,
    });

    expect(applyTheme).toHaveBeenCalledWith('prod-theme');
    expect(hydrateAppPreferences).toHaveBeenCalledWith({ force: true });
    expect(applyAppearanceOverrides).toHaveBeenCalledTimes(1);
  });

  it('does not apply a theme when the match result is stale', async () => {
    let current = true;
    const match = deferred<{ id: string } | null>();
    const applyTheme = vi.fn().mockResolvedValue(undefined);

    const run = autoApplyClusterTheme({
      selectedClusterName: 'old-cluster',
      isCurrent: () => current,
      matchThemeForCluster: vi.fn().mockReturnValue(match.promise),
      applyTheme,
      hydrateAppPreferences: vi.fn().mockResolvedValue({}),
      applyAppearanceOverrides: vi.fn(),
    });

    current = false;
    match.resolve({ id: 'old-theme' });
    await run;

    expect(applyTheme).not.toHaveBeenCalled();
  });

  it('does not hydrate or replay overrides when the apply step becomes stale', async () => {
    let current = true;
    const apply = deferred<void>();
    const hydrateAppPreferences = vi.fn().mockResolvedValue({});
    const applyAppearanceOverrides = vi.fn();

    const run = autoApplyClusterTheme({
      selectedClusterName: 'old-cluster',
      isCurrent: () => current,
      matchThemeForCluster: vi.fn().mockResolvedValue({ id: 'old-theme' }),
      applyTheme: vi.fn().mockReturnValue(apply.promise),
      hydrateAppPreferences,
      applyAppearanceOverrides,
    });

    await Promise.resolve();
    current = false;
    apply.resolve();
    await run;

    expect(hydrateAppPreferences).not.toHaveBeenCalled();
    expect(applyAppearanceOverrides).not.toHaveBeenCalled();
  });
});
