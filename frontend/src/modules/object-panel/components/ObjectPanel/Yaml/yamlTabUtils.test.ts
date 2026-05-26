import { describe, expect, it } from 'vitest';

import { sanitizeYamlForSemanticCompare } from './yamlTabUtils';

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
