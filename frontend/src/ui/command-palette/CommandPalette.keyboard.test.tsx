/**
 * frontend/src/ui/command-palette/CommandPalette.keyboard.test.tsx
 *
 * The command palette inside the app's keyboard system: as a modal surface it
 * keeps Tab inside itself and returns focus to the control that invoked it;
 * the application-menu accelerators reach it while it is open (Cmd/Ctrl+
 * Shift+P leaves an open palette and its query alone, Cmd/Ctrl+O switches it
 * to the kubeconfig picker), as does its own Cmd/Ctrl+Shift+N (to the
 * namespace picker); and no entry point opens it over another modal.
 * Runs in provider mode inside the real app shell, whose KeyboardProvider,
 * application-menu shortcuts, and menu-command wiring (App.tsx AppContent)
 * are the production ones; only the backend boundary is faked
 * (test-utils/appState). jsdom's navigator is not a Mac, so the frontend
 * handles the accelerators as it does with the custom window frame on
 * Windows and Linux.
 */

import ModalSurface from '@shared/components/modals/ModalSurface';
import { useModalFocusTrap } from '@shared/components/modals/useModalFocusTrap';
import { act, useId, useRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';
import { CommandPalette } from './CommandPalette';
import type { Command } from './CommandPaletteCommands';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const command = (id: string, label: string, category: string): Command => ({
  id,
  label,
  category,
  action: vi.fn(),
});

/** A shared app modal (ModalSurface with the modal focus trap), open. */
function OpenModal() {
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocusTrap({ ref: modalRef, disabled: false });
  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy={titleId}
      onClose={() => undefined}
      closeOnBackdrop={false}
    >
      <h2 id={titleId}>Blocking modal</h2>
      <button type="button">Inside modal</button>
    </ModalSurface>
  );
}

const primary = (): KeyboardEventInit => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true });

const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  await app.settle();
  return event;
};

/** Delivers a native menu event, as the backend does. */
const menu = async (name: string) => {
  await act(async () => {
    app.events.emit(name);
  });
  await app.settle();
};

const palette = () => document.querySelector<HTMLDialogElement>('dialog.command-palette');

const input = () =>
  requireValue(
    document.querySelector<HTMLInputElement>('.command-palette [role="combobox"]'),
    'expected the command-palette input'
  );

const groups = () =>
  Array.from(document.querySelectorAll('.command-palette legend')).map((legend) =>
    legend.textContent?.trim()
  );

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
});

describe('CommandPalette in the keyboard system', () => {
  it('keeps Tab inside the open palette and returns focus to its invoker on Escape', async () => {
    view = await app.render(null);
    await view.show(
      <>
        <button type="button">Invoker</button>
        <CommandPalette commands={[]} />
      </>
    );
    const invoker = requireValue(
      view.container.querySelector<HTMLButtonElement>('button'),
      'expected the invoker'
    );
    invoker.focus();

    await menu('open-command-palette');

    const dialog = requireValue(palette(), 'expected the palette');
    expect(dialog.open).toBe(true);
    // A native dialog supplies the dialog role itself.
    expect(dialog.hasAttribute('role')).toBe(false);
    expect(view.container.hasAttribute('inert')).toBe(true);
    for (const shiftKey of [false, true]) {
      const event = await press('Tab', { shiftKey });
      expect(event.defaultPrevented).toBe(true);
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await press('Escape');

    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it('keeps an open palette and its query when the palette is invoked again', async () => {
    view = await app.render(null);
    await view.show(<CommandPalette commands={[command('first', 'First', 'Application')]} />);
    await press('p', { ...primary(), shiftKey: true });
    await act(async () => {
      const field = input();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'fir');
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });

    await press('p', { ...primary(), shiftKey: true });
    await menu('open-command-palette');

    expect(palette()).not.toBeNull();
    expect(input().value).toBe('fir');
  });

  it('switches an open palette to the kubeconfig picker on Cmd/Ctrl+O', async () => {
    view = await app.render(null);
    await view.show(
      <CommandPalette
        commands={[
          command('first', 'First', 'Application'),
          command('kc-a', 'cluster-a', 'Kubeconfigs'),
        ]}
      />
    );
    await menu('open-command-palette');
    expect(groups()).toEqual(['Application', 'Kubeconfigs']);

    await press('o', primary());

    expect(palette()).not.toBeNull();
    expect(groups()).toEqual(['Kubeconfigs']);
  });

  it('switches an open palette to the namespace picker on Cmd/Ctrl+Shift+N', async () => {
    view = await app.render(null);
    await view.show(
      <CommandPalette
        commands={[
          command('first', 'First', 'Application'),
          command('ns-prod', 'prod', 'Namespaces'),
        ]}
      />
    );
    await menu('open-command-palette');
    expect(groups()).toEqual(['Application', 'Namespaces']);

    await press('N', { ...primary(), shiftKey: true });

    expect(palette()).not.toBeNull();
    expect(groups()).toEqual(['Namespaces']);
  });

  it('does not open from any entry point while another modal is open', async () => {
    view = await app.render(null);
    await view.show(
      <>
        <OpenModal />
        <CommandPalette
          commands={[
            command('first', 'First', 'Application'),
            command('ns-prod', 'prod', 'Namespaces'),
            command('kc-a', 'cluster-a', 'Kubeconfigs'),
          ]}
        />
      </>
    );

    await menu('open-command-palette');
    await press('p', { ...primary(), shiftKey: true });
    await menu('open-cluster');
    await press('N', { ...primary(), shiftKey: true });

    expect(palette()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
