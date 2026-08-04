import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const namespaceScopeMocks = vi.hoisted(() => ({
  loadNamespaceScope: vi.fn(),
  saveNamespaceScope: vi.fn(),
}));
const handleInlineMock = vi.hoisted(() => vi.fn());
const errorSurfaceMock = vi.hoisted(() => vi.fn());

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

vi.mock('@shared/components/errors/ErrorSurface', () => ({
  ErrorSurface: (props: { kind: string; message?: unknown; error?: unknown }) => {
    errorSurfaceMock(props);
    if (props.message !== undefined) {
      return String(props.message);
    }
    return props.error instanceof Error ? props.error.message : String(props.error);
  },
}));

import { NamespaceScopeAddRow, useNamespaceScope } from './NamespaceScopeEditor';

const Probe = ({ clusterId }: { clusterId: string | undefined }) => {
  const state = useNamespaceScope(clusterId);
  return (
    <>
      <button type="button" onClick={() => state.addNamespace('production')}>
        save
      </button>
      <button type="button" onClick={() => state.addNamespace('Bad!')}>
        invalid
      </button>
      <NamespaceScopeAddRow state={state} />
    </>
  );
};

const lastErrorSurfaceProps = () =>
  errorSurfaceMock.mock.calls[errorSurfaceMock.mock.calls.length - 1]?.[0];

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
    errorSurfaceMock.mockReset();
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
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'save')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.namespace-scope-error')?.textContent).toBe(
      'settings database is read-only'
    );
    expect(handleInlineMock).not.toHaveBeenCalled();
    expect(lastErrorSurfaceProps()).toEqual({
      kind: 'operational',
      error,
      context: {
        action: 'saveNamespaceScope',
        source: 'NamespaceScopeEditor',
        clusterId: 'cluster-a',
      },
    });
  });

  it('reports an edit that cannot be attributed to a cluster', async () => {
    await act(async () => {
      root.render(<Probe clusterId={undefined} />);
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'save')
        ?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('.namespace-scope-error')?.textContent).toContain(
      'No active cluster selected'
    );
    expect(handleInlineMock).not.toHaveBeenCalled();
    expect(lastErrorSurfaceProps()).toEqual({
      kind: 'operational',
      error: expect.objectContaining({
        message: 'No active cluster selected — cannot save the namespace scope.',
      }),
      context: {
        action: 'saveNamespaceScope',
        source: 'NamespaceScopeEditor',
      },
    });
  });

  it('keeps invalid namespace input as local validation', async () => {
    await act(async () => {
      root.render(<Probe clusterId="cluster-a" />);
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent === 'invalid')
        ?.click();
      await Promise.resolve();
    });

    expect(handleInlineMock).not.toHaveBeenCalled();
    expect(lastErrorSurfaceProps()).toEqual(
      expect.objectContaining({
        kind: 'validation',
        message: expect.stringContaining('Namespace'),
      })
    );
  });
});
