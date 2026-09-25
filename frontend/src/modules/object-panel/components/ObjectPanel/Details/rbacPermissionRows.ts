/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/rbacPermissionRows.ts
 *
 * Flattens Role/ClusterRole policy rules into one permission row per (API group, resource,
 * resource-name restriction) and per non-resource URL, merging the verbs every rule grants to
 * that target — the same shape `kubectl describe` prints.
 */

export interface PolicyRuleInput {
  apiGroups?: string[] | null;
  resources?: string[] | null;
  resourceNames?: string[] | null;
  verbs?: string[] | null;
  nonResourceURLs?: string[] | null;
}

export interface PermissionRow {
  key: string;
  /** Resource name, or the URL path for non-resource rows. */
  resource: string;
  /** API group ('' is the core group); null for non-resource URL rows. */
  apiGroup: string | null;
  /** Empty when the grant covers every object of the resource. */
  resourceNames: string[];
  verbs: string[];
}

// Read verbs first, then writes, then everything else alphabetically, so rows line up.
const VERB_ORDER = [
  '*',
  'get',
  'list',
  'watch',
  'create',
  'update',
  'patch',
  'delete',
  'deletecollection',
];

const verbRank = (verb: string): number => {
  const index = VERB_ORDER.indexOf(verb);
  return index === -1 ? VERB_ORDER.length : index;
};

const compareVerbs = (a: string, b: string): number =>
  verbRank(a) - verbRank(b) || a.localeCompare(b);

const compareRows = (a: PermissionRow, b: PermissionRow): number => {
  if ((a.apiGroup === null) !== (b.apiGroup === null)) {
    return a.apiGroup === null ? 1 : -1;
  }
  return (
    (a.apiGroup ?? '').localeCompare(b.apiGroup ?? '') ||
    a.resource.localeCompare(b.resource) ||
    a.resourceNames.join(',').localeCompare(b.resourceNames.join(','))
  );
};

type RowTarget = Pick<PermissionRow, 'resource' | 'apiGroup' | 'resourceNames'>;

const ruleTargets = (rule: PolicyRuleInput): RowTarget[] => {
  const resourceNames = [...new Set(rule.resourceNames ?? [])].sort((a, b) => a.localeCompare(b));
  const apiGroups = rule.apiGroups?.length ? rule.apiGroups : [''];
  const targets: RowTarget[] = apiGroups.flatMap((apiGroup) =>
    (rule.resources ?? []).map((resource) => ({ resource, apiGroup, resourceNames }))
  );
  for (const url of rule.nonResourceURLs ?? []) {
    targets.push({ resource: url, apiGroup: null, resourceNames: [] });
  }
  return targets;
};

export function buildPermissionRows(rules: PolicyRuleInput[] | null | undefined): PermissionRow[] {
  const rows = new Map<string, PermissionRow>();
  for (const rule of rules ?? []) {
    for (const target of ruleTargets(rule)) {
      const key = JSON.stringify([target.apiGroup, target.resource, target.resourceNames]);
      const row = rows.get(key) ?? { key, ...target, verbs: [] };
      row.verbs = [...new Set([...row.verbs, ...(rule.verbs ?? [])])].sort(compareVerbs);
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(compareRows);
}
