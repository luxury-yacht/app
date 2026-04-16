/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlMerge.ts
 *
 * Three-way merge helpers for YAML editor reload handling.
 */

import * as YAML from 'yaml';
import { YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';

const MISSING = Symbol('yaml-merge-missing');

type MergeValue = unknown | typeof MISSING;

export interface YamlMergeResult {
  mergedYaml: string | null;
  conflicts: string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const cloneValue = (value: MergeValue): MergeValue => {
  if (value === MISSING) {
    return MISSING;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item as MergeValue));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneValue(child as MergeValue)])
    );
  }
  return value;
};

const deepEqual = (left: MergeValue, right: MergeValue): boolean => {
  if (left === right) {
    return true;
  }
  if (left === MISSING || right === MISSING) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item as MergeValue, right[index] as MergeValue));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEqual(left[key] as MergeValue, right[key] as MergeValue)
    );
  }
  return false;
};

const getPathLabel = (path: string[]): string => (path.length > 0 ? path.join('.') : '<root>');

const getObjectValue = (value: MergeValue, key: string): MergeValue => {
  if (!isPlainObject(value) || !Object.prototype.hasOwnProperty.call(value, key)) {
    return MISSING;
  }
  return value[key] as MergeValue;
};

const mergeValues = (
  base: MergeValue,
  local: MergeValue,
  live: MergeValue,
  path: string[]
): { value: MergeValue; conflicts: string[] } => {
  if (deepEqual(local, live)) {
    return { value: cloneValue(local), conflicts: [] };
  }
  if (deepEqual(base, local)) {
    return { value: cloneValue(live), conflicts: [] };
  }
  if (deepEqual(base, live)) {
    return { value: cloneValue(local), conflicts: [] };
  }

  const canRecurse = [base, local, live].every(
    (value) => value === MISSING || isPlainObject(value)
  );
  if (canRecurse) {
    const keys = new Set<string>();
    [base, local, live].forEach((value) => {
      if (!isPlainObject(value)) {
        return;
      }
      Object.keys(value).forEach((key) => keys.add(key));
    });

    const merged: Record<string, unknown> = {};
    const conflicts: string[] = [];
    keys.forEach((key) => {
      const result = mergeValues(
        getObjectValue(base, key),
        getObjectValue(local, key),
        getObjectValue(live, key),
        [...path, key]
      );
      conflicts.push(...result.conflicts);
      if (result.value !== MISSING) {
        merged[key] = result.value;
      }
    });

    return { value: merged, conflicts };
  }

  return {
    value: cloneValue(local),
    conflicts: [`Conflicting changes at ${getPathLabel(path)}`],
  };
};

const parseYamlObject = (raw: string): Record<string, unknown> => {
  const docs = YAML.parseAllDocuments(raw);
  if (docs.length === 0) {
    throw new Error('YAML content cannot be empty.');
  }
  if (docs.length > 1) {
    throw new Error('Multiple YAML documents detected. Please edit one object at a time.');
  }

  const [doc] = docs;
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]?.message ?? 'Invalid YAML document.');
  }

  const parsed = doc.toJSON();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML must evaluate to a Kubernetes object (mapping).');
  }

  return parsed as Record<string, unknown>;
};

export const mergeYamlDraftWithLive = (
  baseYaml: string,
  localYaml: string,
  liveYaml: string
): YamlMergeResult => {
  try {
    const base = parseYamlObject(baseYaml);
    const local = parseYamlObject(localYaml);
    const live = parseYamlObject(liveYaml);
    const result = mergeValues(base, local, live, []);

    if (result.conflicts.length > 0) {
      return {
        mergedYaml: null,
        conflicts: result.conflicts,
      };
    }

    return {
      mergedYaml: YAML.stringify(result.value, YAML_STRINGIFY_OPTIONS),
      conflicts: [],
    };
  } catch (error) {
    return {
      mergedYaml: null,
      conflicts: [error instanceof Error ? error.message : 'Failed to merge YAML draft.'],
    };
  }
};
