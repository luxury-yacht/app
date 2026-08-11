import type { CapabilityState } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinalizersSection from './FinalizersSection';
import type { NamespaceFinalizationDetails } from './objectDetailModel';

const requestFinalizerRemovalMock = vi.hoisted(() => vi.fn());
const controllerOptionsMock = vi.hoisted(() => vi.fn());

vi.mock('@core/contexts/ZoomContext', () => ({
  useZoom: () => ({ zoomLevel: 100 }),
}));

vi.mock('@shared/hooks/useObjectActionController', () => ({
  useObjectActionController: (options: unknown) => {
    controllerOptionsMock(options);
    return {
      getMenuItems: vi.fn(() => []),
      modals: null,
      requestFinalizerRemoval: (...args: unknown[]) => requestFinalizerRemovalMock(...args),
    };
  },
}));

const objectData: ObjectPanelRef = {
  clusterId: 'cluster-a',
  group: '',
  version: 'v1',
  kind: 'Namespace',
  namespace: '',
  name: 'terminating',
};

const allowed: CapabilityState = { allowed: true, pending: false };

const textOf = (container: HTMLElement, selector: string): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>(selector)).map((element) =>
    (element.textContent ?? '').trim()
  );

describe('FinalizersSection', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    requestFinalizerRemovalMock.mockReset();
    controllerOptionsMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
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
    await act(async () => {
      root.render(
        <FinalizersSection
          deletion={{ deletionTimestamp: '2026-08-09T12:34:56Z', finalizers }}
          namespaceFinalization={namespaceFinalization}
          objectData={objectData}
          removalCapabilities={removalCapabilities}
          onAfterAction={onAfterAction}
        />
      );
      await Promise.resolve();
    });
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

  it('moves finalizer guidance into the shared tooltip beside the section title', async () => {
    await renderSection();

    expect(container.querySelector('.deletion-explanation')).toBeNull();
    expect(container.querySelector('.deletion-finalizer-guidance')).toBeNull();
    expect(container.textContent).not.toContain('There is no simple way');

    const trigger = container.querySelector<HTMLElement>(
      '.object-panel-section-title .tooltip-trigger'
    );
    expect(trigger).not.toBeNull();

    vi.useFakeTimers();
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      vi.advanceTimersByTime(250);
    });

    const tooltip = document.body.querySelector<HTMLElement>('.tooltip[role="tooltip"]');
    const paragraphs = Array.from(tooltip?.querySelectorAll('p') ?? []).map((paragraph) =>
      (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim()
    );
    expect(paragraphs).toEqual([
      'Finalizers are used to ensure that required cleanup is completed before an object is deleted. A Finalizer can block object deletion until its controller has finished its work.',
      'There is no simple way to determine what is preventing a Finalizer from completing. You may be able to get more information by checking Events, the logs of the responsible controller, or the YAML status block of this object.',
      'If you are certain that this object can be safely deleted, you can remove the finalizer(s) below.',
    ]);
    expect(tooltip?.querySelector('code')?.textContent).toBe('status');
  });

  it('leaves the force-removal consequence to the confirmation dialog', async () => {
    await renderSection();

    expect(container.querySelector('.deletion-finalizer-removal')).toBeNull();
    expect(container.textContent).not.toContain('Force removal');
    expect(container.textContent).not.toContain('You may force the removal');
  });

  it('routes each row Remove button to the matching finalizer path', async () => {
    await renderSection();

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.deletion-remove-button')
    );
    expect(buttons.map((button) => button.textContent)).toEqual(['Remove', 'Remove']);

    act(() => {
      buttons[0]?.click();
      buttons[1]?.click();
    });

    expect(requestFinalizerRemovalMock).toHaveBeenNthCalledWith(
      1,
      objectData as ObjectActionData,
      'example.com/metadata-cleanup',
      'metadata.finalizers'
    );
    expect(requestFinalizerRemovalMock).toHaveBeenNthCalledWith(
      2,
      objectData as ObjectActionData,
      'kubernetes',
      'spec.finalizers'
    );
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
