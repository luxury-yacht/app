import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkloadConfirmationModals, {
  type SimplePod,
} from '@modules/namespace/components/WorkloadConfirmationModals';
import type { WorkloadData } from '@modules/namespace/components/NsViewWorkloads.helpers';
import { KeyboardProvider } from '@ui/shortcuts';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

describe('WorkloadConfirmationModals', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const workload: WorkloadData = {
    kind: 'Deployment',
    name: 'frontend',
    namespace: 'team-a',
    status: 'Running',
  };

  const buildPod = (overrides: Partial<SimplePod> = {}): SimplePod => ({
    kind: 'Pod',
    namespace: 'team-a',
    name: 'frontend-0',
    status: 'Running',
    ready: '1/1',
    restarts: 0,
    age: '5m',
    cpuRequest: '100m',
    cpuLimit: '200m',
    cpuUsage: '50m',
    memRequest: '128Mi',
    memLimit: '256Mi',
    memUsage: '64Mi',
    ownerKind: 'Deployment',
    ownerName: 'frontend',
    ...overrides,
  });

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
  });

  const renderComponent = async (
    props: Partial<React.ComponentProps<typeof WorkloadConfirmationModals>> = {}
  ) => {
    const onPodDeleteConfirm = vi.fn();
    const onPodRestartConfirm = vi.fn();
    const onRestartConfirm = vi.fn();
    const onDeleteConfirm = vi.fn();
    const dismissPodDelete = vi.fn();
    const dismissPodRestart = vi.fn();
    const dismissRestart = vi.fn();
    const dismissDelete = vi.fn();

    const finalProps: React.ComponentProps<typeof WorkloadConfirmationModals> = {
      podDeleteConfirm: { show: false, pod: null },
      podRestartConfirm: { show: false, pod: null },
      restartConfirm: { show: false, workload: null },
      deleteConfirm: { show: false, workload: null },
      onPodDeleteConfirm,
      onPodRestartConfirm,
      onRestartConfirm,
      onDeleteConfirm,
      dismissPodDelete,
      dismissPodRestart,
      dismissRestart,
      dismissDelete,
      ...props,
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <WorkloadConfirmationModals {...finalProps} />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    return {
      onPodDeleteConfirm,
      onPodRestartConfirm,
      onRestartConfirm,
      onDeleteConfirm,
      dismissPodDelete,
      dismissPodRestart,
      dismissRestart,
      dismissDelete,
    };
  };

  it('renders nothing when all confirmations are closed', async () => {
    await renderComponent();
    expect(document.querySelectorAll('.confirmation-modal').length).toBe(0);
  });

  it('renders all modals when confirmations are open and invokes callbacks', async () => {
    const callbacks = await renderComponent({
      podDeleteConfirm: { show: true, pod: buildPod() },
      podRestartConfirm: {
        show: true,
        pod: buildPod({ name: 'frontend-1' }),
      },
      restartConfirm: { show: true, workload },
      deleteConfirm: { show: true, workload },
    });

    const modals = document.querySelectorAll('.confirmation-modal');
    expect(modals.length).toBe(4);

    const buttons = document.querySelectorAll('.confirmation-modal-footer .button');
    const [
      cancelPodDelete,
      confirmPodDelete,
      ,
      confirmPodRestart,
      ,
      confirmRestart,
      ,
      confirmDelete,
    ] = buttons;

    await act(async () => {
      confirmPodDelete?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirmPodRestart?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirmRestart?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirmDelete?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(callbacks.onPodDeleteConfirm).toHaveBeenCalled();
    expect(callbacks.onPodRestartConfirm).toHaveBeenCalled();
    expect(callbacks.onRestartConfirm).toHaveBeenCalled();
    expect(callbacks.onDeleteConfirm).toHaveBeenCalled();

    await act(async () => {
      cancelPodDelete?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(callbacks.dismissPodDelete).toHaveBeenCalled();
  });
});
