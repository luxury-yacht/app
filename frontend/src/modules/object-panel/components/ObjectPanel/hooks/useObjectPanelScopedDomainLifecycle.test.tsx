/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelScopedDomainLifecycle.test.tsx
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ObjectPanelScopedDomainRef,
  resetObjectPanelScopedDomain,
  useObjectPanelScopedDomainCleanups,
  useObjectPanelScopedDomainLifecycle,
} from './useObjectPanelScopedDomainLifecycle';

const mocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  resetScopedDomain: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: (...args: unknown[]) => mocks.setScopedDomainEnabled(...args),
    resetScopedDomain: (...args: unknown[]) => mocks.resetScopedDomain(...args),
  },
}));

interface CleanupsProps {
  refs: ObjectPanelScopedDomainRef[];
  enabled: boolean;
}

interface LifecycleProps extends ObjectPanelScopedDomainRef {
  enabled: boolean;
}

const renderCleanupsHook = (initialProps: CleanupsProps) => {
  const propsRef = { current: initialProps };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const Harness: React.FC = () => {
    useObjectPanelScopedDomainCleanups(propsRef.current.refs, propsRef.current.enabled);
    return null;
  };

  act(() => {
    root.render(<Harness />);
  });

  return {
    rerender(next: CleanupsProps) {
      propsRef.current = next;
      act(() => {
        root.render(<Harness />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const renderLifecycleHook = (initialProps: LifecycleProps) => {
  const propsRef = { current: initialProps };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const Harness: React.FC = () => {
    useObjectPanelScopedDomainLifecycle(propsRef.current);
    return null;
  };

  act(() => {
    root.render(<Harness />);
  });

  return {
    rerender(next: LifecycleProps) {
      propsRef.current = next;
      act(() => {
        root.render(<Harness />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('object-panel scoped domain lifecycle', () => {
  beforeEach(() => {
    mocks.setScopedDomainEnabled.mockClear();
    mocks.resetScopedDomain.mockClear();
  });

  it('disables current panel scopes with preserveState when cleanup is disabled', () => {
    const refs: ObjectPanelScopedDomainRef[] = [
      { domain: 'object-events', scope: 'cluster-a|default:apps/v1:Deployment:api' },
      { domain: 'object-yaml', scope: 'cluster-a|default:apps/v1:Deployment:api' },
      { domain: 'object-map', scope: 'cluster-a|default:apps/v1:Deployment:api' },
    ];

    const hook = renderCleanupsHook({ refs, enabled: true });

    hook.rerender({ refs, enabled: false });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      'cluster-a|default:apps/v1:Deployment:api',
      false,
      { preserveState: true }
    );
    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-yaml',
      'cluster-a|default:apps/v1:Deployment:api',
      false,
      { preserveState: true }
    );
    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-map',
      'cluster-a|default:apps/v1:Deployment:api',
      false,
      { preserveState: true }
    );

    hook.unmount();
  });

  it('only disables replaced scopes when cleanup refs change', () => {
    const hook = renderCleanupsHook({
      refs: [
        { domain: 'object-events', scope: 'cluster-a|default:apps/v1:Deployment:api' },
        { domain: 'object-yaml', scope: 'cluster-a|default:apps/v1:Deployment:api' },
      ],
      enabled: true,
    });

    mocks.setScopedDomainEnabled.mockClear();

    hook.rerender({
      refs: [
        { domain: 'object-events', scope: 'cluster-a|default:apps/v1:Deployment:web' },
        { domain: 'object-yaml', scope: 'cluster-a|default:apps/v1:Deployment:api' },
      ],
      enabled: true,
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledTimes(1);
    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      'cluster-a|default:apps/v1:Deployment:api',
      false,
      { preserveState: true }
    );

    hook.unmount();
  });

  it('enables a tab scope normally and preserves state on teardown', () => {
    const hook = renderLifecycleHook({
      domain: 'object-events',
      scope: 'cluster-a|default:apps/v1:Deployment:api',
      enabled: true,
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      'cluster-a|default:apps/v1:Deployment:api',
      true
    );

    mocks.setScopedDomainEnabled.mockClear();
    hook.unmount();

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      'cluster-a|default:apps/v1:Deployment:api',
      false,
      { preserveState: true }
    );
  });

  it('disables and resets a scope at an explicit eviction boundary', () => {
    resetObjectPanelScopedDomain({
      domain: 'object-details',
      scope: 'cluster-a|default:apps/v1:Deployment:api',
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      'cluster-a|default:apps/v1:Deployment:api',
      false
    );
    expect(mocks.resetScopedDomain).toHaveBeenCalledWith(
      'object-details',
      'cluster-a|default:apps/v1:Deployment:api'
    );
  });
});
