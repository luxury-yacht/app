/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlDriftFields.ts
 *
 * Field-by-field drift for a YAML edit session: the fields someone else changed
 * since the edit began (live against the edit baseline), the draft's value for
 * each, and whether the draft changed it too, to another value (a conflict).
 * Server-owned fields are dropped first by the field policy's semantic compare,
 * so status and metadata churn never count. Named list items (containers,
 * ports) are keyed by their name, so a field keeps its key when items move.
 */

import * as YAML from 'yaml';
import { sanitizeYamlForSemanticCompare } from './yamlFieldPolicy';
import { YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';

/** A path step: an object key, or the list item with this name. */
export type DriftPathStep = string | { name: string };
export type DriftFieldPath = readonly DriftPathStep[];

export interface DriftField {
  /** Readable path, such as spec.template.spec.containers[api].image. */
  key: string;
  /** The path's last two parts, such as containers[api].image, for narrow panels. */
  label: string;
  path: DriftFieldPath;
  /** Display values; undefined where the field is absent. */
  started?: string;
  now?: string;
  draft?: string;
  /** The draft changed the field from its value when editing began. */
  edited: boolean;
  /** The draft changed the field too, to a value other than the live one. */
  conflict: boolean;
}

type Leaf = { path: DriftFieldPath; value: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const itemName = (item: unknown): string | null =>
  isRecord(item) && typeof item.name === 'string' ? item.name : null;

// A list whose items all carry distinct names is keyed by name.
const isNamedList = (value: unknown[]): boolean => {
  const names = value.map(itemName);
  return (
    names.length > 0 && names.every((name) => name !== null) && new Set(names).size === names.length
  );
};

const keyOf = (path: DriftFieldPath): string =>
  path
    .map((step, index) => {
      if (typeof step !== 'string') {
        return `[${step.name}]`;
      }
      return index === 0 ? step : `.${step}`;
    })
    .join('');

// Each part is a key plus any name step that follows it: containers[api].
const labelOf = (path: DriftFieldPath): string => {
  const parts: string[] = [];
  for (const step of path) {
    if (typeof step === 'string') {
      parts.push(step);
    } else {
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''}[${step.name}]`;
    }
  }
  return parts.slice(-2).join('.');
};

const flatten = (value: unknown, path: DriftPathStep[], leaves: Map<string, Leaf>): void => {
  if (isRecord(value) && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, [...path, key], leaves);
    }
    return;
  }
  if (Array.isArray(value) && isNamedList(value)) {
    for (const item of value) {
      flatten(item, [...path, { name: itemName(item) ?? '' }], leaves);
    }
    return;
  }
  leaves.set(keyOf(path), { path, value });
};

const leavesOf = (yaml: string): Map<string, Leaf> | null => {
  const doc = YAML.parseDocument(sanitizeYamlForSemanticCompare(yaml));
  if (doc.errors.length > 0) {
    return null;
  }
  const leaves = new Map<string, Leaf>();
  flatten(doc.toJS(), [], leaves);
  return leaves;
};

const sameValue = (left?: Leaf, right?: Leaf): boolean =>
  JSON.stringify(left?.value) === JSON.stringify(right?.value);

const display = (leaf?: Leaf): string | undefined => {
  if (!leaf) {
    return undefined;
  }
  const { value } = leaf;
  if (typeof value === 'string') {
    return value;
  }
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
};

/** The fields someone else changed since the edit began, in the live document's order. */
export const compareDriftFields = ({
  baselineYaml,
  liveYaml,
  draftYaml,
}: {
  baselineYaml: string;
  liveYaml: string;
  draftYaml: string;
}): DriftField[] => {
  const started = leavesOf(baselineYaml);
  const now = leavesOf(liveYaml);
  if (!started || !now) {
    return [];
  }
  // A draft that does not parse yet has no field values to compare.
  const draft = leavesOf(draftYaml);
  const keys = new Set([...now.keys(), ...started.keys()]);
  return [...keys].flatMap((key) => {
    const before = started.get(key);
    const after = now.get(key);
    if (sameValue(before, after)) {
      return [];
    }
    const mine = draft?.get(key);
    const edited = Boolean(draft) && !sameValue(mine, before);
    const path = (after ?? before)?.path ?? [];
    return [
      {
        key,
        label: labelOf(path),
        path,
        started: display(before),
        now: display(after),
        draft: draft ? display(mine) : undefined,
        edited,
        conflict: edited && !sameValue(mine, after),
      },
    ];
  });
};

type ResolvedStep = { key: string | number; node: unknown } | null;

// One step of a path in `root`. An object key may be missing only when
// `allowMissingKeys` (setIn creates it); a missing named item cannot be placed.
const resolveStep = (
  node: unknown,
  step: DriftPathStep,
  allowMissingKeys: boolean
): ResolvedStep => {
  if (typeof step === 'string') {
    const child = isRecord(node) ? node[step] : undefined;
    return child === undefined && !allowMissingKeys ? null : { key: step, node: child };
  }
  const index = Array.isArray(node) ? node.findIndex((item) => itemName(item) === step.name) : -1;
  return index < 0 ? null : { key: index, node: (node as unknown[])[index] };
};

// Resolves name steps to list indexes in `root`, or null where it cannot.
const concretePath = (
  root: unknown,
  path: DriftFieldPath,
  allowMissingKeys: boolean
): Array<string | number> | null => {
  const concrete: Array<string | number> = [];
  let node: unknown = root;
  for (const step of path) {
    const resolved = resolveStep(node, step, allowMissingKeys);
    if (!resolved) {
      return null;
    }
    concrete.push(resolved.key);
    node = resolved.node;
  }
  return concrete;
};

// The value at a concrete path, or undefined where the path runs out.
const valueAt = (root: unknown, path: ReadonlyArray<string | number>): unknown =>
  path.reduce<unknown>(
    (node, step) =>
      node !== null && typeof node === 'object'
        ? (node as Record<string | number, unknown>)[step]
        : undefined,
    root
  );

// The first named list item on `path` that only one document has.
const firstOneSidedItem = (
  targetRoot: unknown,
  sourceRoot: unknown,
  path: DriftFieldPath
): { prefix: DriftFieldPath; inSource: boolean } | null => {
  for (let end = 1; end <= path.length; end += 1) {
    if (typeof path[end - 1] === 'string') {
      continue;
    }
    const prefix = path.slice(0, end);
    const inTarget = concretePath(targetRoot, prefix, false) !== null;
    const inSource = concretePath(sourceRoot, prefix, false) !== null;
    if (inTarget !== inSource) {
      return { prefix, inSource };
    }
    if (!inTarget) {
      return null;
    }
  }
  return null;
};

// Where the source list's item at `index` goes in the target list: after the
// nearest earlier source item the target still has, else before the nearest
// later one, else at the end. Order can carry meaning: an environment variable
// can refer only to earlier ones, and init containers run in order.
const insertionIndex = (sourceList: unknown[], index: number, targetList: unknown[]): number => {
  const targetIndexOf = (item: unknown) => {
    const name = itemName(item);
    return targetList.findIndex((candidate) => name !== null && itemName(candidate) === name);
  };
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const at = targetIndexOf(sourceList[earlier]);
    if (at >= 0) {
      return at + 1;
    }
  }
  for (let later = index + 1; later < sourceList.length; later += 1) {
    const at = targetIndexOf(sourceList[later]);
    if (at >= 0) {
      return at;
    }
  }
  return targetList.length;
};

// Adds the source's whole item to the target's list at its source position,
// creating the list where the target has none, or removes the target's whole
// item.
const copyWholeItem = (
  target: YAML.Document,
  roots: { target: unknown; source: unknown },
  prefix: DriftFieldPath,
  inSource: boolean
): void => {
  if (!inSource) {
    const itemPath = concretePath(roots.target, prefix, false);
    if (itemPath) {
      target.deleteIn(itemPath);
    }
    return;
  }
  const listPath = concretePath(roots.target, prefix.slice(0, -1), true);
  const sourcePath = concretePath(roots.source, prefix, false);
  if (!listPath || !sourcePath) {
    return;
  }
  const item = valueAt(roots.source, sourcePath);
  const targetList = valueAt(roots.target, listPath);
  if (!Array.isArray(targetList)) {
    target.setIn(listPath, target.createNode([item]));
    return;
  }
  // Splicing the list node keeps the comments on its other items.
  const list = target.getIn(listPath);
  if (YAML.isSeq(list)) {
    const sourceIndex = Number(sourcePath[sourcePath.length - 1]);
    const sourceList = valueAt(roots.source, sourcePath.slice(0, -1)) as unknown[];
    list.items.splice(
      insertionIndex(sourceList, sourceIndex, targetList),
      0,
      target.createNode(item)
    );
  }
};

/**
 * Sets `targetYaml`'s field at `path` to `sourceYaml`'s value, or removes it
 * where the source has none: their value into the draft, your earlier value
 * back into it, or their value into a merge baseline. A named list item only
 * one side has is copied or removed whole, so keeping a value restores the
 * item that holds it. The target's other content is kept; an unparseable
 * document leaves the target unchanged.
 */
export const copyDriftField = (
  targetYaml: string,
  sourceYaml: string,
  path: DriftFieldPath
): string => {
  const target = YAML.parseDocument(targetYaml);
  const source = YAML.parseDocument(sourceYaml);
  if (target.errors.length > 0 || source.errors.length > 0) {
    return targetYaml;
  }
  const roots = { target: target.toJS() as unknown, source: source.toJS() as unknown };
  const oneSided = firstOneSidedItem(roots.target, roots.source, path);
  if (oneSided) {
    copyWholeItem(target, roots, oneSided.prefix, oneSided.inSource);
    return target.toString(YAML_STRINGIFY_OPTIONS);
  }
  const targetPath = concretePath(roots.target, path, true);
  if (!targetPath) {
    return targetYaml;
  }
  const sourcePath = concretePath(roots.source, path, false);
  if (sourcePath) {
    target.setIn(targetPath, target.createNode(valueAt(roots.source, sourcePath)));
  } else {
    target.deleteIn(targetPath);
  }
  return target.toString(YAML_STRINGIFY_OPTIONS);
};
