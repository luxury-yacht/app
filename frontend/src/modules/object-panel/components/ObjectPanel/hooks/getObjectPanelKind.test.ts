/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind.test.ts
 *
 * Test suite for getObjectPanelKind.
 * Covers key behaviors and edge cases for getObjectPanelKind.
 */

import { describe, expect, it } from 'vitest';

import { getObjectPanelKind } from './getObjectPanelKind';

describe('getObjectPanelKind', () => {
  it('normalises kind casing and builds scopes for standard resources', () => {
    const result = getObjectPanelKind({
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

  it('falls back to cluster scope when namespace is empty', () => {
    const result = getObjectPanelKind(
      {
        kind: 'HelmRelease',
        name: 'shopping-cart',
        namespace: '',
      },
      { clusterScope: '__cluster__' }
    );

    expect(result.objectKind).toBe('helmrelease');
    expect(result.detailScope).toBe('__cluster__:helmrelease:shopping-cart');
    expect(result.helmScope).toBe('__cluster__:shopping-cart');
    expect(result.isHelmRelease).toBe(true);
  });

  it('marks event resources with event-specific flag', () => {
    const result = getObjectPanelKind({
      kind: 'Event',
      name: 'warning-123',
      namespace: 'default',
    });

    expect(result.isEvent).toBe(true);
    expect(result.detailScope).toBe('default:event:warning-123');
  });
});
