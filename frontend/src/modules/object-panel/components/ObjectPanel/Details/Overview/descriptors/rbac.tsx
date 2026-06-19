/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/rbac.tsx
 *
 * Overview descriptors for the five RBAC kinds (X1), one descriptor per kind: ServiceAccount, Role,
 * RoleBinding, ClusterRole, and ClusterRoleBinding. Presentation ported from RBACOverview.tsx.
 *
 * Role/ClusterRole `rules` are rendered by the separate RBACRules section (DetailsTab reads
 * model.roleRules), so `rules` is listed in `coveredElsewhere` here rather than placed in the schema.
 * Cluster identity for links comes from the threaded OverviewContext (not useObjectPanel), so render
 * functions read `context.clusterId`/`context.clusterName`.
 */

import React from 'react';
import {
  clusterrole,
  clusterrolebinding,
  resourcemodel,
  role,
  rolebinding,
  serviceaccount,
  types,
} from '@wailsjs/go/models';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import { renderUsedByLinks } from './shared';
import '../shared/OverviewBlocks.css';
import '../RBACOverview.css';

type ServiceAccountDetails = serviceaccount.ServiceAccountDetails;
type RoleDetails = role.RoleDetails;
type RoleBindingDetails = rolebinding.RoleBindingDetails;
type ClusterRoleDetails = clusterrole.ClusterRoleDetails;
type ClusterRoleBindingDetails = clusterrolebinding.ClusterRoleBindingDetails;

// Kubernetes-managed namespaces. ServiceAccounts living in these are
// disproportionately privileged (the default service accounts run with
// cluster-internal credentials), so binding additional permissions to them
// is a recurring security risk worth flagging visually.
const SYSTEM_NAMESPACES = new Set(['kube-system', 'kube-public', 'kube-node-lease']);

const isSystemSA = (subject: types.Subject): boolean =>
  subject.kind === 'ServiceAccount' &&
  Boolean(subject.namespace) &&
  SYSTEM_NAMESPACES.has(subject.namespace as string);

// Bucket subjects by kind so we can render one block per kind instead of
// repeating the kind label on every row. Kept in a fixed display order
// (ServiceAccount → User → Group → other) so similar bindings line up
// visually across panels.
const KIND_ORDER: ReadonlyArray<{ kind: string; heading: string }> = [
  { kind: 'ServiceAccount', heading: 'ServiceAccounts' },
  { kind: 'User', heading: 'Users' },
  { kind: 'Group', heading: 'Groups' },
];

const groupSubjects = (
  subjects: types.Subject[]
): Array<{ heading: string; items: types.Subject[] }> => {
  const buckets = new Map<string, types.Subject[]>();
  for (const s of subjects) {
    const arr = buckets.get(s.kind) ?? [];
    arr.push(s);
    buckets.set(s.kind, arr);
  }
  const groups: Array<{ heading: string; items: types.Subject[] }> = [];
  for (const { kind, heading } of KIND_ORDER) {
    const items = buckets.get(kind);
    if (items && items.length > 0) {
      groups.push({ heading, items });
      buckets.delete(kind);
    }
  }
  // Anything else (custom subject kinds) — surface under its own kind name.
  for (const [kind, items] of buckets) {
    groups.push({ heading: kind, items });
  }
  return groups;
};

const clusterMetaFromContext = (
  context: OverviewContext
): { clusterId?: string; clusterName?: string } => ({
  clusterId: context.clusterId,
  clusterName: context.clusterName,
});

