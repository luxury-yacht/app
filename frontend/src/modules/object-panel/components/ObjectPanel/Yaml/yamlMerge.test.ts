import { describe, expect, it } from 'vitest';
import { mergeYamlDraftWithLive } from './yamlMerge';

describe('mergeYamlDraftWithLive', () => {
  it('merges non-overlapping local and live changes', () => {
    const base = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "10"
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: nginx:1.25
`;
    const local = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "10"
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: app
          image: nginx:1.25
`;
    const live = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "11"
  annotations:
    reloadedAt: "now"
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: app
          image: nginx:1.26
`;

    const result = mergeYamlDraftWithLive(base, local, live);

    expect(result.conflicts).toEqual([]);
    expect(result.mergedYaml).toContain('resourceVersion: "11"');
    expect(result.mergedYaml).toContain('replicas: 2');
    expect(result.mergedYaml).toContain('reloadedAt: now');
    expect(result.mergedYaml).toContain('image: nginx:1.26');
  });

  it('reports conflicts when the same scalar field changed both ways', () => {
    const base = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
data:
  mode: original
`;
    const local = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
data:
  mode: local
`;
    const live = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
data:
  mode: live
`;

    const result = mergeYamlDraftWithLive(base, local, live);

    expect(result.mergedYaml).toBeNull();
    expect(result.conflicts).toEqual(['Conflicting changes at data.mode']);
  });

  it('treats arrays as atomic and reports conflicts when both sides changed them', () => {
    const base = `apiVersion: v1
kind: Pod
metadata:
  name: demo
spec:
  containers:
    - name: app
      image: nginx:1.25
`;
    const local = `apiVersion: v1
kind: Pod
metadata:
  name: demo
spec:
  containers:
    - name: app
      image: nginx:1.26
`;
    const live = `apiVersion: v1
kind: Pod
metadata:
  name: demo
spec:
  containers:
    - name: sidecar
      image: busybox:1.0
`;

    const result = mergeYamlDraftWithLive(base, local, live);

    expect(result.mergedYaml).toBeNull();
    expect(result.conflicts).toEqual(['Conflicting changes at spec.containers']);
  });
});
