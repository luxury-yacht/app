/**
 * frontend/src/ui/modals/create-resource/formUtils.ts
 *
 * Shared utilities for the resource creation form components.
 * Centralises helpers that were previously duplicated across
 * ResourceForm.tsx, FormKeyValueListField.tsx, FormCompactNumberInput.tsx,
 * and FormContainerResourcesField.tsx.
 */

import React from 'react';

// ─── Browser Assistance Disabling ───────────────────────────────────────

/** Shared props to disable browser text assistance across form inputs. */
export const INPUT_BEHAVIOR_PROPS = {
  autoCapitalize: 'off' as const,
  autoCorrect: 'off' as const,
  autoComplete: 'off' as const,
  spellCheck: false,
};

// ─── Nested Object Utilities ────────────────────────────────────────────

/**
 * Get a nested value from a plain JS object using a path array.
 * Used for reading sub-field values from group-list items.
 */
export function getNestedValue(obj: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Set a nested value in a plain JS object using a path array.
 * Returns a shallow-cloned copy with the value set.
 */
export function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) return obj;
  const clone = { ...obj };
  if (path.length === 1) {
    clone[path[0]] = value;
    return clone;
  }
  const child = (clone[path[0]] ?? {}) as Record<string, unknown>;
  clone[path[0]] = setNestedValue(child, path.slice(1), value);
  return clone;
}

/**
 * Remove a nested key from a plain JS object using a path array.
 * If an intermediate object becomes empty after removal, it is pruned.
 */
export function unsetNestedValue(
  obj: Record<string, unknown>,
  path: string[]
): Record<string, unknown> {
  if (path.length === 0) return obj;
  const clone = { ...obj };
  const [head, ...tail] = path;
  if (tail.length === 0) {
    delete clone[head];
    return clone;
  }

  const child = clone[head];
  if (child == null || typeof child !== 'object' || Array.isArray(child)) {
    return clone;
  }

  const nextChild = unsetNestedValue(child as Record<string, unknown>, tail);
  if (Object.keys(nextChild).length === 0) {
    delete clone[head];
  } else {
    clone[head] = nextChild;
  }
  return clone;
}

// ─── Map Conversion Utilities ───────────────────────────────────────────

/** Convert an unknown value (typically from YAML) to a Record<string, string>. */
export function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      String(entryValue ?? ''),
    ])
  );
}

/** Convert an unknown value to an array of [key, value] string pairs. */
export function toMapEntries(value: unknown): [string, string][] {
  return Object.entries(toStringMap(value));
}

// ─── Key-Value Persistence Utilities ────────────────────────────────────

/**
 * Build a persisted map from draft rows, skipping blank keys and
 * optionally excluding keys in the provided set.
 */
export function toPersistedMap(
  rows: [string, string][],
  excludedKeys?: Set<string>
): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const [k, v] of rows) {
    if (excludedKeys && excludedKeys.has(k)) continue;
    if (k) obj[k] = v;
  }
  return obj;
}

/**
 * Compare two sets of draft rows by their persisted (non-blank-key) maps.
 * Returns true when the effective key-value data is identical.
 */
export function arePersistedMapsEqual(
  leftRows: [string, string][],
  rightRows: [string, string][],
  excludedKeys?: Set<string>
): boolean {
  const left = toPersistedMap(leftRows, excludedKeys);
  const right = toPersistedMap(rightRows, excludedKeys);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (right[key] !== left[key]) return false;
  }
  return true;
}

// ─── Inline Style Utilities ─────────────────────────────────────────────

/**
 * Build inline style for a fixed-width input element.
 * Returns undefined when no inputWidth is set, so React skips the style prop.
 */
export function fixedWidthStyle(field: { inputWidth?: string }): React.CSSProperties | undefined {
  if (!field.inputWidth) return undefined;
  return {
    flex: '0 0 auto',
    width: field.inputWidth,
    minWidth: field.inputWidth,
    maxWidth: field.inputWidth,
  };
}
