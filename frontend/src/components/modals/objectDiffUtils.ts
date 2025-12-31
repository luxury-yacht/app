/**
 * frontend/src/components/modals/objectDiffUtils.ts
 *
 * Utility helpers for ObjectDiffModal.
 * Normalizes YAML and strips noisy metadata fields for diffing.
 */

import * as YAML from 'yaml';
import { YAML_STRINGIFY_OPTIONS } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlTabConfig';

export const sanitizeYamlForDiff = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      throw doc.errors[0];
    }

    // Remove fields that should not appear in the diff viewer.
    doc.deleteIn(['metadata', 'managedFields']);
    doc.deleteIn(['metadata', 'resourceVersion']);

    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};
