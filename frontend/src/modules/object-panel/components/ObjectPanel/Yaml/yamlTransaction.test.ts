import { describe, expect, it } from 'vitest';
import {
  matchesVerifiedSnapshot,
  type RecentVerifiedSemanticEntry,
  type VerifiedPostApplyState,
} from './yamlTransaction';

const identity = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'api',
  uid: 'deployment-uid',
  resourceVersion: '42',
};

describe('matchesVerifiedSnapshot', () => {
  it('covers matchesVerifiedSnapshot scenarios', async () => {
    {
      // Scenario: accepts the exact semantic YAML verified after apply
      const semanticYaml = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n';
      const verified: VerifiedPostApplyState = { identity, semanticYaml };

      expect(matchesVerifiedSnapshot(semanticYaml, verified, [])).toBe(true);
    }

    {
      // Scenario: accepts a recent verified semantic snapshot for the same complete object reference
      const verified: VerifiedPostApplyState = {
        identity,
        semanticYaml: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec: {}\n',
      };
      const recent: RecentVerifiedSemanticEntry[] = [
        {
          reference: 'apps/v1|Deployment|default|api|deployment-uid',
          semanticYaml: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n',
        },
      ];

      expect(matchesVerifiedSnapshot(recent[0].semanticYaml, verified, recent)).toBe(true);
    }
  });
});
