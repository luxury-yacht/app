/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/rbacPermissionRows.test.ts
 *
 * The permissions table must answer "what may this role do to resource X": one row per
 * (API group, resource, resource-name restriction) with every verb granted to it, so a
 * permission split across several rules is never shown as a partial grant.
 */

import { describe, expect, it } from 'vitest';
import { buildPermissionRows } from './rbacPermissionRows';

const summary = (rules: Parameters<typeof buildPermissionRows>[0]) =>
  buildPermissionRows(rules).map((row) => ({
    resource: row.resource,
    apiGroup: row.apiGroup,
    resourceNames: row.resourceNames,
    verbs: row.verbs,
  }));

describe('buildPermissionRows', () => {
  it('expands each rule across its API groups and resources', () => {
    expect(
      summary([{ apiGroups: ['', 'events.k8s.io'], resources: ['events'], verbs: ['create'] }])
    ).toEqual([
      { resource: 'events', apiGroup: '', resourceNames: [], verbs: ['create'] },
      { resource: 'events', apiGroup: 'events.k8s.io', resourceNames: [], verbs: ['create'] },
    ]);
  });

  it('merges verbs granted to the same resource by different rules', () => {
    expect(
      summary([
        { apiGroups: [''], resources: ['secrets'], verbs: ['watch', 'get', 'list'] },
        { apiGroups: [''], resources: ['secrets', 'pods'], verbs: ['delete', 'create', 'get'] },
      ])
    ).toEqual([
      { resource: 'pods', apiGroup: '', resourceNames: [], verbs: ['get', 'create', 'delete'] },
      {
        resource: 'secrets',
        apiGroup: '',
        resourceNames: [],
        verbs: ['get', 'list', 'watch', 'create', 'delete'],
      },
    ]);
  });

  it('keeps name-restricted grants separate from grants on every object of the resource', () => {
    const rows = summary([
      { apiGroups: ['certificates.k8s.io'], resources: ['signers'], verbs: ['list'] },
      {
        apiGroups: ['certificates.k8s.io'],
        resources: ['signers'],
        resourceNames: ['kubernetes.io/legacy-unknown', 'kubernetes.io/kubelet-serving'],
        verbs: ['approve'],
      },
      {
        apiGroups: ['certificates.k8s.io'],
        resources: ['signers'],
        resourceNames: ['kubernetes.io/kubelet-serving', 'kubernetes.io/legacy-unknown'],
        verbs: ['sign'],
      },
    ]);
    expect(rows).toEqual([
      { resource: 'signers', apiGroup: 'certificates.k8s.io', resourceNames: [], verbs: ['list'] },
      {
        resource: 'signers',
        apiGroup: 'certificates.k8s.io',
        resourceNames: ['kubernetes.io/kubelet-serving', 'kubernetes.io/legacy-unknown'],
        verbs: ['approve', 'sign'],
      },
    ]);
  });

  it('lists non-resource URLs as their own rows after resource rows', () => {
    const rows = buildPermissionRows([
      { nonResourceURLs: ['/healthz', '/version'], verbs: ['get'] },
      { apiGroups: ['*'], resources: ['*'], verbs: ['*'] },
    ]);
    expect(rows.map((row) => [row.resource, row.apiGroup, row.verbs])).toEqual([
      ['*', '*', ['*']],
      ['/healthz', null, ['get']],
      ['/version', null, ['get']],
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it('returns no rows when the role has no rules', () => {
    expect(buildPermissionRows(undefined)).toEqual([]);
    expect(buildPermissionRows([])).toEqual([]);
  });
});
