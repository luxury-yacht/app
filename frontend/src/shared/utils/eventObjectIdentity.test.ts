import { describe, expect, it } from 'vitest';
import { buildEventObjectReference, splitEventObjectTarget } from './eventObjectIdentity';

describe('splitEventObjectTarget', () => {
  it('parses linkable involved-object values', () => {
    expect(splitEventObjectTarget('Pod/api-123')).toEqual({
      objectType: 'Pod',
      objectName: 'api-123',
      isLinkable: true,
    });
  });

  it('marks incomplete involved-object values as non-linkable', () => {
    expect(splitEventObjectTarget('Pod')).toEqual({
      objectType: 'Pod',
      objectName: '-',
      isLinkable: false,
    });
  });
});

describe('buildEventObjectReference', () => {
  it('builds a reference from the event object and apiVersion', () => {
    expect(
      buildEventObjectReference({
        object: 'Widget/sample',
        objectApiVersion: 'widgets.example.io/v1alpha1',
        objectNamespace: 'default',
        clusterId: 'cluster-a',
      })
    ).toEqual({
      kind: 'Widget',
      name: 'sample',
      namespace: 'default',
      group: 'widgets.example.io',
      version: 'v1alpha1',
      clusterId: 'cluster-a',
      clusterName: undefined,
      kindAlias: undefined,
      resource: undefined,
      uid: undefined,
    });
  });

  it('falls back to the parent object GVK when the event omits apiVersion for the same kind', () => {
    expect(
      buildEventObjectReference({
        object: 'Database/primary',
        eventNamespace: 'databases',
        fallbackKind: 'Database',
        fallbackGroup: 'db.example.io',
        fallbackVersion: 'v1',
      })
    ).toEqual({
      kind: 'Database',
      name: 'primary',
      namespace: 'databases',
      group: 'db.example.io',
      version: 'v1',
      clusterId: undefined,
      clusterName: undefined,
      kindAlias: undefined,
      resource: undefined,
      uid: undefined,
    });
  });

  it('returns undefined when it cannot resolve a version', () => {
    expect(
      buildEventObjectReference({
        object: 'Database/primary',
      })
    ).toBeUndefined();
  });
});
