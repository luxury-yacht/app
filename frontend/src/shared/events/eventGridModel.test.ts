/**
 * frontend/src/shared/events/eventGridModel.test.ts
 *
 * Verifies shared Event grid row semantics so cluster, namespace, and object
 * panel Event surfaces keep search, keys, and related-object references aligned.
 */

import { describe, expect, it } from 'vitest';
import {
  clusterEventRowIdentity,
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridObjectNamespace,
  eventGridObjectReference,
  eventGridRelatedObjectInput,
  eventGridSearchText,
  eventGridStableKey,
  namespaceEventRowIdentity,
  objectPanelEventGridRow,
} from './eventGridModel';

const eventRef = (overrides: Record<string, string> = {}) => ({
  clusterId: 'cluster-a',
  group: '',
  version: 'v1',
  kind: 'Event',
  resource: 'events',
  namespace: 'prod',
  name: 'api.123',
  uid: 'event-uid',
  ...overrides,
});

describe('eventGridModel', () => {
  it('builds search text from the visible event fields', () => {
    expect(
      eventGridSearchText({
        ref: eventRef(),
        type: 'Warning',
        source: 'kubelet',
        reason: 'FailedMount',
        object: 'Pod/api',
        message: 'Unable to attach volume',
      })
    ).toEqual([
      'Event',
      'api.123',
      'prod',
      'Warning',
      'kubelet',
      'FailedMount',
      'Pod/api',
      'Unable to attach volume',
    ]);
  });

  it('uses object namespace before event namespace before the default namespace', () => {
    expect(eventGridObjectNamespace({ objectNamespace: 'object-ns', namespace: 'event-ns' })).toBe(
      'object-ns'
    );
    expect(eventGridObjectNamespace({ namespace: 'event-ns' }, 'default')).toBe('event-ns');
    expect(eventGridObjectNamespace({}, 'default')).toBe('default');
  });

  it('builds cluster-scoped stable row keys', () => {
    expect(
      eventGridStableKey(
        {
          ref: eventRef(),
          reason: 'FailedMount',
          source: 'kubelet',
          object: 'Pod/api',
          ageTimestamp: 1000,
        },
        2
      )
    ).toBe('cluster-a|prod-FailedMount-kubelet-Pod/api-1000-2');
  });

  it('builds required Event row identities for cluster and namespace views', () => {
    expect(
      clusterEventRowIdentity(
        {
          ref: eventRef(),
        },
        'unused'
      )
    ).toBe('cluster-a|/v1/Event/prod/api.123');

    expect(
      namespaceEventRowIdentity(
        {
          ref: eventRef(),
          objectNamespace: 'prod',
        },
        'default',
        'unused'
      )
    ).toBe('cluster-a|/v1/Event/prod/api.123');
  });

  it('uses the canonical Event ref instead of rebuilding identity from display fields', () => {
    const event = {
      ref: {
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Event',
        resource: 'events',
        namespace: 'events-ns',
        name: 'canonical-event',
        uid: 'event-uid',
      },
    };

    expect(clusterEventRowIdentity(event)).toBe('cluster-a|/v1/Event/events-ns/canonical-event');
    expect(namespaceEventRowIdentity(event, 'default')).toBe(
      'cluster-a|/v1/Event/events-ns/canonical-event'
    );
    expect(eventGridObjectReference(event)).toEqual(expect.objectContaining(event.ref));
    expect(eventGridActionReference(event, undefined, undefined, { action: 'open' })).toEqual(
      expect.objectContaining({ ...event.ref, action: 'open' })
    );
  });

  it('carries cluster identity and fallback GVK into related-object inputs', () => {
    expect(
      eventGridRelatedObjectInput(
        {
          object: 'Database/primary',
          objectUid: 'db-uid',
          namespace: 'events',
          objectNamespace: 'databases',
          clusterId: 'cluster-a',
          clusterName: 'alpha',
        },
        {
          fallbackKind: 'Database',
          fallbackGroup: 'db.example.io',
          fallbackVersion: 'v1',
        }
      )
    ).toEqual({
      object: 'Database/primary',
      involvedObject: undefined,
      objectUid: 'db-uid',
      objectApiVersion: undefined,
      objectNamespace: 'databases',
      eventNamespace: 'events',
      defaultNamespace: undefined,
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      fallbackKind: 'Database',
      fallbackGroup: 'db.example.io',
      fallbackVersion: 'v1',
    });
  });

  it('reports direct GVK-backed related objects as openable', () => {
    expect(
      eventGridCanOpenRelatedObject({
        object: 'Pod/api',
        objectApiVersion: 'v1',
        objectNamespace: 'prod',
        clusterId: 'cluster-a',
      })
    ).toBe(true);
  });

  it('normalizes object-panel event rows for the shared resolver', () => {
    expect(
      objectPanelEventGridRow(
        {
          objectKind: 'Pod',
          objectName: 'api',
          objectNamespace: '__cluster__',
          objectApiVersion: 'v1',
          clusterId: 'cluster-a',
        },
        '__cluster__'
      )
    ).toEqual({
      object: 'Pod/api',
      involvedObject: undefined,
      objectUid: undefined,
      objectApiVersion: 'v1',
      objectNamespace: undefined,
      clusterId: 'cluster-a',
      clusterName: undefined,
    });
  });

  it('builds object action references with Event identity and involved-object extras', () => {
    expect(
      eventGridActionReference(
        {
          ref: eventRef(),
        },
        'unused',
        'alpha',
        { involvedObject: 'Pod/api' }
      )
    ).toEqual(
      expect.objectContaining({
        kind: 'Event',
        name: 'api.123',
        namespace: 'prod',
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
        resource: 'events',
        uid: 'event-uid',
        involvedObject: 'Pod/api',
      })
    );
  });

  it('builds the Event object-panel reference from the Event itself', () => {
    expect(
      eventGridObjectReference(
        {
          ref: eventRef(),
        },
        'unused',
        'alpha'
      )
    ).toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
        kind: 'Event',
        resource: 'events',
        namespace: 'prod',
        name: 'api.123',
        uid: 'event-uid',
      })
    );
  });
});
