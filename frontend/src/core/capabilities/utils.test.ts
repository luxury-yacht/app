/**
 * frontend/src/core/capabilities/utils.test.ts
 *
 * Test suite for utils.
 * Covers key behaviors and edge cases for utils.
 */

import { describe, expect, it } from 'vitest';

import { normalizeDescriptor } from './utils';

describe('normalizeDescriptor', () => {
  it('trims identifiers and normalizes verb casing', () => {
    expect(
      normalizeDescriptor({
        id: ' pod-delete ',
        clusterId: ' cluster-a ',
        group: ' apps ',
        version: ' v1 ',
        resourceKind: 'Deployment',
        verb: ' PATCH ',
        namespace: ' default ',
        name: ' api ',
        subresource: ' scale ',
      })
    ).toEqual({
      id: 'pod-delete',
      clusterId: 'cluster-a',
      group: 'apps',
      version: 'v1',
      resourceKind: 'Deployment',
      verb: 'patch',
      namespace: 'default',
      name: 'api',
      subresource: 'scale',
    });
  });

  it('drops blank optional fields', () => {
    expect(
      normalizeDescriptor({
        id: 'list-pods',
        resourceKind: 'Pod',
        verb: 'list',
        namespace: '   ',
      })
    ).toEqual({
      id: 'list-pods',
      clusterId: undefined,
      group: undefined,
      version: undefined,
      resourceKind: 'Pod',
      verb: 'list',
      namespace: undefined,
      name: undefined,
      subresource: undefined,
    });
  });
});
