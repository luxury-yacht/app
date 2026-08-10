import type { CapabilityState } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { ObjectActionData } from '@shared/hooks/useObjectActions';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeletionSection from './DeletionSection';

const requestFinalizerRemovalMock = vi.hoisted(() => vi.fn());
const controllerOptionsMock = vi.hoisted(() => vi.fn());

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

describe('DeletionSection', () => {
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
  });

  const renderSection = async (
    removalCapabilities = {
      metadata: allowed,
      namespaceSpec: allowed,
    }
  ) => {
    const onAfterAction = vi.fn();
    await act(async () => {
      root.render(
        <DeletionSection
          deletion={{
            deletionTimestamp: '2026-08-09T12:34:56Z',
            finalizers: ['example.com/metadata-cleanup'],
          }}
          namespaceFinalization={{
            finalizers: ['kubernetes'],
            conditions: [],
          }}
          objectData={objectData}
          removalCapabilities={removalCapabilities}
          onAfterAction={onAfterAction}
        />
      );
      await Promise.resolve();
    });
    return onAfterAction;
  };

  it('shows the force-removal warning and Remove button for every finalizer', async () => {
    await renderSection();

    const finalizerCards = Array.from(
      container.querySelectorAll<HTMLElement>('.deletion-finalizer-card')
    );
    expect(finalizerCards).toHaveLength(2);
    expect(
      finalizerCards.every(
        (card) =>
          card.querySelector('.deletion-finalizer-header') &&
          card.querySelector('.deletion-finalizer-diagnostics') &&
          card.querySelector('[role="note"]')
      )
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll('.deletion-finalizer-removal-title')).map(
        (element) => element.textContent
      )
    ).toEqual(['Force removal', 'Force removal']);

    expect(
      Array.from(container.querySelectorAll('.deletion-finalizer-removal-warning')).map(
        (element) => element.textContent
      )
    ).toEqual([
      'You may force the removal of this Finalizer. This may leave objects in an unknown or bad state.',
      'You may force the removal of this Finalizer. This may leave objects in an unknown or bad state.',
    ]);

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(['Remove', 'Remove']);

    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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

  it('keeps a permission-denied Remove button visible and disabled with the reason', async () => {
    await renderSection({
      metadata: allowed,
      namespaceSpec: {
        allowed: false,
        pending: false,
        reason: 'Missing update namespaces/finalize',
      },
    });

    const namespaceButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove finalizer kubernetes"]'
    );
    expect(namespaceButton?.disabled).toBe(true);
    expect(namespaceButton?.title).toBe('Missing update namespaces/finalize');
  });
});
