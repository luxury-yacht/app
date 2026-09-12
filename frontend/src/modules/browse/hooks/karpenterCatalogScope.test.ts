import { describe, expect, it } from 'vitest';
import { buildBrowseCatalogPageScope, buildBrowseCatalogPlan } from './browseCatalogData';

describe('Resource-family catalog scope', () => {
  it.each(['karpenter', 'argocd'])(
    'retains %s in data, metadata, page and export requests and changes scope identity',
    (family) => {
      const input = {
        clusterId: 'cluster-a',
        clusterScopedOnly: family === 'karpenter',
        customOnly: true,
        resourceFamily: family,
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
        expect(new URLSearchParams(scope.split('|')[1]).get('resourceFamily')).toBe(family);
      }
      expect(plan.scopeIdentityKey).not.toBe(
        buildBrowseCatalogPlan({ ...input, resourceFamily: undefined }).scopeIdentityKey
      );
    }
  );
});
