import type { ProtectedYamlRange } from '@shared/components/yaml';
import fieldPolicyContract from '@yaml-field-policy-contract';
import * as YAML from 'yaml';
import { YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';

export type YAMLFieldBackendBehavior = 'reject' | 'strip' | 'preserve' | 'allow';
export type YAMLFieldWorkflow = 'edit' | 'create';
export type YAMLFieldPath = string[];

export interface YAMLFieldPolicyEntry {
  path: YAMLFieldPath;
  visibleInReadOnly: boolean;
  visibleInEdit: boolean;
  editable: boolean;
  ignoreInSemanticCompare: boolean;
  backendBehavior: YAMLFieldBackendBehavior;
  appliesTo: YAMLFieldWorkflow[];
  reason: string;
}

interface YAMLFieldPolicyContract {
  version: number;
  fields: YAMLFieldPolicyEntry[];
}

const contract = fieldPolicyContract as YAMLFieldPolicyContract;

export const yamlFieldPolicyEntries: YAMLFieldPolicyEntry[] = contract.fields;

const pathKey = (path: YAMLFieldPath): string => path.join('\u0000');

const formatYAMLFieldPath = (path: YAMLFieldPath): string => {
  return path
    .map((part) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part) ? part : `["${part}"]`))
    .join('.');
};

const getYAMLFieldPolicyEntries = (workflow: YAMLFieldWorkflow): YAMLFieldPolicyEntry[] => {
  return yamlFieldPolicyEntries.filter((entry) => entry.appliesTo.includes(workflow));
};

const getProtectedYAMLFieldPolicyEntries = (
  workflow: YAMLFieldWorkflow
): YAMLFieldPolicyEntry[] => {
  return getYAMLFieldPolicyEntries(workflow).filter((entry) => !entry.editable);
};

const deleteYamlPath = (doc: YAML.Document, path: YAMLFieldPath) => {
  try {
    doc.deleteIn(path);
  } catch {
    // Ignore invalid paths so comparison stays best-effort.
  }
};

const isEmptyYamlCollection = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (YAML.isMap(value) || YAML.isSeq(value)) {
    return value.items.length === 0;
  }
  return false;
};

const pruneEmptyYamlCollection = (doc: YAML.Document, path: YAMLFieldPath) => {
  try {
    const value = doc.getIn(path);
    if (isEmptyYamlCollection(value)) {
      doc.deleteIn(path);
    }
  } catch {
    // Ignore invalid paths so comparison stays best-effort.
  }
};

export const sanitizeYamlForSemanticCompare = (raw: string): string => {
  try {
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      throw doc.errors[0];
    }

    yamlFieldPolicyEntries.forEach((entry) => {
      if (entry.ignoreInSemanticCompare) {
        deleteYamlPath(doc, entry.path);
      }
    });
    pruneEmptyYamlCollection(doc, ['metadata', 'annotations']);
    pruneEmptyYamlCollection(doc, ['metadata']);

    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};

const keyValue = (node: unknown): string | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (YAML.isScalar(node)) {
    return String(node.value);
  }
  return null;
};

type RangeTuple = [number, number, number];

const nodeRange = (node: unknown): RangeTuple | null => {
  const range = (node as { range?: unknown } | null)?.range;
  if (!Array.isArray(range) || range.length < 2) {
    return null;
  }
  const [start, valueEnd, nodeEnd] = range;
  if (typeof start !== 'number' || typeof valueEnd !== 'number') {
    return null;
  }
  return [start, valueEnd, typeof nodeEnd === 'number' ? nodeEnd : valueEnd];
};

const lineStart = (text: string, index: number): number => {
  const bounded = Math.max(0, Math.min(text.length, index));
  const previousNewline = text.lastIndexOf('\n', bounded - 1);
  return previousNewline === -1 ? 0 : previousNewline + 1;
};

const includeLeadingAdjacentComments = (text: string, start: number): number => {
  let currentStart = start;
  while (currentStart > 0) {
    const previousLineEnd = currentStart - 1;
    const previousLineStart = lineStart(text, previousLineEnd);
    const previousLine = text.slice(previousLineStart, previousLineEnd).trim();
    if (!previousLine.startsWith('#')) {
      break;
    }
    currentStart = previousLineStart;
  }
  return currentStart;
};

const lineEnd = (text: string, index: number): number => {
  const bounded = Math.max(0, Math.min(text.length, index));
  const nextNewline = text.indexOf('\n', bounded);
  return nextNewline === -1 ? text.length : nextNewline;
};

const rangeForPair = (
  text: string,
  pair: YAML.Pair<YAML.ParsedNode, YAML.ParsedNode | null>
): { from: number; to: number } | null => {
  const keyRange = nodeRange(pair.key);
  if (!keyRange) {
    return null;
  }
  const valueRange = nodeRange(pair.value);
  const from = includeLeadingAdjacentComments(text, lineStart(text, keyRange[0]));
  const to = lineEnd(text, valueRange?.[1] ?? keyRange[1]);
  if (to <= from) {
    return null;
  }
  return { from, to };
};

const findPairForPath = (
  node: YAML.ParsedNode | null,
  path: YAMLFieldPath
): YAML.Pair<YAML.ParsedNode, YAML.ParsedNode | null> | null => {
  let current = node;
  let currentPair: YAML.Pair<YAML.ParsedNode, YAML.ParsedNode | null> | null = null;

  for (const part of path) {
    if (!current || !YAML.isMap(current)) {
      return null;
    }
    const pair = current.items.find((item) => keyValue(item.key) === part) ?? null;
    if (!pair) {
      return null;
    }
    currentPair = pair;
    current = pair.value;
  }

  return currentPair;
};

export const resolveProtectedYamlRanges = (
  value: string,
  workflow: YAMLFieldWorkflow = 'edit'
): ProtectedYamlRange[] => {
  try {
    const doc = YAML.parseDocument(value, { keepSourceTokens: true });
    if (doc.errors.length > 0) {
      return [];
    }

    const seen = new Set<string>();
    return getProtectedYAMLFieldPolicyEntries(workflow)
      .filter((entry) => (workflow === 'edit' ? entry.visibleInEdit : true))
      .flatMap((entry) => {
        const key = pathKey(entry.path);
        if (seen.has(key)) {
          return [];
        }
        seen.add(key);
        const pair = findPairForPath(doc.contents, entry.path);
        if (!pair) {
          return [];
        }
        const range = rangeForPair(value, pair);
        if (!range) {
          return [];
        }
        const fieldName = formatYAMLFieldPath(entry.path);
        return [
          {
            from: range.from,
            to: range.to,
            tooltip: entry.reason,
            blockedMessage: `${fieldName} is managed by Kubernetes and cannot be edited.`,
          },
        ];
      });
  } catch {
    return [];
  }
};
