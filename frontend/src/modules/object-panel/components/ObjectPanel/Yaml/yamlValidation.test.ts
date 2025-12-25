/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlValidation.test.ts
 *
 * Tests for yamlValidation.
 */
import { describe, it, expect } from 'vitest';
import { validateYamlDraft, parseObjectIdentity, type ObjectIdentity } from './yamlValidation';

const baseIdentity: ObjectIdentity = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  name: 'demo',
  namespace: 'default',
  resourceVersion: '42',
};

const baseYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "42"
spec:
  replicas: 1
`;

describe('validateYamlDraft', () => {
  it('accepts valid YAML matching identity and resourceVersion', () => {
    const result = validateYamlDraft(baseYaml, baseIdentity, '42');
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.resourceVersion).toBe('42');
    }
  });

  it('rejects multi-document payloads', () => {
    const result = validateYamlDraft(`${baseYaml}---\nkind: ConfigMap\n`, baseIdentity, '42');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.message).toMatch(/Multiple YAML documents/i);
    }
  });

  it('rejects mismatched kind', () => {
    const yaml = baseYaml.replace('Deployment', 'StatefulSet');
    const result = validateYamlDraft(yaml, baseIdentity, '42');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.message).toMatch(/kind mismatch/i);
    }
  });

  it('rejects namespace drift', () => {
    const yaml = baseYaml.replace('namespace: default', 'namespace: other');
    const result = validateYamlDraft(yaml, baseIdentity, '42');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.message).toMatch(/namespace mismatch/i);
    }
  });

  it('rejects missing resourceVersion', () => {
    const yaml = baseYaml.replace('resourceVersion: "42"', '');
    const result = validateYamlDraft(yaml, baseIdentity, '42');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.message).toMatch(/resourceVersion is required/i);
    }
  });

  it('rejects resourceVersion drift', () => {
    const yaml = baseYaml.replace('"42"', '"43"');
    const result = validateYamlDraft(yaml, baseIdentity, '42');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.message).toMatch(/differs from the value when edit mode began/i);
    }
  });
});

describe('parseObjectIdentity', () => {
  it('extracts identity fields from YAML', () => {
    const identity = parseObjectIdentity(baseYaml);
    expect(identity).toEqual(baseIdentity);
  });

  it('returns null for invalid YAML', () => {
    expect(parseObjectIdentity('not: [valid')).toBeNull();
  });
});
