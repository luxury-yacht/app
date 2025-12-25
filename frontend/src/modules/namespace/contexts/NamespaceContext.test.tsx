/**
 * frontend/src/modules/namespace/contexts/NamespaceContext.test.tsx
 *
 * Test suite for NamespaceContext.
 * Covers key behaviors and edge cases for NamespaceContext.
 */

import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceProvider, useNamespace } from './NamespaceContext';

const { mockRefreshOrchestrator, namespaceDomainRef } = vi.hoisted(() => {
  return {
    mockRefreshOrchestrator: {
      setDomainEnabled: vi.fn(),
      resetDomain: vi.fn(),
      triggerManualRefresh: vi.fn(() => Promise.resolve()),
      updateContext: vi.fn(),
    },
    namespaceDomainRef: { current: createNamespaceDomain('ready', ['alpha', 'beta']) },
  };
});

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'test' }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: mockRefreshOrchestrator,
  useRefreshDomain: (domain: string) => {
    if (domain !== 'namespaces') {
      throw new Error(`Unexpected domain requested in test: ${domain}`);
    }
    return namespaceDomainRef.current;
  },
}));

const SelectedNamespace: React.FC = () => {
  const { selectedNamespace } = useNamespace();
  return <span data-testid="selected">{selectedNamespace ?? 'none'}</span>;
};

describe('NamespaceProvider selection behaviour', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    namespaceDomainRef.current = createNamespaceDomain('ready', ['alpha', 'beta']);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderWithProvider = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    act(() => {
      root.render(
        <NamespaceProvider>
          <SelectedNamespace />
        </NamespaceProvider>
      );
    });

    const rerender = () => {
      act(() => {
        root.render(
          <NamespaceProvider>
            <SelectedNamespace />
          </NamespaceProvider>
        );
      });
    };

    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };

    return { container, rerender, cleanup };
  };

  it('keeps the selected namespace while refresh is in progress', () => {
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('alpha');

    namespaceDomainRef.current = {
      ...namespaceDomainRef.current,
      status: 'loading',
    };
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('alpha');

    namespaceDomainRef.current = createNamespaceDomain('ready', ['alpha', 'beta']);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('alpha');
    cleanup();
  });

  it('moves selection when refreshed list removes the previous namespace', () => {
    const { rerender, cleanup } = renderWithProvider();
    act(() => {
      vi.runAllTimers();
    });
    expect(getSelected()).toBe('alpha');

    namespaceDomainRef.current = createNamespaceDomain('ready', ['bravo']);
    rerender();
    act(() => {
      vi.runAllTimers();
    });

    expect(getSelected()).toBe('bravo');
    cleanup();
  });
});

function getSelected(): string {
  const element = document.querySelector('[data-testid="selected"]');
  return element?.textContent ?? '';
}

function createNamespaceDomain(status: 'ready' | 'loading' | 'idle', names: string[]) {
  return {
    status,
    data: {
      namespaces: names.map((name, index) => ({
        name,
        phase: 'Active',
        resourceVersion: String(index + 1),
        creationTimestamp: Math.floor(Date.now() / 1000),
      })),
    },
    error: null,
  };
}
