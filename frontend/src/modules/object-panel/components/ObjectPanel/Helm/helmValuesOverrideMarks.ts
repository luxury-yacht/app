/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/helmValuesOverrideMarks.ts
 *
 * Finds the lines of the Merged or Overrides values YAML that user overrides
 * set. Follows Helm's merge: overrides win, `null` removes a key, lists are
 * replaced whole, and each subchart receives a copy of its parents' `global`
 * values, with the outermost parent winning.
 */

import * as YAML from 'yaml';
import type { ObjectHelmValuesSnapshotPayload } from '@/core/refresh/types.generated';

// Helm reads values files as YAML 1.1, so emit 1.1 quoting: strings such as
// `yes`, `on`, and `off` stay strings when copied back into a values file.
const VALUES_YAML_OPTIONS: YAML.DocumentOptions & YAML.ToStringOptions = {
  version: '1.1',
  indent: 2,
  lineWidth: 0,
  doubleQuotedAsJSON: false,
  singleQuote: false,
  defaultKeyType: 'PLAIN',
  defaultStringType: 'PLAIN',
};

export const stringifyHelmValues = (value: unknown): string =>
  YAML.stringify(value, VALUES_YAML_OPTIONS);

export type HelmValuesOverrideSource = Pick<
  ObjectHelmValuesSnapshotPayload,
  'defaults' | 'merged' | 'overrides' | 'subchartPaths'
>;

export type HelmValuesOverrideKind = 'changed' | 'added' | 'same' | 'global' | 'removed';

/** The views that show override marks. */
export type HelmValuesMarkedView = 'merged' | 'overrides';

export interface HelmValuesOverride {
  kind: HelmValuesOverrideKind;
  /** Where the value sits in Merged. */
  path: string[];
  /** The override that set it: `path` itself, or a parent's `global` value. */
  source: string[];
  /** The chart's default at `path`, or null when the chart has none. */
  chartDefault: { value: unknown } | null;
  /**
   * Text offsets of the keys the view colors: the overridden key and every key
   * inside a value the override replaces whole, such as list items' keys.
   */
  labels: HelmValuesLabel[];
}

export interface HelmValuesLabel {
  from: number;
  to: number;
}

export interface HelmValuesRemovedKey {
  path: string[];
  chartDefault: unknown;
  /** The 1-based line the removed key is shown beside, and on which side. */
  line: number;
  side: 'before' | 'after';
}

export interface HelmValuesOverrideMarks {
  /** Override marks by 1-based line number. */
  lines: ReadonlyMap<number, HelmValuesOverride>;
  /** Keys removed from Merged, shown as rows since they have no line there. */
  removed: HelmValuesRemovedKey[];
  /** User-set values marked in the view; subchart copies excluded. */
  overriddenCount: number;
  /** Chart keys the user's `null` overrides removed. */
  removedCount: number;
}

type ValuesObject = Record<string, unknown>;
type ValuesPair = YAML.Pair<unknown, unknown>;

interface OverrideOrigin {
  source: string[];
  value: unknown;
  inherited: boolean;
}

interface MarkContext {
  values: HelmValuesOverrideSource;
  subcharts: Set<string>;
  lineOf: (offset: number) => number;
  lines: Map<number, HelmValuesOverride>;
}

const PATH_SEPARATOR = '\u0000';

const isValuesObject = (value: unknown): value is ValuesObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const ownsKey = (value: ValuesObject, key: string) =>
  Object.getOwnPropertyDescriptor(value, key) !== undefined;

const lookup = (root: unknown, path: readonly string[]): { value: unknown } | null => {
  let current = root;
  for (const key of path) {
    if (!isValuesObject(current) || !ownsKey(current, key)) {
      return null;
    }
    current = current[key];
  }
  return { value: current };
};

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameValue(item, b[index]));
  }
  if (isValuesObject(a) && isValuesObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => ownsKey(b, key) && sameValue(a[key], b[key]))
    );
  }
  return a === b;
};

const keyOf = (pair: ValuesPair) => String(YAML.isScalar(pair.key) ? pair.key.value : pair.key);

