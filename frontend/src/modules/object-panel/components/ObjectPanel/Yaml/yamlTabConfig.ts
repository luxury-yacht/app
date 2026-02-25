/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabConfig.ts
 */

export const INACTIVE_SCOPE = '__inactive__';
export const LINT_DEBOUNCE_MS = 200;
export const LARGE_MANIFEST_THRESHOLD = 150_000;

export const YAML_STRINGIFY_OPTIONS = {
  indent: 2,
  lineWidth: 0,
  doubleQuotedAsJSON: false,
  singleQuote: false,
  defaultKeyType: 'PLAIN',
  defaultStringType: 'PLAIN',
} as const;
