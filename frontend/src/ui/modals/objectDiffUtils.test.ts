/**
 * frontend/src/components/modals/objectDiffUtils.test.ts
 *
 * Test suite for objectDiffUtils.
 * Covers sanitization behavior for diff-ready YAML.
 */

import { describe, expect, it } from 'vitest';
import {
  buildIgnoredMetadataLineSet,
  maskMutedMetadataLines,
  sanitizeYamlForDiff,
} from './objectDiffUtils';

describe('sanitizeYamlForDiff', () => {
  it('removes ignored metadata fields but retains muted fields', () => {
    const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
  uid: "abc"
  resourceVersion: "123"
  creationTimestamp: "2020-01-01T00:00:00Z"
  managedFields:
    - manager: kubectl
data:
  key: value
`;

    const result = sanitizeYamlForDiff(yaml);
    expect(result).toContain('name: demo');
    expect(result).toContain('data:');
    expect(result).not.toContain('managedFields');
    expect(result).toContain('resourceVersion');
    expect(result).toContain('creationTimestamp');
    expect(result).toContain('uid');
  });

  it('returns the original string when YAML parsing fails', () => {
    const yaml = 'kind: [broken';
    expect(sanitizeYamlForDiff(yaml)).toBe(yaml);
  });

  it('returns an empty string for blank input', () => {
    expect(sanitizeYamlForDiff('   ')).toBe('');
  });
});

describe('buildIgnoredMetadataLineSet', () => {
  it('tracks muted metadata fields and their nested lines', () => {
    const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
  uid: "abc"
  resourceVersion: "123"
  creationTimestamp: "2020-01-01T00:00:00Z"
  managedFields:
    - manager: kubectl
      operation: Update
spec:
  uid: "keep-visible"
data:
  key: value
`;
    const muted = buildIgnoredMetadataLineSet(yaml);
    expect(muted.has(5)).toBe(true); // uid
    expect(muted.has(6)).toBe(true); // resourceVersion
    expect(muted.has(7)).toBe(true); // creationTimestamp
    expect(muted.has(8)).toBe(false); // managedFields
    expect(muted.has(9)).toBe(false); // managedFields list entry
    expect(muted.has(10)).toBe(false); // managedFields list entry
    expect(muted.has(4)).toBe(false); // name
    expect(muted.has(11)).toBe(false); // spec
    expect(muted.has(12)).toBe(false); // spec uid (non-metadata)
  });
});

describe('maskMutedMetadataLines', () => {
  it('masks muted fields while preserving line count', () => {
    const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
  uid: "abc"
  resourceVersion: "123"
  creationTimestamp: "2020-01-01T00:00:00Z"
data:
  key: value
`;
    const muted = buildIgnoredMetadataLineSet(yaml);
    const masked = maskMutedMetadataLines(yaml, muted);
    const maskedLines = masked.split('\n');
    expect(maskedLines).toHaveLength(yaml.split('\n').length);
    expect(maskedLines[4]).toBe('  uid: <muted>');
    expect(maskedLines[5]).toBe('  resourceVersion: <muted>');
    expect(maskedLines[6]).toBe('  creationTimestamp: <muted>');
    expect(maskedLines[3]).toBe('  name: demo');
  });
});
