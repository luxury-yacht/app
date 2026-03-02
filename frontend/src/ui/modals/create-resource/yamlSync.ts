/**
 * frontend/src/ui/modals/create-resource/yamlSync.ts
 *
 * Bidirectional sync helpers between YAML content and form field values.
 * YAML is the source of truth — the form reads via getFieldValue and
 * writes via setFieldValue, which preserves comments and formatting
 * for untouched nodes.
 */

import * as YAML from 'yaml';

/**
 * Read a value from a YAML string at the given path.
 * Returns the JS-native value (string, number, object, array) or undefined
 * if the path does not exist or the YAML is unparseable.
 */
export function getFieldValue(yamlContent: string, path: string[]): unknown {
  try {
    const doc = YAML.parseDocument(yamlContent);
    if (doc.errors.length > 0) return undefined;
    const value = doc.getIn(path);
    if (value === undefined || value === null) return undefined;
    if (YAML.isNode(value)) return (value as YAML.Node).toJSON();
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Set a value in a YAML string at the given path and return the updated
 * YAML string. Preserves comments and formatting for untouched nodes.
 * Returns null if the YAML is unparseable.
 */
export function setFieldValue(yamlContent: string, path: string[], value: unknown): string | null {
  try {
    const doc = YAML.parseDocument(yamlContent);
    if (doc.errors.length > 0) return null;
    doc.setIn(path, value);
    return doc.toString();
  } catch {
    return null;
  }
}
