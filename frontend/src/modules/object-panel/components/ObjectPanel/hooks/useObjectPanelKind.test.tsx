/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelKind.test.tsx
 *
 * Test suite for useObjectPanelKind.
 * Covers key behaviors and edge cases for useObjectPanelKind.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PanelObjectData } from '../types';
import { useObjectPanelKind } from './useObjectPanelKind';

type HookResult = ReturnType<typeof useObjectPanelKind>;

describe('useObjectPanelKind', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: HookResult | null } = { current: null };

  const renderHook = async (objectData: PanelObjectData | null, clusterScope?: string) => {
    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelKind(objectData, { clusterScope });
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return resultRef.current!;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('normalises kind casing and builds scopes for standard resources', async () => {
    const result = await renderHook({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });

    expect(result.objectKind).toBe('pod');
    expect(result.detailScope).toBe('team-a:pod:api');
    expect(result.helmScope).toBeNull();
    expect(result.isHelmRelease).toBe(false);
    expect(result.isEvent).toBe(false);
  });

  it('falls back to cluster scope when namespace is empty', async () => {
    const result = await renderHook(
      {
        kind: 'HelmRelease',
        name: 'shopping-cart',
        namespace: '',
      },
      '__cluster__'
    );

    expect(result.objectKind).toBe('helmrelease');
    expect(result.detailScope).toBe('__cluster__:helmrelease:shopping-cart');
    expect(result.helmScope).toBe('__cluster__:shopping-cart');
    expect(result.isHelmRelease).toBe(true);
  });

  it('marks event resources with event-specific flag', async () => {
    const result = await renderHook({
      kind: 'Event',
      name: 'warning-123',
      namespace: 'default',
    });

    expect(result.isEvent).toBe(true);
    expect(result.detailScope).toBe('default:event:warning-123');
  });
});
