/**
 * frontend/src/components/modals/objectDiffUtils.test.ts
 *
 * Test suite for objectDiffUtils.
 * Covers sanitization behavior for diff-ready YAML.
 */

import { describe, expect, it } from 'vitest';
import { sanitizeYamlForDiff } from './objectDiffUtils';

describe('sanitizeYamlForDiff', () => {
  it('removes managedFields and resourceVersion from metadata', () => {
    const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
  resourceVersion: "123"
  managedFields:
    - manager: kubectl
data:
  key: value
`;

    const result = sanitizeYamlForDiff(yaml);
    expect(result).toContain('name: demo');
    expect(result).toContain('data:');
    expect(result).not.toContain('managedFields');
    expect(result).not.toContain('resourceVersion');
  });

  it('returns the original string when YAML parsing fails', () => {
    const yaml = 'kind: [broken';
    expect(sanitizeYamlForDiff(yaml)).toBe(yaml);
  });

  it('returns an empty string for blank input', () => {
    expect(sanitizeYamlForDiff('   ')).toBe('');
  });
});
