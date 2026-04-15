/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlErrors.ts
 */

import type { backend } from '@wailsjs/go/models';
import type { DiffLine, DiffLineType } from '@shared/components/diff/lineDiff';

export const OBJECT_YAML_ERROR_PREFIX = 'ObjectYAMLError:';

export interface BackendDiffLine {
  type: DiffLineType;
  value: string;
  leftLineNumber?: number | null;
  rightLineNumber?: number | null;
}

export interface ObjectYamlErrorPayload {
  code: string;
  message: string;
  diff?: BackendDiffLine[];
  truncated?: boolean;
  currentResourceVersion?: string | null;
  causes?: string[];
}

export interface YamlTabDiffResult {
  lines: DiffLine[];
  tooLarge: boolean;
}

export const parseObjectYamlError = (err: unknown): ObjectYamlErrorPayload | null => {
  const rawMessage =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  if (!rawMessage.startsWith(OBJECT_YAML_ERROR_PREFIX)) {
    return null;
  }

  const payloadText = rawMessage.slice(OBJECT_YAML_ERROR_PREFIX.length);
  try {
    const parsed = JSON.parse(payloadText) as ObjectYamlErrorPayload;
    return parsed;
  } catch {
    return null;
  }
};

export const coerceDiffResult = (payload: ObjectYamlErrorPayload): YamlTabDiffResult | null => {
  if (!payload.diff || payload.diff.length === 0) {
    if (!payload.truncated) {
      return null;
    }
    return {
      lines: [],
      tooLarge: true,
    };
  }

  return {
    lines: payload.diff.map((line) => ({
      type: line.type,
      value: line.value,
      leftLineNumber:
        line.leftLineNumber === undefined || line.leftLineNumber === null
          ? undefined
          : line.leftLineNumber,
      rightLineNumber:
        line.rightLineNumber === undefined || line.rightLineNumber === null
          ? undefined
          : line.rightLineNumber,
    })),
    tooLarge: Boolean(payload.truncated),
  };
};

export type ObjectYamlMutationResponse = backend.ObjectYAMLMutationResponse;
