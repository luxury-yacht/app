import { afterEach, describe, expect, it } from 'vitest';

import { eventBus } from '@/core/events';
import { buildObjectActionItems } from './useObjectActions';

describe('buildObjectActionItems', () => {
  afterEach(() => {
    eventBus.clear();
  });

  it('adds a Diff action for gridtable objects with a resolvable identity', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
      },
      context: 'gridtable',
      handlers: {
        onOpen: () => undefined,
      },
      permissions: {},
    });

    const diffItem = items.find((item) => 'label' in item && item.label === 'Diff');
    expect(diffItem).toBeTruthy();

    let payload: unknown;
    const unsubscribe = eventBus.on('view:open-object-diff', (next) => {
      payload = next;
    });
    try {
      if (!diffItem || !('onClick' in diffItem)) {
        throw new Error('Diff item missing onClick handler');
      }
      diffItem.onClick?.();
    } finally {
      unsubscribe();
    }

    expect(payload).toMatchObject({
      left: {
        clusterId: 'cluster-a',
        namespace: 'apps',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
      },
    });
  });

  it('does not add a Diff action outside gridtable context', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
      },
      context: 'object-panel',
      handlers: {
        onOpen: () => undefined,
      },
      permissions: {},
    });

    expect(items.some((item) => 'label' in item && item.label === 'Diff')).toBe(false);
  });
});
