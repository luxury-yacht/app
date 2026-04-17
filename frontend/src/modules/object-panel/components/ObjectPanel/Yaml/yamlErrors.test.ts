/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlErrors.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  OBJECT_YAML_ERROR_PREFIX,
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
      currentYaml: 'apiVersion: v1\nkind: Pod\nmetadata:\n  resourceVersion: "43"\n',
      currentResourceVersion: '43',
      causes: ['resourceVersion changed'],
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
