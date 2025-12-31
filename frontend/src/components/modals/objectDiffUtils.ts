/**
 * frontend/src/components/modals/objectDiffUtils.ts
 *
 * Utility helpers for ObjectDiffModal.
 * Normalizes YAML and strips noisy metadata fields for diffing.
 */

import * as YAML from 'yaml';
import { YAML_STRINGIFY_OPTIONS } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlTabConfig';

const IGNORED_METADATA_FIELDS = new Set([
  'managedFields',
  'resourceVersion',
  'creationTimestamp',
  'uid',
]);

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

    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};

const getIndentDepth = (line: string): number => line.match(/^\s*/)?.[0].length ?? 0;

// Track which YAML line numbers fall under ignored metadata fields for muted rendering.
export const buildIgnoredMetadataLineSet = (raw: string): Set<number> => {
  const lines = raw.split('\n');
  const muted = new Set<number>();
  let metadataIndent: number | null = null;
  let ignoredIndent: number | null = null;
  let metadataActive = false;
  let ignoredActive = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const indent = getIndentDepth(line);

    if (metadataActive && trimmed && metadataIndent !== null && indent <= metadataIndent) {
      metadataActive = false;
      metadataIndent = null;
      ignoredActive = false;
      ignoredIndent = null;
    }

    if (ignoredActive && trimmed && ignoredIndent !== null && indent <= ignoredIndent) {
      ignoredActive = false;
      ignoredIndent = null;
    }

    if (!metadataActive && trimmed.startsWith('metadata:')) {
      metadataActive = true;
      metadataIndent = indent;
    }

    if (metadataActive && !trimmed.startsWith('-')) {
      const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):/);
      if (keyMatch && IGNORED_METADATA_FIELDS.has(keyMatch[1])) {
        muted.add(lineNumber);
        ignoredActive = true;
        ignoredIndent = indent;
      }
    }

    if (ignoredActive) {
      muted.add(lineNumber);
    }
  });

  return muted;
};
