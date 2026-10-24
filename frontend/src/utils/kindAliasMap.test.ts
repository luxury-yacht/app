/**
 * frontend/src/utils/kindAliasMap.test.ts
 *
 * Command-palette kind tokens resolve to their canonical kind: short names,
 * kinds, resource plurals, and kubectl short names, all from the kind facets.
 */

import { describe, expect, it } from 'vitest';
import { aliasToKindMap, canonicalKinds } from './kindAliasMap';

describe('aliasToKindMap', () => {
  it.each([
    ['deploy', 'Deployment'],
    ['deployments', 'Deployment'],
    ['deploys', 'Deployment'],
    ['po', 'Pod'],
    ['cj', 'CronJob'],
    ['cron', 'CronJob'],
    ['np', 'NetworkPolicy'],
    ['networkpolicies', 'NetworkPolicy'],
    ['gtw', 'Gateway'],
    ['crds', 'CustomResourceDefinition'],
    ['ingressclasses', 'IngressClass'],
    ['helm', 'HelmRelease'],
  ])('resolves %s to %s', (token, kind) => {
    expect(aliasToKindMap.get(token)).toBe(kind);
  });

  it('lists each canonical kind once, lowercased', () => {
    expect(canonicalKinds).toContain('deployment');
    expect(new Set(canonicalKinds).size).toBe(canonicalKinds.length);
  });
});
