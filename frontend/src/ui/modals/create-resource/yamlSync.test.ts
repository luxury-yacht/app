import { describe, expect, it } from 'vitest';
import { getFieldValue, setFieldValue } from './yamlSync';

describe('yamlSync', () => {
  const sampleYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: default
  labels:
    app: my-app
spec:
  # Number of replicas
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: my-app
        image: nginx:latest
        ports:
        - containerPort: 80
`;

  describe('getFieldValue', () => {
    it('reads a scalar value from a YAML path', () => {
      expect(getFieldValue(sampleYaml, ['metadata', 'name'])).toBe('my-app');
    });

    it('reads a numeric value from a YAML path', () => {
      expect(getFieldValue(sampleYaml, ['spec', 'replicas'])).toBe(3);
    });

    it('reads a nested map as a plain object', () => {
      const labels = getFieldValue(sampleYaml, ['metadata', 'labels']);
      expect(labels).toEqual({ app: 'my-app' });
    });

    it('reads a list as a plain array', () => {
      const containers = getFieldValue(sampleYaml, [
        'spec',
        'template',
        'spec',
        'containers',
      ]) as Record<string, unknown>[];
      expect(Array.isArray(containers)).toBe(true);
      expect(containers[0].name).toBe('my-app');
    });

    it('returns undefined for non-existent paths', () => {
      expect(getFieldValue(sampleYaml, ['spec', 'nonexistent'])).toBeUndefined();
    });

    it('returns undefined for invalid YAML', () => {
      expect(getFieldValue('invalid: yaml: :', ['spec'])).toBeUndefined();
    });
  });

  describe('setFieldValue', () => {
    it('updates a scalar value at a YAML path', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'name'], 'new-name');
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['metadata', 'name'])).toBe('new-name');
    });

    it('updates a numeric value at a YAML path', () => {
      const result = setFieldValue(sampleYaml, ['spec', 'replicas'], 5);
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['spec', 'replicas'])).toBe(5);
    });

    it('preserves comments in untouched nodes', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'name'], 'changed');
      expect(result).not.toBeNull();
      expect(result).toContain('# Number of replicas');
    });

    it('preserves fields not referenced by the set operation', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'name'], 'changed');
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['kind'])).toBe('Deployment');
      expect(getFieldValue(result!, ['spec', 'replicas'])).toBe(3);
    });

    it('updates a nested map value', () => {
      const result = setFieldValue(sampleYaml, ['metadata', 'labels'], {
        app: 'new-app',
        tier: 'frontend',
      });
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['metadata', 'labels'])).toEqual({
        app: 'new-app',
        tier: 'frontend',
      });
    });

    it('updates a list value', () => {
      const newContainers = [
        { name: 'container-a', image: 'alpine:latest' },
        { name: 'container-b', image: 'busybox:latest' },
      ];
      const result = setFieldValue(
        sampleYaml,
        ['spec', 'template', 'spec', 'containers'],
        newContainers
      );
      expect(result).not.toBeNull();
      const containers = getFieldValue(result!, [
        'spec',
        'template',
        'spec',
        'containers',
      ]) as Record<string, unknown>[];
      expect(containers).toHaveLength(2);
      expect(containers[0].name).toBe('container-a');
      expect(containers[1].name).toBe('container-b');
    });

    it('creates intermediate nodes for paths that do not exist yet', () => {
      const minimalYaml = `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: test\n`;
      const result = setFieldValue(minimalYaml, ['data', 'MY_KEY'], 'MY_VALUE');
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['data', 'MY_KEY'])).toBe('MY_VALUE');
    });

    it('returns null for unparseable YAML', () => {
      const result = setFieldValue('invalid: yaml: :', ['metadata', 'name'], 'test');
      expect(result).toBeNull();
    });
  });

  describe('round-trip preservation', () => {
    it('preserves unrelated fields through a set operation', () => {
      const yaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
  annotations:
    custom: value
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
`;
      const result = setFieldValue(yaml, ['spec', 'replicas'], 5);
      expect(result).not.toBeNull();
      expect(getFieldValue(result!, ['metadata', 'annotations', 'custom'])).toBe('value');
      expect(getFieldValue(result!, ['spec', 'strategy', 'type'])).toBe('RollingUpdate');
    });
  });
});