const SubjectGroups: React.FC<{
  subjects: types.Subject[];
  clusterMeta: { clusterId?: string; clusterName?: string };
}> = ({ subjects, clusterMeta }) => {
  const groups = groupSubjects(subjects);

  return (
    <div className="rbac-subjects-list">
      {groups.map(({ heading, items }) => (
        <div key={heading} className="rbac-subjects-group">
          <div className="rbac-subjects-group-heading">{heading}</div>
          <div className="rbac-subjects-names">
            {items.map((subject, index) => {
              const isSA = subject.kind === 'ServiceAccount';
              const displayName =
                isSA && subject.namespace ? `${subject.namespace}/${subject.name}` : subject.name;
              const nameNode =
                isSA && subject.namespace ? (
                  <ObjectPanelLink
                    objectRef={buildRequiredObjectReference({
                      kind: 'serviceaccount',
                      name: subject.name,
                      namespace: subject.namespace,
                      ...clusterMeta,
                    })}
                  >
                    {displayName}
                  </ObjectPanelLink>
                ) : (
                  displayName
                );
              return (
                <div key={`${subject.name}-${index}`} className="rbac-subjects-name-row">
                  <span className="rbac-subjects-name">{nameNode}</span>
                  {isSystemSA(subject) && (
                    <StatusChip
                      variant="warning"
                      tooltip="ServiceAccount lives in a Kubernetes-managed namespace. Granting permissions here can have cluster-wide impact via the system controllers and pods that run there."
                    >
                      system
                    </StatusChip>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

/**
 * Renders the role reference link for a (Cluster)RoleBinding. RoleBindings can reference either a
 * (namespaced) Role in the same namespace or a (cluster-scoped) ClusterRole; ClusterRoleBindings
 * always reference a ClusterRole, so `bindingNamespace` is undefined for those.
 */
const renderRoleRef = (
  roleRef: types.RoleRef,
  bindingNamespace: string | undefined,
  context: OverviewContext
): React.ReactNode => (
  <ObjectPanelLink
    objectRef={buildRequiredObjectReference({
      kind: roleRef.kind.toLowerCase(),
      name: roleRef.name,
      namespace: roleRef.kind === 'Role' ? bindingNamespace : undefined,
      ...clusterMetaFromContext(context),
    })}
  >
    {roleRef.kind}/{roleRef.name}
  </ObjectPanelLink>
);

/**
 * Renders the backlink list to the bindings that grant a Role/ClusterRole. For Roles the bindings
 * live in the same namespace; for ClusterRoles they're cluster-scoped ClusterRoleBindings.
 */
const renderUsedByBindings = (bindings: resourcemodel.ResourceRef[]): React.ReactNode => (
  <div className="overview-stacked">
    {bindings.map((bindingRef, index) => (
      <ObjectPanelLink
        key={`${bindingRef.clusterId}-${bindingRef.group}-${bindingRef.version}-${bindingRef.kind}-${bindingRef.namespace ?? ''}-${bindingRef.name ?? index}`}
        objectRef={{
          ...bindingRef,
          group: bindingRef.group,
          version: bindingRef.version,
        }}
      >
        {bindingRef.name ?? bindingRef.kind}
      </ObjectPanelLink>
    ))}
  </div>
);

/**
 * Renders the Aggregation row for a ClusterRole. Selectors arrive as an array of label maps; each
 * map is an AND-set and the array is OR'd by the controller when picking which ClusterRoles to fold
 * in. Common for the built-in view/edit/admin roles.
 */
const renderAggregation = (aggregationRule: clusterrole.AggregationRule): React.ReactNode => {
  const selectors =
    (aggregationRule.clusterRoleSelectors as Array<Record<string, string>> | undefined) ?? [];
  if (selectors.length === 0) {
    return 'Enabled (no selectors set)';
  }
  return (
    <div className="overview-stacked">
      {selectors.map((selector, si) => (
        <div key={si} className="overview-condition-list">
          {Object.entries(selector).map(([k, v]) => (
            <StatusChip key={`${si}-${k}`} variant="info">
              {k}={v}
            </StatusChip>
          ))}
        </div>
      ))}
    </div>
  );
};

export const serviceAccountDescriptor: OverviewDescriptor<ServiceAccountDetails> = {
  displayKind: 'ServiceAccount',
  dtoClass: serviceaccount.ServiceAccountDetails,
  schema: {
    items: [
      {
        field: 'secrets',
        label: 'Secrets',
        render: (d) => (d.secrets ? `${d.secrets.length} secret(s)` : undefined),
      },
      {
        field: 'imagePullSecrets',
        label: 'Image Pull Secrets',
        render: (d) => (d.imagePullSecrets ? `${d.imagePullSecrets.length} secret(s)` : undefined),
      },
      {
        field: 'automountServiceAccountToken',
        label: 'Automount Token',
        render: (d) => (d.automountServiceAccountToken ? 'Yes' : 'No'),
      },
      {
        field: 'usedByPods',
        label: 'Used by pods',
        fullWidth: true,
        hidden: (d) => (d.usedByPods?.length ?? 0) === 0,
        render: (d) => renderUsedByLinks(d.usedByPods),
      },
      {
        field: 'roleBindings',
        label: 'Role Bindings',
        fullWidth: true,
        hidden: (d) => (d.roleBindings?.length ?? 0) === 0,
        render: (d) => renderUsedByBindings(d.roleBindings ?? []),
      },
      {
        field: 'clusterRoleBindings',
        label: 'Cluster Role Bindings',
        fullWidth: true,
        hidden: (d) => (d.clusterRoleBindings?.length ?? 0) === 0,
        render: (d) => renderUsedByBindings(d.clusterRoleBindings ?? []),
      },
    ],
  },
  // details (table-summary string) is not surfaced here.
  coveredElsewhere: ['details'],
};

export const roleDescriptor: OverviewDescriptor<RoleDetails> = {
  displayKind: 'Role',
  dtoClass: role.RoleDetails,
  schema: {
    items: [
      {
        field: 'usedByRoleBindings',
        label: 'Used by',
        fullWidth: true,
        hidden: (d) => (d.usedByRoleBindings?.length ?? 0) === 0,
        render: (d) => renderUsedByBindings(d.usedByRoleBindings ?? []),
      },
    ],
  },
  // details (table-summary string); rules render in the separate RBACRules section.
  coveredElsewhere: ['details', 'rules'],
};

export const roleBindingDescriptor: OverviewDescriptor<RoleBindingDetails> = {
  displayKind: 'RoleBinding',
  dtoClass: rolebinding.RoleBindingDetails,
  schema: {
    items: [
      {
        field: 'roleRef',
        label: 'Role Reference',
        hidden: (d) => !d.roleRef,
        render: (d, context) => renderRoleRef(d.roleRef, d.namespace, context),
      },
      {
        field: 'subjects',
        label: 'Subjects',
        fullWidth: true,
        hidden: (d) => !(d.subjects && d.subjects.length > 0),
        render: (d, context) => (
          <SubjectGroups subjects={d.subjects} clusterMeta={clusterMetaFromContext(context)} />
        ),
      },
    ],
  },
  // details (table-summary string) is not surfaced here.
  coveredElsewhere: ['details'],
};

export const clusterRoleDescriptor: OverviewDescriptor<ClusterRoleDetails> = {
  displayKind: 'ClusterRole',
  dtoClass: clusterrole.ClusterRoleDetails,
  schema: {
    items: [
      {
        field: 'aggregationRule',
        label: 'Aggregates',
        fullWidth: true,
        hidden: (d) => !d.aggregationRule,
        render: (d) => (d.aggregationRule ? renderAggregation(d.aggregationRule) : undefined),
      },
      {
        field: 'clusterRoleBindings',
        label: 'Used by',
        fullWidth: true,
        hidden: (d) => (d.clusterRoleBindings?.length ?? 0) === 0,
        render: (d) => renderUsedByBindings(d.clusterRoleBindings ?? []),
      },
      {
        field: 'roleBindings',
        label: 'Used by role bindings',
        fullWidth: true,
        hidden: (d) => (d.roleBindings?.length ?? 0) === 0,
        render: (d) => renderUsedByBindings(d.roleBindings ?? []),
      },
    ],
  },
  // details (table-summary string); rules render in the separate RBACRules section.
  coveredElsewhere: ['details', 'rules'],
};

export const clusterRoleBindingDescriptor: OverviewDescriptor<ClusterRoleBindingDetails> = {
  displayKind: 'ClusterRoleBinding',
  dtoClass: clusterrolebinding.ClusterRoleBindingDetails,
  schema: {
    items: [
      {
        field: 'roleRef',
        label: 'Role Reference',
        hidden: (d) => !d.roleRef,
        // ClusterRoleBindings are cluster-scoped and always reference a ClusterRole, so there is no
        // binding namespace to scope the link to.
        render: (d, context) => renderRoleRef(d.roleRef, undefined, context),
      },
      {
        field: 'subjects',
        label: 'Subjects',
        fullWidth: true,
        hidden: (d) => !(d.subjects && d.subjects.length > 0),
        render: (d, context) => (
          <SubjectGroups subjects={d.subjects} clusterMeta={clusterMetaFromContext(context)} />
        ),
      },
    ],
  },
  // details (table-summary string) is not surfaced here.
  coveredElsewhere: ['details'],
};
