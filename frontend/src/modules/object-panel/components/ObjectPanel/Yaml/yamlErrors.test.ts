/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlErrors.test.ts
 *
 * Tests for yamlErrors.
 */
import { describe, it, expect } from 'vitest';
import {
  OBJECT_YAML_ERROR_PREFIX,
  coerceDiffResult,
  parseObjectYamlError,
  type ObjectYamlErrorPayload,
} from './yamlErrors';

describe('parseObjectYamlError', () => {
  it('returns null for non-matching errors', () => {
    expect(parseObjectYamlError(new Error('plain error'))).toBeNull();
  });

  it('parses structured payloads from error strings', () => {
    const payload: ObjectYamlErrorPayload = {
      code: 'ResourceVersionMismatch',
      message: 'resource drift detected',
      diff: [
        { type: 'context', value: 'metadata:' },
        { type: 'removed', value: '  resourceVersion: "42"', leftLineNumber: 3 },
        { type: 'added', value: '  resourceVersion: "43"', rightLineNumber: 3 },
      ],
      truncated: false,
      currentResourceVersion: '43',
    };

    const error = new Error(`${OBJECT_YAML_ERROR_PREFIX}${JSON.stringify(payload)}`);
    const parsed = parseObjectYamlError(error);
    expect(parsed).toEqual(payload);
  });

  it('handles invalid JSON gracefully', () => {
    const error = new Error(`${OBJECT_YAML_ERROR_PREFIX}{invalid}`);
    expect(parseObjectYamlError(error)).toBeNull();
  });
});

describe('coerceDiffResult', () => {
  it('returns null when no diff lines are present', () => {
    expect(coerceDiffResult({ code: 'Test', message: 'none' })).toBeNull();
  });

  it('maps backend diff lines into frontend result', () => {
    const result = coerceDiffResult({
      code: 'ResourceVersionMismatch',
      message: 'changed',
      diff: [
        { type: 'context', value: 'spec:' },
        { type: 'removed', value: '  replicas: 1', leftLineNumber: 5 },
        { type: 'added', value: '  replicas: 2', rightLineNumber: 5 },
      ],
      truncated: true,
    });

    expect(result).not.toBeNull();
    expect(result?.lines).toHaveLength(3);
    expect(result?.lines[1]).toMatchObject({ type: 'removed', value: '  replicas: 1' });
    expect(result?.truncated).toBe(true);
  });
});
