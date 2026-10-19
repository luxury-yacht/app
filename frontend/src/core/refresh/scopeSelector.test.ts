/**
 * frontend/src/core/refresh/scopeSelector.test.ts
 *
 * The refresh scope codec: typed selectors in, canonical scope strings out, and
 * the authored contract examples that the backend codec executes too.
 */

import { describe, expect, it } from 'vitest';

import { refreshDomainContract } from './domainRegistry';
import {
  buildRefreshScope,
  parseRefreshScope,
  type RefreshScope,
  type ScopeSelector,
} from './scopeSelector';
import type { RefreshDomain } from './types';

const deployment = {
  namespace: 'prod',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  name: 'web',
};

describe('refresh scope codec', () => {
  it('runs every domain through the authored scope examples', () => {
    for (const [domain, inventory] of Object.entries(refreshDomainContract.domainInventory)) {
      const refreshDomain = domain as RefreshDomain;
      for (const tail of inventory.scopeContract.valid) {
        const raw = `c1|${tail}`;
        const parsed = parseRefreshScope(refreshDomain, raw);
        expect(parsed.clusterId, `${domain} ${raw}`).toBe('c1');
        expect(buildRefreshScope(refreshDomain, parsed), `${domain} ${raw}`).toBe(raw);
      }
      for (const tail of inventory.scopeContract.invalid ?? []) {
        expect(() => parseRefreshScope(refreshDomain, `c1|${tail}`), `${domain} ${tail}`).toThrow();
      }
    }
  });

  it.each<[RefreshDomain, string, Omit<RefreshScope, 'clusterId'>]>([
    [
      'pods',
      'c1|namespace:prod',
      { selector: { kind: 'namespace', namespace: 'prod' }, query: '' },
    ],
    [
      'pods',
      'c1|namespace:all?limit=50',
      { selector: { kind: 'all-namespaces' }, query: 'limit=50' },
    ],
    ['pods', 'c1|node:worker-1', { selector: { kind: 'node', node: 'worker-1' }, query: '' }],
    [
      'pods',
      'c1|workload:prod:apps:v1:Deployment:web',
      { selector: { kind: 'workload', object: deployment }, query: '' },
    ],
    [
      'object-details',
      'c1|__cluster__:rbac.authorization.k8s.io/v1:ClusterRole:system:node',
      {
        selector: {
          kind: 'object',
          object: {
            namespace: '',
            group: 'rbac.authorization.k8s.io',
            version: 'v1',
            kind: 'ClusterRole',
            name: 'system:node',
          },
        },
        query: '',
      },
    ],
    [
      'object-map',
      'c1|namespace:apps/v1:Deployment:web?maxNodes=5',
      {
        selector: { kind: 'object', object: { ...deployment, namespace: 'namespace' } },
        query: 'maxNodes=5',
      },
    ],
    [
      'object-helm-values',
      'c1|__cluster__:web',
      { selector: { kind: 'helm-release', namespace: '', name: 'web' }, query: '' },
    ],
    [
      'catalog',
      'c1|limit=50&kinds=Pod',
      { selector: { kind: 'cluster' }, query: 'limit=50&kinds=Pod' },
    ],
  ])('decodes %s scope %s', (domain, raw, expected) => {
    expect(parseRefreshScope(domain, raw)).toEqual({ clusterId: 'c1', ...expected });
  });

  // Cluster ids are "<kubeconfig file>:<context>" and either part may contain a
  // comma, so the prefix is one opaque cluster id, never a list.
  it('keeps a comma-containing cluster id as one cluster', () => {
    expect(parseRefreshScope('pods', 'prod,eu.yaml:ctx|namespace:prod')).toEqual({
      clusterId: 'prod,eu.yaml:ctx',
      selector: { kind: 'namespace', namespace: 'prod' },
      query: '',
    });
  });

  // RBAC names only forbid "/" and "%", so "?" is a legal name character. It and
  // the escape character are escaped so a name never reads as a query.
  it('round-trips object names containing "?" and "%"', () => {
    const role = (name: string): ScopeSelector => ({
      kind: 'object',
      object: {
        namespace: 'team-a',
        group: 'rbac.authorization.k8s.io',
        version: 'v1',
        kind: 'Role',
        name,
      },
    });

    const detail = buildRefreshScope('object-details', {
      clusterId: 'c1',
      selector: role('reader?team'),
    });
    expect(detail).toBe('c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%3Fteam');
    expect(parseRefreshScope('object-details', detail).selector).toEqual(role('reader?team'));

    const map = buildRefreshScope('object-map', {
      clusterId: 'c1',
      selector: role('reader?team'),
      query: 'maxNodes=5',
    });
    expect(parseRefreshScope('object-map', map)).toEqual({
      clusterId: 'c1',
      selector: role('reader?team'),
      query: 'maxNodes=5',
    });

    const percent = buildRefreshScope('object-yaml', { clusterId: 'c1', selector: role('50%off') });
    expect(parseRefreshScope('object-yaml', percent).selector).toEqual(role('50%off'));
  });

  it('rejects malformed escapes in object names', () => {
    expect(() =>
      parseRefreshScope('object-details', 'c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%team')
    ).toThrow();
    expect(() =>
      parseRefreshScope(
        'object-details',
        'c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%3fteam'
      )
    ).toThrow();
  });

  it('rejects unprefixed and out-of-grammar scopes', () => {
    expect(() => parseRefreshScope('pods', 'namespace:prod')).toThrow();
    expect(() => parseRefreshScope('namespace-config', 'c1|node:worker-1')).toThrow();
  });

  it('refuses to build a scope with a selector the domain does not accept', () => {
    const node: ScopeSelector = { kind: 'node', node: 'worker-1' };
    expect(() =>
      buildRefreshScope('namespace-config', { clusterId: 'c1', selector: node })
    ).toThrow();
    expect(() => buildRefreshScope('pods', { clusterId: '', selector: node })).toThrow();
  });
});
