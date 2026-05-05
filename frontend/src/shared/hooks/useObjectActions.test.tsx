import { afterEach, describe, expect, it } from 'vitest';

import { eventBus } from '@/core/events';
import { buildObjectActionItems } from './useObjectActions';
import {
  OBJECT_ACTION_IDS,
  objectActionLabel,
  type ObjectActionId,
} from '@shared/actions/objectActionDescriptors';
import type { ContextMenuItem } from '@shared/components/ContextMenu';

const findAction = (
  items: ContextMenuItem[],
  actionId: ObjectActionId
): ContextMenuItem | undefined => items.find((item) => item.actionId === actionId);

describe('buildObjectActionItems', () => {
  afterEach(() => {
    eventBus.clear();
  });

  it('omits the map panel item when no handler is provided (default for unsupported views)', () => {
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
    const item = findAction(items, OBJECT_ACTION_IDS.viewMap);
    expect(item).toBeUndefined();
  });

  it('adds the map panel item when a handler is provided and invokes it on click', () => {
    let invoked = false;
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
        onObjectMap: () => {
          invoked = true;
        },
      },
      permissions: {},
    });
    const item = findAction(items, OBJECT_ACTION_IDS.viewMap);
    expect(item).toBeTruthy();
    if (!item || !('onClick' in item)) {
      throw new Error('map panel item missing onClick');
    }
    item.onClick?.();
    expect(invoked).toBe(true);
  });

  it('adds shared object navigation labels without shortcut hints', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
      },
      context: 'object-map',
      handlers: {
        onOpen: () => undefined,
        onObjectMap: () => undefined,
        onNavigateView: () => undefined,
      },
      permissions: {},
    });

    expect(items.slice(0, 3)).toMatchObject([
      {
        actionId: OBJECT_ACTION_IDS.viewDetails,
        label: objectActionLabel(OBJECT_ACTION_IDS.viewDetails),
      },
      { actionId: OBJECT_ACTION_IDS.viewMap, label: objectActionLabel(OBJECT_ACTION_IDS.viewMap) },
      {
        actionId: OBJECT_ACTION_IDS.goToTable,
        label: objectActionLabel(OBJECT_ACTION_IDS.goToTable),
      },
    ]);
    expect(items.slice(0, 3).some((item) => 'shortcut' in item)).toBe(false);
  });

  it('omits table navigation when already in a grid table', () => {
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
        onObjectMap: () => undefined,
        onNavigateView: () => undefined,
      },
      permissions: {},
    });

    expect(findAction(items, OBJECT_ACTION_IDS.goToTable)).toBeUndefined();
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

    const diffItem = findAction(items, OBJECT_ACTION_IDS.diff);
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

  it('adds a Diff action in object-panel context when the object identity is resolvable', () => {
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

    const diffItem = findAction(items, OBJECT_ACTION_IDS.diff);
    expect(diffItem).toBeTruthy();
  });

  it('preserves optional catalog identity on emitted diff requests', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        group: 'apps',
        version: 'v1',
        resource: 'deployments',
        uid: 'deploy-uid',
      },
      context: 'gridtable',
      handlers: {
        onOpen: () => undefined,
      },
      permissions: {},
    });

    const diffItem = findAction(items, OBJECT_ACTION_IDS.diff);
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
        clusterName: 'Cluster A',
        namespace: 'apps',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        name: 'api',
        resource: 'deployments',
        uid: 'deploy-uid',
      },
    });
  });

  it('places the divider below the ungated navigation and Diff section', () => {
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
        onRestart: () => undefined,
      },
      permissions: {
        restart: { allowed: true, pending: false },
      },
    });

    expect(items[0]).toMatchObject({ actionId: OBJECT_ACTION_IDS.viewDetails });
    expect(items[1]).toMatchObject({ actionId: OBJECT_ACTION_IDS.diff });
    expect(items[2]).toMatchObject({ divider: true });
    expect(items[3]).toMatchObject({ label: 'Restart' });
  });

  it('uses one divider between navigation actions and Delete when no custom actions render', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'ConfigMap',
        name: 'app-config',
        namespace: 'apps',
        clusterId: 'cluster-a',
      },
      context: 'gridtable',
      handlers: {
        onOpen: () => undefined,
        onDelete: () => undefined,
      },
      permissions: {
        delete: { allowed: true, pending: false },
      },
    });

    expect(items.map((item) => ('divider' in item ? 'divider' : item.label))).toEqual([
      objectActionLabel(OBJECT_ACTION_IDS.viewDetails),
      objectActionLabel(OBJECT_ACTION_IDS.diff),
      'divider',
      objectActionLabel(OBJECT_ACTION_IDS.delete),
    ]);
  });

  it('does not leave a trailing divider when Delete is unavailable', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Secret',
        name: 'app-secret',
        namespace: 'apps',
        clusterId: 'cluster-a',
      },
      context: 'gridtable',
      handlers: {
        onOpen: () => undefined,
        onDelete: () => undefined,
      },
      permissions: {
        delete: { allowed: false, pending: false },
      },
    });

    expect(items.map((item) => ('divider' in item ? 'divider' : item.label))).toEqual([
      objectActionLabel(OBJECT_ACTION_IDS.viewDetails),
      objectActionLabel(OBJECT_ACTION_IDS.diff),
    ]);
  });

  it('adds a disabled port-forward action when the target is missing cluster scope', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Pod',
        name: 'api-123',
        namespace: 'apps',
      },
      context: 'gridtable',
      handlers: {
        onOpen: () => undefined,
        onPortForward: () => undefined,
      },
      permissions: {
        portForward: { allowed: true, pending: false },
      },
    });

    const portForwardItem = items.find(
      (item) => 'label' in item && item.label?.includes('Port Forward')
    );
    expect(portForwardItem).toMatchObject({
      label: 'Port Forward',
      disabled: true,
    });
  });

  it('adds a disabled port-forward action when the target GVK is unsupported', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Deployment',
        name: 'api',
        namespace: 'apps',
        clusterId: 'cluster-a',
        group: 'extensions',
        version: 'v1beta1',
      },
      context: 'object-panel',
      handlers: {
        onPortForward: () => undefined,
      },
      permissions: {
        portForward: { allowed: true, pending: false },
      },
    });

    const portForwardItem = items.find(
      (item) => 'label' in item && item.label?.includes('Port Forward')
    );
    expect(portForwardItem).toMatchObject({
      label: 'Port Forward',
      disabled: true,
    });
  });

  it('adds a disabled port-forward action when the target exposes no forwardable ports', () => {
    const items = buildObjectActionItems({
      object: {
        kind: 'Pod',
        name: 'api-123',
        namespace: 'apps',
        clusterId: 'cluster-a',
        portForwardAvailable: false,
      },
      context: 'gridtable',
      handlers: {
        onPortForward: () => undefined,
      },
      permissions: {
        portForward: { allowed: true, pending: false },
      },
    });

    const portForwardItem = items.find(
      (item) => 'label' in item && item.label?.includes('Port Forward')
    );
    expect(portForwardItem).toMatchObject({
      label: 'Port Forward',
      disabled: true,
    });
  });
});
