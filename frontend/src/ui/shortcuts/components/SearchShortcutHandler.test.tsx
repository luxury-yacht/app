/**
 * frontend/src/ui/shortcuts/components/SearchShortcutHandler.test.tsx
 *
 * The search shortcut the app's KeyboardProvider registers: Cmd+F (macOS) or
 * Ctrl+F focuses the active registered search field and keeps the key from the
 * webview, and leaves the key to the webview's own find when no search field
 * is active. Runs in provider mode inside the real app shell, whose
 * KeyboardProvider and search-target registry are the production ones; only
 * the backend boundary is faked (test-utils/appState).
 */

import { useSearchShortcutTarget } from '@ui/shortcuts';
import { act, useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';

const app = installAppStateHarness();
let view: MountedApp;

function SearchField({ active }: Readonly<{ active: boolean }>) {
  const ref = useRef<HTMLInputElement>(null);
  useSearchShortcutTarget({ isActive: active, focus: () => ref.current?.focus() });
  return <input ref={ref} aria-label="Filter" />;
}

const showSearchField = async (active: boolean) => {
  view = await app.render(null);
  await view.show(<SearchField active={active} />);
  return requireValue(
    view.container.querySelector<HTMLInputElement>('input[aria-label="Filter"]'),
    'expected the search field'
  );
};

/** Presses the platform's find shortcut where focus is, and returns the event. */
const pressFind = async () => {
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    bubbles: true,
    cancelable: true,
    ...(isMacPlatform() ? { metaKey: true } : { ctrlKey: true }),
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
};

describe('KeyboardProvider search shortcut', () => {
  it('focuses the active search field and keeps the key from the webview', async () => {
    const field = await showSearchField(true);

    const event = await pressFind();

    expect(document.activeElement).toBe(field);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves the key to the webview’s find when no search field is active', async () => {
    const field = await showSearchField(false);

    const event = await pressFind();

    expect(document.activeElement).not.toBe(field);
    expect(event.defaultPrevented).toBe(false);
  });
});
