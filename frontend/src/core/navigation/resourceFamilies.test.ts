import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resourceFamilyForObject } from './resourceFamilies';

// The generated contract is the backend's classification policy, including
// exclusions by scope; adding an API must keep navigation and catalog filtering aligned.
describe('resource family classification contract', () => {
  it('matches every backend rule and rejects wrong scopes and unrelated kinds', () => {
    const generated = readFileSync(
      resolve(import.meta.dirname, '../refresh/types.generated.ts'),
      'utf8'
    );
    const json = generated.match(/export const RESOURCE_FAMILY_RULES = ([\s\S]*?) as const;/)?.[1];
    expect(json, 'backend family rules must be generated').toBeDefined();
    const rules = JSON.parse(json ?? '[]') as {
      group?: string;
      groupPrefix?: string;
      family: string;
      kinds?: Record<string, boolean>;
    }[];
    for (const rule of rules) {
      if (rule.groupPrefix) {
        expect(
          resourceFamilyForObject(`${rule.groupPrefix}provider.example`, 'NewClass', false)
        ).toBe(rule.family);
        expect(
          resourceFamilyForObject(`${rule.groupPrefix}provider.example`, 'NewClass', true)
        ).toBeUndefined();
        expect(
          resourceFamilyForObject(`other.${rule.groupPrefix}provider`, 'NewClass', false)
        ).toBeUndefined();
        continue;
      }
      for (const [kind, namespaced] of Object.entries(rule.kinds ?? {})) {
        expect(resourceFamilyForObject(rule.group ?? '', kind.toUpperCase(), namespaced)).toBe(
          rule.family
        );
        expect(resourceFamilyForObject(rule.group ?? '', kind, !namespaced)).toBeUndefined();
        expect(resourceFamilyForObject('unrelated.io', kind, namespaced)).toBeUndefined();
      }
      expect(resourceFamilyForObject(rule.group ?? '', 'UnrelatedKind', true)).toBeUndefined();
    }
  });
});