const rangeOf = (node: unknown) => (YAML.isNode(node) ? node.range : undefined);

const startOf = (pair: ValuesPair) => rangeOf(pair.key)?.[0] ?? 0;

// The last character of the pair's value, or of its key when it has no value.
const endOf = (pair: ValuesPair) => {
  const end = rangeOf(pair.value)?.[1] ?? rangeOf(pair.key)?.[1] ?? 1;
  return Math.max(startOf(pair), end - 1);
};

const keyLabel = (pair: ValuesPair): HelmValuesLabel => {
  const from = startOf(pair);
  return { from, to: rangeOf(pair.key)?.[1] ?? from };
};

// Every map key inside a value, through nested lists and maps.
const nestedKeyLabels = (node: unknown): HelmValuesLabel[] => {
  if (YAML.isMap(node)) {
    return node.items.flatMap((pair) => [keyLabel(pair), ...nestedKeyLabels(pair.value)]);
  }
  if (YAML.isSeq(node)) {
    return node.items.flatMap((item) => nestedKeyLabels(item));
  }
  return [];
};

// Candidate overrides for a value inside a subchart's `global` map, outermost
// parent first; otherwise the value's own path.
const overrideCandidates = (path: string[], subcharts: Set<string>): string[][] => {
  for (let index = 1; index < path.length - 1; index += 1) {
    if (path[index] === 'global' && subcharts.has(path.slice(0, index).join(PATH_SEPARATOR))) {
      const rest = path.slice(index + 1);
      const owners = [0];
      for (let depth = 1; depth <= index; depth += 1) {
        if (subcharts.has(path.slice(0, depth).join(PATH_SEPARATOR))) {
          owners.push(depth);
        }
      }
      return owners.map((depth) => [...path.slice(0, depth), 'global', ...rest]);
    }
  }
  return [path];
};

const overrideOrigin = (path: string[], context: MarkContext): OverrideOrigin | null => {
  const candidates = overrideCandidates(path, context.subcharts);
  for (const [index, source] of candidates.entries()) {
    const found = lookup(context.values.overrides, source);
    if (found) {
      return { source, value: found.value, inherited: index < candidates.length - 1 };
    }
  }
  return null;
};

// Only a non-empty map override merges into the chart's map; anything else
// replaces the chart value and is marked as a whole.
const isLeafOverride = (value: unknown) =>
  !isValuesObject(value) || Object.keys(value).length === 0;

const overrideKind = (
  path: string[],
  origin: OverrideOrigin,
  chartDefault: { value: unknown } | null,
  context: MarkContext
): HelmValuesOverrideKind => {
  if (origin.inherited) {
    return 'global';
  }
  const merged = lookup(context.values.merged, path);
  // A null removes the chart's key; Helm keeps a null for a key the chart lacks.
  if (origin.value === null && chartDefault && !merged) {
    return 'removed';
  }
  if (!chartDefault) {
    return 'added';
  }
  return sameValue(chartDefault.value, merged?.value) ? 'same' : 'changed';
};

const markPair = (
  pair: ValuesPair,
  path: string[],
  origin: OverrideOrigin,
  context: MarkContext
) => {
  const chartDefault = lookup(context.values.defaults, path);
  // An empty-map override leaves the chart's children in place; mark the key only.
  const keyOnly =
    isValuesObject(origin.value) && YAML.isMap(pair.value) && pair.value.items.length > 0;
  const override: HelmValuesOverride = {
    kind: overrideKind(path, origin, chartDefault, context),
    path,
    source: origin.source,
    chartDefault,
    labels: keyOnly ? [keyLabel(pair)] : [keyLabel(pair), ...nestedKeyLabels(pair.value)],
  };
  const first = context.lineOf(startOf(pair));
  const last = keyOnly ? first : context.lineOf(endOf(pair));
  for (let line = first; line <= last; line += 1) {
    context.lines.set(line, override);
  }
};

