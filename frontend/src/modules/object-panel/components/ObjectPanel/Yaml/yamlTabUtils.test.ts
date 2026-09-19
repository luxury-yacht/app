import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import {
  normalizeYamlString,
  prepareDraftYaml,
  sanitizeYamlForSemanticCompare,
} from './yamlTabUtils';

describe('sanitizeYamlForSemanticCompare', () => {
  it('ignores generated deployment and client-side apply annotations', () => {
    const submitted = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
spec:
  replicas: 2
`.trim();
    const stored = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  annotations:
    deployment.kubernetes.io/revision: "3"
    deployment.kubernetes.io/desired-replicas: "2"
    deployment.kubernetes.io/max-replicas: "3"
    kubectl.kubernetes.io/last-applied-configuration: '{"kind":"Deployment"}'
spec:
  replicas: 2
`.trim();

    expect(sanitizeYamlForSemanticCompare(stored)).toBe(sanitizeYamlForSemanticCompare(submitted));
  });

  it('keeps user-authored annotations in semantic comparisons', () => {
    const submitted = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
spec:
  replicas: 2
`.trim();
    const stored = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  annotations:
    app.example.com/restarted-by: jane
spec:
  replicas: 2
`.trim();

    expect(sanitizeYamlForSemanticCompare(stored)).not.toBe(
      sanitizeYamlForSemanticCompare(submitted)
    );
  });
});

describe('YAML draft preparation', () => {
  it('retains comments and application fields while selectively hiding managed fields', () => {
    const source = `# keep editor context
apiVersion: v1
kind: ConfigMap
metadata:
  name: settings
  managedFields:
    - manager: controller
data:
  message: hello
`;
    for (const includeManagedFields of [false, true]) {
      const prepared = prepareDraftYaml(source, includeManagedFields);
      expect(prepared).toContain('# keep editor context');
      const parsed = YAML.parse(prepared);
      expect(parsed).toMatchObject({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'settings' },
        data: { message: 'hello' },
      });
      expect(parsed.metadata.managedFields).toEqual(
        includeManagedFields ? [{ manager: 'controller' }] : undefined
      );
    }
    expect(YAML.parse(normalizeYamlString(source)).metadata.managedFields).toEqual([
      { manager: 'controller' },
    ]);
  });

  it('preserves a malformed draft verbatim instead of replacing the user input', () => {
    const source = 'apiVersion: [unfinished';
    expect(normalizeYamlString(source)).toBe(source);
    expect(prepareDraftYaml(source, false)).toBe(source);
    expect(prepareDraftYaml(source, true)).toBe(source);
  });
});
