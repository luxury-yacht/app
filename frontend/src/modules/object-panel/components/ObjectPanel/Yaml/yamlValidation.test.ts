/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlValidation.test.ts
 */

import { describe, expect, it } from 'vitest';
import { type ObjectIdentity, parseObjectIdentity, validateYamlDraft } from './yamlValidation';

const baseIdentity: ObjectIdentity = {
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  name: 'demo',
  namespace: 'default',
  uid: null,
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
  it('covers validateYamlDraft scenarios', async () => {
    // Scenario: rejects empty and non-object YAML
    expect(validateYamlDraft('   ', baseIdentity, '42')).toEqual({
      isValid: false,
      message: 'YAML content is required.',
    });
    expect(validateYamlDraft('- one\n- two\n', baseIdentity, '42')).toEqual({
      isValid: false,
      message: 'YAML must evaluate to a Kubernetes object (mapping).',
    });

    {
      // Scenario: reports malformed YAML with its parse location
      const result = validateYamlDraft('apiVersion: [broken', baseIdentity, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(/Invalid YAML at line/i);
      }
    }

    for (const [_field, yaml, message] of [
      ['apiVersion', baseYaml.replace('apiVersion: apps/v1\n', ''), /Missing apiVersion/i],
      ['kind', baseYaml.replace('kind: Deployment\n', ''), /Missing kind/i],
      ['name', baseYaml.replace('  name: demo\n', ''), /Missing metadata.name/i],
    ] as const) {
      // Scenarios: rejects a draft missing %s
      const result = validateYamlDraft(yaml, baseIdentity, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(message);
      }
    }

    {
      // Scenario: rejects Kubernetes List objects
      const yaml = baseYaml.replace('kind: Deployment', 'kind: List');
      const result = validateYamlDraft(yaml, null, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(/List objects are not editable/i);
      }
    }

    {
      // Scenario: accepts valid YAML matching identity
      const result = validateYamlDraft(baseYaml, baseIdentity, '42');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.resourceVersion).toBe('42');
      }
    }

    {
      // Scenario: rejects multi-document payloads
      const result = validateYamlDraft(`${baseYaml}---\nkind: ConfigMap\n`, baseIdentity, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(/Multiple YAML documents/i);
      }
    }

    {
      // Scenario: rejects mismatched kind
      const yaml = baseYaml.replace('Deployment', 'StatefulSet');
      const result = validateYamlDraft(yaml, baseIdentity, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(/kind mismatch/i);
      }
    }

    {
      // Scenario: rejects apiVersion and name drift
      const apiVersionResult = validateYamlDraft(
        baseYaml.replace('apps/v1', 'apps/v2'),
        baseIdentity,
        '42'
      );
      expect(apiVersionResult.isValid).toBe(false);
      if (!apiVersionResult.isValid) {
        expect(apiVersionResult.message).toMatch(/apiVersion mismatch/i);
      }

      const nameResult = validateYamlDraft(
        baseYaml.replace('name: demo', 'name: renamed'),
        baseIdentity,
        '42'
      );
      expect(nameResult.isValid).toBe(false);
      if (!nameResult.isValid) {
        expect(nameResult.message).toMatch(/metadata.name mismatch/i);
      }
    }

    {
      // Scenario: rejects namespace drift
      const yaml = baseYaml.replace('namespace: default', 'namespace: other');
      const result = validateYamlDraft(yaml, baseIdentity, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(/namespace mismatch/i);
      }
    }

    {
      // Scenario: allows drafts without metadata.resourceVersion like kubectl edit
      const yaml = baseYaml.replace('resourceVersion: "42"', '');
      const result = validateYamlDraft(yaml, baseIdentity, '42');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.resourceVersion).toBeNull();
      }
    }

    {
      // Scenario: allows edited metadata.resourceVersion and leaves validation to the server
      const yaml = baseYaml.replace('"42"', '"43"');
      const result = validateYamlDraft(yaml, baseIdentity, '42');
      expect(result.isValid).toBe(true);
      if (result.isValid) {
        expect(result.resourceVersion).toBe('43');
      }
    }

    {
      // Scenario: rejects uid drift when the baseline identity includes a uid
      const identityWithUID: ObjectIdentity = {
        ...baseIdentity,
        uid: 'tracked-uid',
      };
      const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  uid: other-uid
  resourceVersion: "42"
spec:
  replicas: 1
`;
      const result = validateYamlDraft(yaml, identityWithUID, '42');
      expect(result.isValid).toBe(false);
      if (!result.isValid) {
        expect(result.message).toMatch(/uid mismatch/i);
      }
    }
  });
});

describe('parseObjectIdentity', () => {
  it('covers parseObjectIdentity scenarios', async () => {
    {
      // Scenario: extracts identity fields from YAML
      const identity = parseObjectIdentity(baseYaml);
      expect(identity).toEqual(baseIdentity);
    }
    // Scenario: returns null for invalid YAML
    expect(parseObjectIdentity('not: [valid')).toBeNull();
    // Scenario: returns null for empty, scalar, and incomplete YAML
    expect(parseObjectIdentity('')).toBeNull();
    expect(parseObjectIdentity('- one\n- two\n')).toBeNull();
    expect(parseObjectIdentity('apiVersion: v1\nmetadata:\n  name: demo\n')).toBeNull();
  });
});