const markMap = (map: YAML.YAMLMap<unknown, unknown>, path: string[], context: MarkContext) => {
  for (const pair of map.items) {
    const childPath = [...path, keyOf(pair)];
    const origin = overrideOrigin(childPath, context);
    if (origin && isLeafOverride(origin.value)) {
      markPair(pair, childPath, origin, context);
    } else if (YAML.isMap(pair.value)) {
      markMap(pair.value, childPath, context);
    }
  }
};

const mapAt = (doc: YAML.Document, path: string[]): YAML.YAMLMap<unknown, unknown> | null => {
  let node: unknown = doc.contents;
  for (const key of path) {
    if (!YAML.isMap(node)) {
      return null;
    }
    node = node.items.find((pair) => keyOf(pair) === key)?.value;
  }
  return YAML.isMap(node) ? node : null;
};

// Merged keeps Go's sorted key order, so a removed key belongs before the
// first remaining sibling that sorts after it.
const removedKeyAnchor = (
  doc: YAML.Document,
  parentPath: string[],
  key: string,
  lineOf: (offset: number) => number
): Pick<HelmValuesRemovedKey, 'line' | 'side'> | null => {
  const parent = mapAt(doc, parentPath);
  if (!parent) {
    return null;
  }
  if (parent.items.length === 0) {
    // An emptied `parent: {}`, or an empty root `{}`, sits on one line; show
    // the key after it.
    const start = rangeOf(parent)?.[0];
    return start === undefined ? null : { line: lineOf(start), side: 'after' };
  }
  const next = parent.items.find((pair) => keyOf(pair) > key);
  if (next) {
    return { line: lineOf(startOf(next)), side: 'before' };
  }
  return { line: lineOf(endOf(parent.items[parent.items.length - 1])), side: 'after' };
};

const collectRemoved = (
  doc: YAML.Document,
  values: HelmValuesOverrideSource,
  lineOf: (offset: number) => number
): HelmValuesRemovedKey[] => {
  const removed: HelmValuesRemovedKey[] = [];
  const visit = (overrides: ValuesObject, parentPath: string[]) => {
    for (const [key, value] of Object.entries(overrides)) {
      const path = [...parentPath, key];
      if (isValuesObject(value)) {
        visit(value, path);
        continue;
      }
      const chartDefault = lookup(values.defaults, path);
      if (value !== null || !chartDefault || lookup(values.merged, path)) {
        continue;
      }
      const anchor = removedKeyAnchor(doc, parentPath, key, lineOf);
      if (anchor) {
        removed.push({ path, chartDefault: chartDefault.value, ...anchor });
      }
    }
  };
  if (isValuesObject(values.overrides)) {
    visit(values.overrides, []);
  }
  return removed;
};

const countKinds = (lines: Map<number, HelmValuesOverride>, kinds: HelmValuesOverrideKind[]) =>
  new Set([...lines.values()].filter((mark) => kinds.includes(mark.kind))).size;

/**
 * Maps overrides onto `text`, the `view` values rendered by stringifyHelmValues.
 * Every key in the Overrides view is user-set, so subchart copies of globals
 * only arise in Merged.
 */
export function computeHelmValuesOverrideMarks(
  text: string,
  values: HelmValuesOverrideSource,
  view: HelmValuesMarkedView
): HelmValuesOverrideMarks {
  const lineCounter = new YAML.LineCounter();
  const doc = YAML.parseDocument(text, { lineCounter, version: '1.1' });
  const subchartPaths = view === 'merged' ? (values.subchartPaths ?? []) : [];
  const context: MarkContext = {
    values,
    subcharts: new Set(subchartPaths.flatMap((path) => (path ? [path.join(PATH_SEPARATOR)] : []))),
    lineOf: (offset) => lineCounter.linePos(offset).line,
    lines: new Map(),
  };
  if (YAML.isMap(doc.contents)) {
    markMap(doc.contents, [], context);
  }
  const removed = view === 'merged' ? collectRemoved(doc, values, context.lineOf) : [];
  return {
    lines: context.lines,
    removed,
    overriddenCount: countKinds(context.lines, ['changed', 'added', 'same']),
    removedCount: view === 'merged' ? removed.length : countKinds(context.lines, ['removed']),
  };
}
