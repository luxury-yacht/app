import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const namespaceScopeMocks = vi.hoisted(() => ({
  loadNamespaceScope: vi.fn(),
  saveNamespaceScope: vi.fn(),
}));
const handleInlineMock = vi.hoisted(() => vi.fn());

vi.mock('./namespaceScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./namespaceScope')>()),
  loadNamespaceScope: (...args: unknown[]) => namespaceScopeMocks.loadNamespaceScope(...args),
  saveNamespaceScope: (...args: unknown[]) => namespaceScopeMocks.saveNamespaceScope(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handleInline: (...args: unknown[]) => handleInlineMock(...args),
  },
}));

import { useNamespaceScope } from './NamespaceScopeEditor';

const Probe = ({ clusterId }: { clusterId: string | undefined }) => {
  const state = useNamespaceScope(clusterId);
  return (
    <>
      <button type="button" onClick={() => state.addNamespace('production')}>
        save
      </button>
      <span role="alert">{state.error}</span>
    </>
  );
};

describe('useNamespaceScope telemetry', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    namespaceScopeMocks.loadNamespaceScope.mockReset();
    namespaceScopeMocks.loadNamespaceScope.mockResolvedValue([]);
    namespaceScopeMocks.saveNamespaceScope.mockReset();
    handleInlineMock.mockReset();
    handleInlineMock.mockImplementation((error: unknown) => ({
      message: error instanceof Error ? error.message : String(error),
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reports a persistence failure displayed by the namespace editor', async () => {
    const error = new Error('settings database is read-only');
    namespaceScopeMocks.saveNamespaceScope.mockRejectedValue(error);

    await act(async () => {
      root.render(<Probe clusterId="cluster-a" />);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('button')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'settings database is read-only'
    );
    expect(handleInlineMock).toHaveBeenCalledWith(error, {
      action: 'saveNamespaceScope',
      source: 'NamespaceScopeEditor',
      clusterId: 'cluster-a',
    });
  });

  it('reports an edit that cannot be attributed to a cluster', async () => {
    await act(async () => {
      root.render(<Probe clusterId={undefined} />);
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector('button')?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'No active cluster selected'
    );
    expect(handleInlineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'No active cluster selected — cannot save the namespace scope.',
      }),
      {
        action: 'saveNamespaceScope',
        source: 'NamespaceScopeEditor',
      }
    );
  });
});
