/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/FinalizersSection.test.tsx
 *
 * Renders a terminating object's finalizers inside the real app shell: Remove goes through the
 * real object action controller, its confirmation dialog, and the backend action. Only the
 * backend boundary is faked (test-utils/appState).
 */

import type { CapabilityState } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import FinalizersSection from './FinalizersSection';
import type { NamespaceFinalizationDetails } from './objectDetailModel';

const app = installAppStateHarness();

const allowed: CapabilityState = { allowed: true, pending: false };

const textOf = (container: HTMLElement, selector: string): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>(selector)).map((element) =>
    (element.textContent ?? '').trim()
  );

describe('FinalizersSection', () => {
  let view: MountedApp;
  let container: HTMLElement;
  let objectData: ObjectPanelRef;

  beforeEach(async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default', 'terminating']);
    objectData = {
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'Namespace',
      namespace: '',
      name: 'terminating',
    };
    view = await app.render(null);
    container = view.container;
  });

  const renderSection = async ({
    removalCapabilities = { metadata: allowed, namespaceSpec: allowed },
    finalizers = ['example.com/metadata-cleanup'],
    namespaceFinalization = {
      finalizers: ['kubernetes'],
      conditions: [],
    } as NamespaceFinalizationDetails | null,
  } = {}) => {
    const onAfterAction = vi.fn();
    await view.show(
      <FinalizersSection
        deletion={{ deletionTimestamp: '2026-08-09T12:34:56Z', finalizers }}
        namespaceFinalization={namespaceFinalization}
        objectData={objectData}
        removalCapabilities={removalCapabilities}
        onAfterAction={onAfterAction}
      />
    );
    return onAfterAction;
  };

  it('lists every finalizer without redundant classification chips', async () => {
    await renderSection();

    expect(textOf(container, '.deletion-finalizer-name')).toEqual([
      'example.com/metadata-cleanup',
      'kubernetes',
    ]);
    expect(container.querySelector('.deletion-finalizer-row .status-chip')).toBeNull();
  });

  it('sorts finalizer names alphabetically', async () => {
    const finalizers = ['example.com/a-cleanup', 'example.com/a.cleanup', 'example.com/a_cleanup'];
    await renderSection({ finalizers, namespaceFinalization: null });

    expect(textOf(container, '.deletion-finalizer-name')).toEqual(
      [...finalizers].sort((left, right) => left.localeCompare(right))
    );
  });

  it('leaves the force-removal consequence to the confirmation dialog', async () => {
    await renderSection();

    expect(container.querySelector('.deletion-finalizer-removal')).toBeNull();
    expect(container.textContent).not.toContain('Force removal');
    expect(container.textContent).not.toContain('You may force the removal');
  });

  it('removes each row’s finalizer through its own API path after confirmation', async () => {
    app.backend.answer('RunObjectAction', () => ({}));
    const onAfterAction = await renderSection();

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.deletion-remove-button')
    );
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Remove finalizer example.com/metadata-cleanup',
      'Remove finalizer kubernetes',
    ]);

    const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
    const removeThroughDialog = async (button: HTMLButtonElement) => {
      const removed = app.backend.calls('RunObjectAction').length;
      await act(async () => {
        button.click();
      });
      const confirm = requireValue(
        Array.from(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
          (candidate) => candidate.textContent === 'Remove'
        ),
        'finalizer removal confirmation'
      );
      // Nothing is removed until the user confirms.
      expect(app.backend.calls('RunObjectAction')).toHaveLength(removed);
      await act(async () => {
        confirm.click();
      });
      await app.settle();
    };

    await removeThroughDialog(buttons[0]);
    await removeThroughDialog(buttons[1]);

    const target = {
      clusterId: objectData.clusterId,
      group: '',
      version: 'v1',
      kind: 'Namespace',
      namespace: '',
      name: 'terminating',
    };
    expect(app.backend.calls('RunObjectAction')).toEqual([
      [
        {
          action: 'removeFinalizer',
          target,
          finalizer: 'example.com/metadata-cleanup',
          finalizerPath: 'metadata.finalizers',
        },
      ],
      [
        {
          action: 'removeFinalizer',
          target,
          finalizer: 'kubernetes',
          finalizerPath: 'spec.finalizers',
        },
      ],
    ]);
    expect(onAfterAction).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
  });

  it('uses the shared danger button treatment for Remove', async () => {
    await renderSection();

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.deletion-remove-button')
    );
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.classList.contains('danger'))).toBe(true);
  });

  it('names the API field path on every row once a spec finalizer list is present', async () => {
    await renderSection();
    expect(textOf(container, '.deletion-finalizer-path')).toEqual([
      'metadata.finalizers',
      'spec.finalizers',
    ]);

    await renderSection({ finalizers: [] });
    expect(textOf(container, '.deletion-finalizer-path')).toEqual(['spec.finalizers']);
  });

  it('leaves the field path off when metadata.finalizers is the only list', async () => {
    await renderSection({ namespaceFinalization: null });

    expect(textOf(container, '.deletion-finalizer-path')).toEqual([]);
    expect(textOf(container, '.deletion-finalizer-name')).toEqual(['example.com/metadata-cleanup']);
  });

  it('keeps a permission-denied Remove button visible and disabled with the reason', async () => {
    await renderSection({
      removalCapabilities: {
        metadata: allowed,
        namespaceSpec: {
          allowed: false,
          pending: false,
          reason: 'Missing update namespaces/finalize',
        },
      },
    });

    const namespaceButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove finalizer kubernetes"]'
    );
    expect(namespaceButton?.disabled).toBe(true);
    expect(namespaceButton?.title).toBe('Missing update namespaces/finalize');
  });

  it('disables Remove while the permission check is still in flight', async () => {
    await renderSection({
      removalCapabilities: {
        metadata: { allowed: false, pending: true },
        namespaceSpec: allowed,
      },
    });

    const pendingButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove finalizer example.com/metadata-cleanup"]'
    );
    expect(pendingButton?.disabled).toBe(true);
    expect(pendingButton?.title).toBe('Checking permission…');
  });

  it('keeps the deletion-condition message on screen next to its chip', async () => {
    await renderSection({
      namespaceFinalization: {
        finalizers: ['kubernetes'],
        conditions: [
          {
            type: 'NamespaceDeletionContentFailure',
            status: 'True',
            reason: 'ContentDeletionFailed',
            message: 'Failed to delete all resource types',
          },
          {
            type: 'NamespaceFinalizersRemaining',
            status: 'Unknown',
            reason: 'SomeFinalizersRemain',
          },
        ],
      },
    });

    const chips = Array.from(
      container.querySelectorAll<HTMLElement>('.deletion-condition .status-chip')
    );
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'NamespaceDeletionContentFailure',
      'NamespaceFinalizersRemaining',
    ]);
    expect(chips[0].className).toContain('status-chip--unhealthy');
    expect(chips[1].className).toContain('status-chip--warning');
    // The message is the diagnosis for a stuck namespace — it stays readable
    // without hovering. A condition without one falls back to its reason.
    expect(textOf(container, '.deletion-condition-message')).toEqual([
      'Failed to delete all resource types',
      'SomeFinalizersRemain',
    ]);
    expect(container.querySelector('.deletion-card')).toBeNull();
  });

  it('drops deletion conditions that report no problem', async () => {
    await renderSection({
      namespaceFinalization: {
        finalizers: ['kubernetes'],
        conditions: [
          {
            type: 'NamespaceDeletionDiscoveryFailure',
            status: 'False',
            reason: 'ResourcesDiscovered',
            message: 'All resources successfully discovered',
          },
        ],
      },
    });

    // These condition types are negative-polarity, so False carries no
    // diagnosis — surfacing it would bury the conditions that do.
    expect(container.querySelector('.deletion-conditions')).toBeNull();
    expect(container.textContent).not.toContain('All resources successfully discovered');
  });
});
