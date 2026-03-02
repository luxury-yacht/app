import { describe, expect, it } from 'vitest';
import { getFormDefinition, allFormDefinitions, type ResourceFormDefinition } from './formDefinitions';

describe('formDefinitions', () => {
  it('returns a definition for each supported kind', () => {
    const supportedKinds = ['Deployment', 'Service', 'ConfigMap', 'Secret', 'Job', 'CronJob', 'Ingress'];
    for (const kind of supportedKinds) {
      const def = getFormDefinition(kind);
      expect(def, `missing form definition for ${kind}`).toBeDefined();
      expect(def!.kind).toBe(kind);
    }
  });

  it('returns undefined for unsupported kinds', () => {
    expect(getFormDefinition('Pod')).toBeUndefined();
    expect(getFormDefinition('DaemonSet')).toBeUndefined();
    expect(getFormDefinition('')).toBeUndefined();
  });

  it('has no duplicate field keys within a definition', () => {
    for (const def of allFormDefinitions) {
      const allKeys = new Set<string>();
      const collectKeys = (fields: ResourceFormDefinition['sections'][0]['fields']) => {
        for (const field of fields) {
          expect(allKeys.has(field.key), `duplicate key "${field.key}" in ${def.kind}`).toBe(false);
          allKeys.add(field.key);
          if (field.fields) {
            // Group-list sub-fields are scoped — only check within their parent.
            const subKeys = new Set<string>();
            for (const sub of field.fields) {
              expect(subKeys.has(sub.key), `duplicate sub-key "${sub.key}" in ${def.kind}/${field.key}`).toBe(false);
              subKeys.add(sub.key);
            }
          }
        }
      };
      for (const section of def.sections) {
        collectKeys(section.fields);
      }
    }
  });

  it('every field has a non-empty path', () => {
    for (const def of allFormDefinitions) {
      for (const section of def.sections) {
        for (const field of section.fields) {
          expect(field.path.length, `empty path for ${def.kind}/${field.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every select field has at least one option', () => {
    for (const def of allFormDefinitions) {
      for (const section of def.sections) {
        for (const field of section.fields) {
          if (field.type === 'select') {
            expect(field.options?.length, `no options for select ${def.kind}/${field.key}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
