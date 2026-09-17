import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { useRuntimeOperationStatus } from './runtimeOperationStatus';

const runtime = vi.hoisted(() => ({
  listOperations: vi.fn(),
  listShells: vi.fn(),
  listForwards: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>(),
  cancellations: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock('@core/backend-api', () => ({
  ListRuntimeOperations: runtime.listOperations,
  ListShellSessions: runtime.listShells,
  ListPortForwards: runtime.listForwards,
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: (name: string, handler: (payload: unknown) => void) => {
    runtime.listeners.set(name, handler);
    const cancel = vi.fn(() => runtime.listeners.delete(name));
    runtime.cancellations.set(name, cancel);
    return cancel;
  },
}));

const forward = {
  id: 'pf-a',
  clusterId: 'cluster-a',
  namespace: 'default',
  podName: 'web',
  containerPort: 80,
  localPort: 8080,
  status: 'active',
  startedAt: '2026-05-18T00:00:00Z',
};
const operation = {
  id: forward.id,
  clusterId: forward.clusterId,
  type: 'port-forward',
  status: 'active',
  startedAt: forward.startedAt,
};

describe('useRuntimeOperationStatus', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let rows: ReturnType<typeof useRuntimeOperationStatus> | undefined;
  const onInitialReadError = vi.fn();

  function Probe({ readInitialState }: { readInitialState: boolean }) {
    rows = useRuntimeOperationStatus('cluster-a', { readInitialState, onInitialReadError });
    return null;
  }

  const render = async (readInitialState = true) => {
    await act(async () => {
      root.render(<Probe readInitialState={readInitialState} />);
    });
  };

  const emit = (name: string, payload: unknown) => {
    act(() => requireValue(runtime.listeners.get(name), `listener for ${name}`)(payload));
  };

  const unmount = () => {
    act(() => root.unmount());
    mounted = false;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runtime.listeners.clear();
    runtime.cancellations.clear();
    runtime.listOperations.mockResolvedValue([operation]);
    runtime.listShells.mockResolvedValue([]);
    runtime.listForwards.mockResolvedValue([forward]);
    rows = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) {
      unmount();
    }
    container.remove();
  });

  it('loads session details and limits them to the selected cluster and runtime registry', async () => {
    const otherForward = { ...forward, id: 'pf-b', clusterId: 'cluster-b' };
    runtime.listOperations.mockResolvedValue([
      operation,
      { ...operation, id: otherForward.id, clusterId: otherForward.clusterId },
    ]);
    runtime.listForwards.mockResolvedValue([
      forward,
      otherForward,
      { ...forward, id: 'no-longer-running' },
    ]);

    await render();

    expect(rows?.portForwardSessions.map((session) => session.id)).toEqual(['pf-a']);
  });

  it('keeps event updates active when initial reads are disabled', async () => {
    await render(false);
    expect(runtime.listOperations).not.toHaveBeenCalled();
    expect(runtime.listShells).not.toHaveBeenCalled();
    expect(runtime.listForwards).not.toHaveBeenCalled();

    emit('runtime-operations:list', [operation]);
    emit('portforward:list', [forward]);
    expect(rows?.portForwardSessions.map((session) => session.id)).toEqual(['pf-a']);

    emit('portforward:status', {
      sessionId: 'pf-a',
      status: 'reconnecting',
      statusReason: 'pod replaced',
    });
    expect(rows?.portForwardSessions[0]).toMatchObject({
      status: 'reconnecting',
      statusReason: 'pod replaced',
    });
    emit('runtime-operations:list', []);
    expect(rows?.portForwardSessions).toEqual([]);
  });

  it('reports an initial detail read failure and recovers from the next list event', async () => {
    const error = new Error('read failed');
    runtime.listForwards.mockRejectedValueOnce(error);
    await render();

    expect(onInitialReadError).toHaveBeenCalledWith(error, 'port-forward-sessions');
    expect(rows?.portForwardSessions).toEqual([]);
    emit('portforward:list', [forward]);
    expect(rows?.portForwardSessions.map((session) => session.id)).toEqual(['pf-a']);
  });

  it.each([
    { resource: 'runtime-operations', read: runtime.listOperations },
    { resource: 'shell-sessions', read: runtime.listShells },
  ])('continues hydration after $resource fails', async ({ resource, read }) => {
    const failure = new Error('initial read failed');
    read.mockRejectedValueOnce(failure);

    await render();

    expect(onInitialReadError).toHaveBeenCalledWith(failure, resource);
    expect(runtime.listOperations).toHaveBeenCalledTimes(1);
    expect(runtime.listShells).toHaveBeenCalledTimes(1);
    expect(runtime.listForwards).toHaveBeenCalledTimes(1);
    expect(rows?.portForwardSessions.map((session) => session.id)).toEqual(['pf-a']);
    expect(runtime.listOperations.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.listShells.mock.invocationCallOrder[0]
    );
    expect(runtime.listShells.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.listForwards.mock.invocationCallOrder[0]
    );
  });

  it('does not start port-forward hydration after unmounting during the shell read', async () => {
    let resolveShells: ((sessions: never[]) => void) | undefined;
    runtime.listShells.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveShells = resolve;
        })
    );
    await render();
    expect(runtime.listShells).toHaveBeenCalledTimes(1);
    expect(runtime.listForwards).not.toHaveBeenCalled();

    unmount();
    await act(async () => requireValue(resolveShells, 'pending shell read')([]));

    expect(runtime.listForwards).not.toHaveBeenCalled();
  });

  it('unsubscribes and stops the initial read sequence when unmounted', async () => {
    let resolveOperations: ((operations: (typeof operation)[]) => void) | undefined;
    runtime.listOperations.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOperations = resolve;
        })
    );
    await render();
    expect(runtime.listOperations).toHaveBeenCalledTimes(1);

    unmount();
    expect(runtime.listeners.size).toBe(0);
    for (const cancel of runtime.cancellations.values()) {
      expect(cancel).toHaveBeenCalledTimes(1);
    }
    await act(async () => requireValue(resolveOperations, 'pending operations read')([operation]));
    expect(runtime.listShells).not.toHaveBeenCalled();
    expect(runtime.listForwards).not.toHaveBeenCalled();
  });
});
