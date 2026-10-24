/**
 * frontend/src/core/settings/usePreference.test.tsx
 *
 * Mounted readers follow the preference owner: a change published between
 * render and subscription, later optimistic edits, and a failed save's rollback.
 */

import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppPreferencesCacheForTesting, setAutoRefreshEnabled } from './appPreferences';
import { usePreference } from './usePreference';

const backend = vi.hoisted(() => ({ UpdateAppPreferences: vi.fn() }));
vi.mock('@/core/backend-api', () => backend);
vi.mock('@/core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  emitBroadcastEvent: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: vi.fn() }));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('usePreference', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    backend.UpdateAppPreferences.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows a change published before it subscribed, and a failed save rolling back', async () => {
    let shown: boolean | undefined;
    function Reader() {
      shown = usePreference('autoRefreshEnabled');
      return null;
    }
    // Layout effects run after render but before passive subscriptions.
    function EarlyEdit() {
      useLayoutEffect(() => setAutoRefreshEnabled(false), []);
      return null;
    }
    let rejectSave!: (error: Error) => void;
    backend.UpdateAppPreferences.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      })
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() =>
      root.render(
        <>
          <Reader />
          <EarlyEdit />
        </>
      )
    );
    expect(shown).toBe(false);

    await act(async () => {
      rejectSave(new Error('save failed'));
      await flush();
    });
    expect(shown).toBe(true);

    act(() => root.unmount());
  });
});
