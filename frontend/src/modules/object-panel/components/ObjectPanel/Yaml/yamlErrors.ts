/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlErrors.ts
 */

import type { backend } from '@wailsjs/go/models';

export const OBJECT_YAML_ERROR_PREFIX = 'ObjectYAMLError:';

export interface ObjectYamlErrorPayload {
  code: string;
  message: string;
  currentYaml?: string | null;
  currentResourceVersion?: string | null;
  causes?: string[];
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

export type ObjectYamlMutationResponse = backend.ObjectYAMLMutationResponse;
