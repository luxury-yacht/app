/**
 * frontend/src/ui/settings/sections/preferenceConcurrency.test.tsx
 *
 * Settings controls follow the preference owner's confirmed state: failed
 * saves return the Advanced, Display, and Object Panel controls to the saved
 * values, two overlapping toggles that both fail end on the saved value, and a
 * change saved by another window reaches every mounted control. Runs the
 * Display, Data Management, Advanced, and Object Panel sections inside the
 * production shell with the real preference owner over the faked backend
 * (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { controlName } from '@/test-utils/controlName';
import { requireValue } from '@/test-utils/requireValue';
import AdvancedSection from './AdvancedSection';
import DataManagementSection from './DataManagementSection';
import DisplaySection from './DisplaySection';
import ObjectPanelSection from './ObjectPanelSection';

const app = installAppStateHarness();
let view: MountedApp;

const savedSettings = {
  useShortResourceNames: false,
  errorReportingEnabled: false,
  defaultTablePageSize: 50,
  kubernetesClientQPS: 200,
  gridTablePersistenceMode: 'shared',
  defaultObjectPanelPosition: 'right',
  objectPanelDockedRightWidth: 600,
};

const deferred = () => {
  let reject!: (error: Error) => void;
  const promise = new Promise<never>((_resolve, rejectSave) => {
    reject = rejectSave;
  });
  return { promise, reject };
};

const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await app.settle();
};

const qpsInput = () =>
  requireValue(
    Array.from(view.container.querySelectorAll<HTMLInputElement>('input')).find(
      (field) => controlName(field) === 'Client QPS'
    ),
    'Client QPS input'
  );
const dockedRightInput = () =>
  requireValue(
    view.container.querySelector<HTMLInputElement>('input[aria-label="Docked right width"]'),
    'docked right width input'
  );
const switchNamed = (label: string) =>
  requireValue(
    view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`),
    `${label} switch`
  );
const pageSize = () => switchNamed('Default page size');
const positionButton = (label: string) =>
  requireValue(
    Array.from(
      view.container.querySelectorAll<HTMLButtonElement>(
        'fieldset[aria-label="Default Object Panel position"] button'
      )
    ).find((button) => button.textContent === label),
    `${label} position`
  );

const typeAndLeave = async (field: HTMLInputElement, value: string) => {
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.blur();
  });
  await app.settle();
};

const choosePageSize = async (label: string) => {
  await click(pageSize());
  const menu = requireValue(
    document.getElementById(pageSize().getAttribute('aria-controls') ?? ''),
    'page size menu'
  );
  await click(
    requireValue(
      Array.from(menu.querySelectorAll<HTMLElement>('.dropdown-option')).find(
        (option) => option.textContent?.trim() === label
      ),
      `${label} option`
    )
  );
};

beforeEach(async () => {
  app.preferences(savedSettings);
  app.backend.answer('UpdateAppPreferences', () => ({ settings: null, changedKeys: [] }));
  view = await app.render(null);
  await view.show(
    <>
      <DisplaySection />
      <DataManagementSection />
      <AdvancedSection />
      <ObjectPanelSection />
    </>
  );
});

describe('settings controls with the preference owner', () => {
  it('returns Advanced, Display, and Object Panel controls to the saved values when saves fail', async () => {
    app.backend.answer('UpdateAppPreferences', () => {
      throw new Error('rollback save failed');
    });

    await click(switchNamed('Per-namespace views'));
    await typeAndLeave(qpsInput(), '321');
    await click(positionButton('Bottom'));
    await typeAndLeave(dockedRightInput(), '700');
    await choosePageSize('100');

    expect(switchNamed('Per-namespace views').getAttribute('aria-checked')).toBe('false');
    expect(qpsInput().value).toBe('200');
    expect(positionButton('Right').getAttribute('aria-pressed')).toBe('true');
    expect(dockedRightInput().value).toBe('600');
    expect(pageSize().textContent).toContain('50');
    // Each failed save is reported once by the preference owner.
    expect(
      app.errors
        .take((record) => record.context?.source === 'AppPreferences')
        .map((record) => record.kinds)
    ).toEqual(Array.from({ length: 5 }, () => ['operational']));
  });

  it.each([
    ['Short resource names', 'setUseShortResourceNames'],
    ['Error Reporting', 'updateErrorReporting'],
  ])('shows the saved %s state after two overlapping toggles both fail', async (label, action) => {
    const first = deferred();
    const second = deferred();
    const saves = [first.promise, second.promise];
    app.backend.answer(
      'UpdateAppPreferences',
      () => saves.shift() ?? Promise.reject(new Error(`unexpected ${label} save`))
    );
    const toggle = switchNamed(label);

    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => first.reject(new Error(`first ${label} save failed`)));
    await app.settle();
    await act(async () => second.reject(new Error(`second ${label} save failed`)));
    await app.settle();

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(app.errors.take((record) => record.context?.action === action)).toHaveLength(2);
  });

  it('updates mounted controls after another window saves preferences', async () => {
    app.preferences({
      useShortResourceNames: true,
      errorReportingEnabled: true,
      defaultTablePageSize: 250,
      kubernetesClientQPS: 250,
      gridTablePersistenceMode: 'namespaced',
      defaultObjectPanelPosition: 'floating',
      objectPanelDockedRightWidth: 720,
    });

    await act(async () => {
      app.events.emit('settings:preferences-changed');
    });
    await app.settle();

    for (const label of ['Short resource names', 'Error Reporting', 'Per-namespace views']) {
      expect(switchNamed(label).getAttribute('aria-checked')).toBe('true');
    }
    expect(pageSize().textContent).toContain('250');
    expect(qpsInput().value).toBe('250');
    expect(positionButton('Floating').getAttribute('aria-pressed')).toBe('true');
    expect(dockedRightInput().value).toBe('720');
  });
});
