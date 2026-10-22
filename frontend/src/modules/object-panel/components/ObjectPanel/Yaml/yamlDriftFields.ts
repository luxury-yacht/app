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
    const path = (after ?? before)?.path ?? [];
    return [
      {
        key,
        label: labelOf(path),
        path,
        started: display(before),
        now: display(after),
        draft: draft ? display(mine) : undefined,
        conflict: Boolean(draft) && !sameValue(mine, before) && !sameValue(mine, after),
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

/**
 * Sets the draft's field at `path` to the live object's value, or removes it
 * where the live object has none ("Use theirs"). The draft's other content is
 * kept; an unparseable draft or a list item the draft no longer has is left
 * unchanged.
 */
export const copyLiveFieldIntoDraft = (
  draftYaml: string,
  liveYaml: string,
  path: DriftFieldPath
): string => {
  const draft = YAML.parseDocument(draftYaml);
  const live = YAML.parseDocument(liveYaml);
  if (draft.errors.length > 0 || live.errors.length > 0) {
    return draftYaml;
  }
  const draftPath = concretePath(draft.toJS(), path, true);
  if (!draftPath) {
    return draftYaml;
  }
  const liveRoot: unknown = live.toJS();
  const livePath = concretePath(liveRoot, path, false);
  if (livePath) {
    const value = livePath.reduce<unknown>(
      (node, step) => (node as Record<string | number, unknown>)[step],
      liveRoot
    );
    draft.setIn(draftPath, draft.createNode(value));
  } else {
    draft.deleteIn(draftPath);
  }
  return draft.toString(YAML_STRINGIFY_OPTIONS);
};
