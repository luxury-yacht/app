/**
 * frontend/src/components/modals/objectDiffUtils.ts
 *
 * Utility helpers for ObjectDiffModal.
 * Normalizes YAML and strips noisy metadata fields for diffing.
 */

import { YAML_STRINGIFY_OPTIONS } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlTabConfig';
import * as YAML from 'yaml';

// Ignored fields are removed entirely; muted fields remain but render dimmed in the diff.
const IGNORED_METADATA_FIELDS = new Set(['managedFields']);
const MUTED_METADATA_FIELDS = new Set(['resourceVersion', 'creationTimestamp', 'uid']);

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

    // Remove ignored fields that should not appear in the diff viewer.
    IGNORED_METADATA_FIELDS.forEach((field) => {
      doc.deleteIn(['metadata', field]);
    });

    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};

const getIndentDepth = (line: string): number => /^\s*/.exec(line)?.[0].length ?? 0;

// Replace muted field values with stable placeholders for diffing.
export const maskMutedMetadataLines = (raw: string, mutedLines: Set<number>): string => {
  if (!raw || mutedLines.size === 0) {
    return raw;
  }

  const lines = raw.split('\n');
  const masked = lines.map((line, index) => {
    const lineNumber = index + 1;
    if (!mutedLines.has(lineNumber)) {
      return line;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      return line;
    }

    const indent = /^\s*/.exec(line)?.[0] ?? '';
    if (trimmed.startsWith('-')) {
      return `${indent}- <muted>`;
    }

    const keyMatch = /^([A-Za-z0-9_-]+):/.exec(trimmed);
    if (keyMatch) {
      return `${indent}${keyMatch[1]}: <muted>`;
    }

    return `${indent}<muted>`;
  });

  return masked.join('\n');
};

const leavesIndentedBlock = (
  parentIndent: number | null,
  indent: number,
  content: string
): boolean => parentIndent !== null && content.length > 0 && indent <= parentIndent;

const isMutedMetadataField = (line: string): boolean => {
  const key = /^([A-Za-z0-9_-]+):/.exec(line)?.[1];
  return key !== undefined && MUTED_METADATA_FIELDS.has(key);
};

// Track which YAML line numbers fall under muted metadata fields for rendering.
export const buildIgnoredMetadataLineSet = (raw: string): Set<number> => {
  const lines = raw.split('\n');
  const muted = new Set<number>();
  let metadataIndent: number | null = null;
  let ignoredIndent: number | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const indent = getIndentDepth(line);

    if (leavesIndentedBlock(metadataIndent, indent, trimmed)) {
      metadataIndent = null;
      ignoredIndent = null;
    }

    if (leavesIndentedBlock(ignoredIndent, indent, trimmed)) {
      ignoredIndent = null;
    }

    if (metadataIndent === null && trimmed.startsWith('metadata:')) {
      metadataIndent = indent;
    }

    if (metadataIndent !== null && isMutedMetadataField(trimmed)) {
      ignoredIndent = indent;
    }

    if (ignoredIndent !== null) {
      muted.add(lineNumber);
    }
  });

  return muted;
};
