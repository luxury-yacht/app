import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { NamespaceContext } from '@modules/namespace/contexts/NamespaceContext';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNamespaceFilterOptions } from './useNamespaceFilterOptions';

const namespaceMock = {
  namespaces: [] as Array<{ name?: string; scope?: string; isSynthetic?: boolean }>,
};

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(
      <NamespaceContext.Provider
        value={{
          namespaces: namespaceMock.namespaces as never[],
          namespaceSummaries: [],
          namespaceMetricsState: 'unavailable',
          namespaceError: null,
          selectedNamespace: undefined,
          selectedNamespaceClusterId: undefined,
          namespaceLoading: false,
          namespacesPermissionDenied: false,
          namespaceRefreshing: false,
          namespaceReady: true,
          setSelectedNamespace: () => undefined,
          loadNamespaces: async () => undefined,
          refreshNamespaces: async () => undefined,
          getClusterNamespace: () => undefined,
        }}
      >
        <TestComponent />
      </NamespaceContext.Provider>
    );
  });

  return {
    get() {
      if (result.current === undefined) {
        throw new Error('Hook result not set');
      }
      return result.current;
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useNamespaceFilterOptions', () => {
  beforeEach(() => {
    namespaceMock.namespaces = [];
  });

  it('prefers explicit namespace metadata in All Namespaces views', () => {
    namespaceMock.namespaces = [
      { name: 'All Namespaces', scope: ALL_NAMESPACES_SCOPE, isSynthetic: true },
      { name: 'team-b', scope: 'team-b' },
      { name: 'team-a', scope: 'team-a' },
    ];

    const hook = renderHook(() =>
      useNamespaceFilterOptions(ALL_NAMESPACES_SCOPE, ['fallback-z', 'fallback-a'])
    );

    expect(hook.get()).toEqual(['team-a', 'team-b']);
    hook.cleanup();
  });

  it('falls back to row-derived namespaces when explicit metadata is unavailable', () => {
    const hook = renderHook(() =>
      useNamespaceFilterOptions(ALL_NAMESPACES_SCOPE, ['team-b', 'team-a', 'team-b'])
    );

    expect(hook.get()).toEqual(['team-a', 'team-b']);
    hook.cleanup();
  });

  it('keeps namespace-scoped views on their local fallback list', () => {
    namespaceMock.namespaces = [{ name: 'other', scope: 'other' }];

    const hook = renderHook(() => useNamespaceFilterOptions('team-a', ['team-a']));

    expect(hook.get()).toEqual(['team-a']);
    hook.cleanup();
  });
});
