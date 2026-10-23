/**
 * frontend/src/ui/shortcuts/useSearchShortcutTarget.test.tsx
 *
 * A search field registered with useSearchShortcutTarget takes the find
 * shortcut (Cmd/Ctrl+F) according to its current props: whether it is
 * active, its priority, and its latest focus handler, and it stops taking the
 * shortcut once it unmounts. Runs in provider mode inside the real app shell,
 * whose KeyboardProvider dispatches the shortcut through the production
 * search-target registry; only the backend boundary is faked
 * (test-utils/appState).
 */

import { act, useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';
import { useSearchShortcutTarget } from './useSearchShortcutTarget';

const app = installAppStateHarness();
let view: MountedApp;

interface FieldProps {
  name: string;
  active: boolean;
  priority: number;
  /** The field the target's focus handler moves focus to (default: its own). */
  focuses?: string;
}

function SearchField({ name, active, priority, focuses = name }: Readonly<FieldProps>) {
  const ref = useRef<HTMLDivElement>(null);
  useSearchShortcutTarget({
    isActive: active,
    priority,
    focus: () => ref.current?.querySelector<HTMLInputElement>(`[aria-label="${focuses}"]`)?.focus(),
  });
  return (
    <div ref={ref}>
      <input aria-label={name} />
      <input aria-label={`${name} (alternate)`} />
    </div>
  );
}

const showFields = async (fields: FieldProps[]) => {
  await view.show(fields.map((props) => <SearchField key={props.name} {...props} />));
};

const fieldNamed = (label: string) =>
  requireValue(
    view.container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`),
    `expected the ${label} field`
  );

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

describe('useSearchShortcutTarget', () => {
  it('routes the find shortcut by each field’s current activity, priority, and focus handler', async () => {
    view = await app.render(null);
    await showFields([
      { name: 'Filters', active: true, priority: 5 },
      { name: 'Logs', active: true, priority: 0 },
    ]);
    await pressFind();
    expect(document.activeElement).toBe(fieldNamed('Filters'));

    await showFields([
      { name: 'Filters', active: true, priority: 0 },
      { name: 'Logs', active: true, priority: 10 },
    ]);
    await pressFind();
    expect(document.activeElement).toBe(fieldNamed('Logs'));

    await showFields([
      { name: 'Filters', active: true, priority: 0 },
      { name: 'Logs', active: false, priority: 10 },
    ]);
    await pressFind();
    expect(document.activeElement).toBe(fieldNamed('Filters'));

    await showFields([
      { name: 'Filters', active: true, priority: 0, focuses: 'Filters (alternate)' },
      { name: 'Logs', active: false, priority: 10 },
    ]);
    await pressFind();
    expect(document.activeElement).toBe(fieldNamed('Filters (alternate)'));
  });

  it('stops taking the find shortcut once its field unmounts', async () => {
    view = await app.render(null);
    await showFields([{ name: 'Filters', active: true, priority: 0 }]);
    expect((await pressFind()).defaultPrevented).toBe(true);

    await showFields([]);

    expect((await pressFind()).defaultPrevented).toBe(false);
  });
});
