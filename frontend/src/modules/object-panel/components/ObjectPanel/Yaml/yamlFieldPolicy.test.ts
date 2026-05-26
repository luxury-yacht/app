import { describe, expect, it } from 'vitest';
import {
  resolveProtectedYamlRanges,
  sanitizeYamlForSemanticCompare,
  yamlFieldPolicyEntries,
} from './yamlFieldPolicy';

describe('yamlFieldPolicy', () => {
  it('loads the backend-owned contract', () => {
    expect(
      yamlFieldPolicyEntries.some((entry) => entry.path.join('.') === 'metadata.managedFields')
    ).toBe(true);
    expect(yamlFieldPolicyEntries.some((entry) => entry.backendBehavior === 'preserve')).toBe(true);
  });

  it('strips ignored server-owned fields for semantic comparison and prunes empty maps', () => {
    const submitted = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
spec:
  replicas: 2
`;
    const stored = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "99"
  uid: abc
  annotations:
    deployment.kubernetes.io/revision: "3"
    kubectl.kubernetes.io/last-applied-configuration: '{"kind":"Deployment"}'
status:
  replicas: 2
spec:
  replicas: 2
`;

    expect(sanitizeYamlForSemanticCompare(stored)).toBe(sanitizeYamlForSemanticCompare(submitted));
    expect(sanitizeYamlForSemanticCompare(stored)).not.toContain('annotations:');
  });

  it('keeps meaningful user-controlled semantic differences', () => {
    const left = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
data:
  key: old
`;
    const right = left.replace('old', 'new');

    expect(sanitizeYamlForSemanticCompare(left)).not.toBe(sanitizeYamlForSemanticCompare(right));
  });

  it('resolves protected ranges for scalars, annotation keys, managedFields, flow maps, and status', () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata: {name: demo, namespace: default, resourceVersion: "12", annotations: {"deployment.kubernetes.io/revision": "3"}}
status:
  replicas: 2
`;

    const ranges = resolveProtectedYamlRanges(yaml);
    const protectedText = ranges.map((range) => yaml.slice(range.from, range.to));

    expect(protectedText.some((text) => text.includes('apiVersion: apps/v1'))).toBe(true);
    expect(protectedText.some((text) => text.includes('kind: Deployment'))).toBe(true);
    expect(protectedText.some((text) => text.includes('resourceVersion: "12"'))).toBe(true);
    expect(
      protectedText.some((text) => text.includes('"deployment.kubernetes.io/revision": "3"'))
    ).toBe(true);
    expect(protectedText.some((text) => text.includes('status:'))).toBe(true);
    expect(ranges.every((range) => range.blockedMessage)).toBe(true);
  });

  it('keeps adjacent scalar protected fields on their own lines', () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`;

    const ranges = resolveProtectedYamlRanges(yaml);
    const apiVersionRange = ranges.find((range) => range.blockedMessage?.startsWith('apiVersion '));
    const kindRange = ranges.find((range) => range.blockedMessage?.startsWith('kind '));

    expect(apiVersionRange).toBeTruthy();
    expect(kindRange).toBeTruthy();
    expect(yaml.slice(apiVersionRange?.from, apiVersionRange?.to)).toBe('apiVersion: apps/v1');
    expect(yaml.slice(kindRange?.from, kindRange?.to)).toBe('kind: Deployment');
  });

  it('does not create managedFields ranges when managedFields are hidden or absent', () => {
    const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app.kubernetes.io/managed-by: Helm
  name: demo
  namespace: default
spec:
  replicas: 1
`;

    const ranges = resolveProtectedYamlRanges(yaml);
    const managedFieldsRange = ranges.find((range) =>
      range.blockedMessage?.startsWith('metadata.managedFields ')
    );
    const nameRange = ranges.find((range) => range.blockedMessage?.startsWith('metadata.name '));

    expect(managedFieldsRange).toBeUndefined();
    expect(nameRange).toBeTruthy();
    expect(nameRange?.tooltip).toBe('Kubernetes object names cannot be changed in place.');
    expect(yaml.slice(nameRange?.from, nameRange?.to)).toBe('  name: demo');
  });

  it('returns no protected ranges for invalid YAML', () => {
    expect(resolveProtectedYamlRanges('metadata:\n  name: [')).toEqual([]);
  });

  it('includes adjacent comments with protected fields', () => {
    const yaml = `# identity comment
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
`;

    const ranges = resolveProtectedYamlRanges(yaml);
    expect(
      ranges.some((range) => yaml.slice(range.from, range.to).startsWith('# identity comment'))
    ).toBe(true);
  });
});
