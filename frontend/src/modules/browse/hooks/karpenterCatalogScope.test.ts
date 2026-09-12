import { describe, expect, it } from 'vitest';
import { buildBrowseCatalogPageScope, buildBrowseCatalogPlan } from './browseCatalogData';

describe('Karpenter catalog scope', () => {
  it('retains family in data, metadata, page and export requests and changes scope identity', () => {
    const input = {
      clusterId: 'cluster-a',
      clusterScopedOnly: true,
      customOnly: true,
      resourceFamily: 'karpenter',
      pinnedNamespaces: [],
      filters: { search: '', kinds: [], namespaces: [] },
      availableNamespaces: [],
      pageLimit: 25,
    };
    const plan = buildBrowseCatalogPlan(input);
    for (const scope of [
      plan.catalogScope,
      plan.metadataScope,
      buildBrowseCatalogPageScope(plan, input, 'next'),
      buildBrowseCatalogPageScope(plan, { ...input, pageLimit: 10000 }, ''),
    ]) {
      expect(scope).toContain('cluster-a|');
      expect(new URLSearchParams(scope.split('|')[1]).get('resourceFamily')).toBe('karpenter');
    }
    expect(plan.scopeIdentityKey).not.toBe(
      buildBrowseCatalogPlan({ ...input, resourceFamily: undefined }).scopeIdentityKey
    );
  });
});
