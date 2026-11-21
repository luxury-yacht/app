/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/definedKind.test.ts
 *
 * Which kind a CustomResourceDefinition's Explain tab explains: the custom kind
 * it defines, at a version the cluster actually serves.
 */

import type { apiextensions } from '@core/backend-api/models';
import { describe, expect, it } from 'vitest';
import type { ObjectDetail } from '@/core/refresh/types';
import { definedKindOf } from './definedKind';

const certificates = (
  versions: apiextensions.CRDVersion[]
): ObjectDetail<'customresourcedefinition'> => ({
  detailType: 'customresourcedefinition',
  details: {
    kind: 'CustomResourceDefinition',
    name: 'certificates.cert-manager.io',
    group: 'cert-manager.io',
    scope: 'Namespaced',
    details: 'Certificate',
    versions,
    names: { plural: 'certificates', singular: 'certificate', kind: 'Certificate' },
  } as apiextensions.CustomResourceDefinitionDetails,
});

describe('definedKindOf', () => {
  it('explains the custom kind at its stored version', () => {
    const detail = certificates([
      { name: 'v1alpha2', served: true, storage: false },
      { name: 'v1', served: true, storage: true },
    ]);

    expect(definedKindOf('cluster-a', detail)).toEqual({
      clusterId: 'cluster-a',
      group: 'cert-manager.io',
      version: 'v1',
      kind: 'Certificate',
      resource: 'certificates',
    });
  });

  it('falls back to a served version when the stored one is not served', () => {
    const detail = certificates([
      { name: 'v2', served: false, storage: true },
      { name: 'v1', served: true, storage: false },
    ]);

    expect(definedKindOf('cluster-a', detail)?.version).toBe('v1');
  });

  it('has nothing to explain until the definition is loaded, or when it serves no version', () => {
    expect(definedKindOf('cluster-a', null)).toBeNull();
    expect(
      definedKindOf('cluster-a', certificates([{ name: 'v1', served: false, storage: true }]))
    ).toBeNull();
  });

  it('explains nothing for an object that is not a CustomResourceDefinition', () => {
    const pod = { detailType: 'pod', details: {} } as ObjectDetail;

    expect(definedKindOf('cluster-a', pod)).toBeNull();
  });
});
