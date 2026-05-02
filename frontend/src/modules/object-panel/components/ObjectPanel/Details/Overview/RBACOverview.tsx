/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/RBACOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { StatusChip } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import './shared/LabelsAndAnnotations.css';
import './RBACOverview.css';

// Kubernetes-managed namespaces. ServiceAccounts living in these are
// disproportionately privileged (the default service accounts run with
// cluster-internal credentials), so binding additional permissions to them
// is a recurring security risk worth flagging visually.
const SYSTEM_NAMESPACES = new Set(['kube-system', 'kube-public', 'kube-node-lease']);

const isSystemSA = (subject: { kind: string; namespace?: string }): boolean =>
  subject.kind === 'ServiceAccount' &&
  Boolean(subject.namespace) &&
  SYSTEM_NAMESPACES.has(subject.namespace as string);

interface SubjectLike {
  kind: string;
  apiGroup?: string;
  name: string;
  namespace?: string;
}

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
  subjects: SubjectLike[]
): Array<{ heading: string; items: SubjectLike[] }> => {
  const buckets = new Map<string, SubjectLike[]>();
  for (const s of subjects) {
    const arr = buckets.get(s.kind) ?? [];
    arr.push(s);
    buckets.set(s.kind, arr);
  }
  const groups: Array<{ heading: string; items: SubjectLike[] }> = [];
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

const SubjectGroups: React.FC<{
  subjects: SubjectLike[];
  namespace?: string;
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

interface RBACOverviewProps {
  kind?: string;
  name?: string;
  namespace?: string;
  age?: string;
  // Role/ClusterRole fields
  rules?: any[];
  policyRules?: any[];
  aggregationRule?: any;
  usedByRoleBindings?: string[];
  clusterRoleBindings?: string[];
  // RoleBinding/ClusterRoleBinding fields
  roleRef?: any;
  subjects?: any[];
  // ServiceAccount fields
  secrets?: any[];
  imagePullSecrets?: any[];
  automountServiceAccountToken?: boolean;
  roleBindings?: string[];
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// RBAC resources Overview
export const RBACOverview: React.FC<RBACOverviewProps> = (props) => {
  const { kind, name, namespace, age } = props;
  const normalizedKind = kind?.toLowerCase();
  const { objectData } = useObjectPanel();
  const clusterMeta = {
    clusterId: objectData?.clusterId ?? undefined,
    clusterName: objectData?.clusterName ?? undefined,
  };

  // Aggregation rule selectors arrive as an array of label maps. Each map
  // is an AND-set; the array is OR'd by the controller when picking which
  // ClusterRoles to aggregate.
  const aggregationSelectors: Array<Record<string, string>> =
    (props.aggregationRule?.clusterRoleSelectors as Array<Record<string, string>> | undefined) ??
    [];

  const usedByBindings: string[] =
    normalizedKind === 'clusterrole'
      ? (props.clusterRoleBindings ?? [])
      : (props.usedByRoleBindings ?? []);
  const usedByKind: 'rolebinding' | 'clusterrolebinding' =
    normalizedKind === 'clusterrole' ? 'clusterrolebinding' : 'rolebinding';

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age} />

      {/* Aggregation — shows the label selectors that pick which other
          ClusterRoles get folded into this one. Common for the built-in
          view/edit/admin roles. */}
      {(normalizedKind === 'role' || normalizedKind === 'clusterrole') && props.aggregationRule && (
        <OverviewItem
          label="Aggregates"
          value={
            aggregationSelectors.length > 0 ? (
              <div className="overview-stacked">
                {aggregationSelectors.map((selector, si) => (
                  <div key={si} className="overview-condition-list">
                    {Object.entries(selector).map(([k, v]) => (
                      <StatusChip key={`${si}-${k}`} variant="info">
                        {k}={v}
                      </StatusChip>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              'Enabled (no selectors set)'
            )
          }
          fullWidth
        />
      )}

      {/* Used by — backlink to the bindings that grant this Role/ClusterRole.
          For Roles, bindings live in the same namespace; for ClusterRoles
          they're cluster-scoped ClusterRoleBindings. */}
      {(normalizedKind === 'role' || normalizedKind === 'clusterrole') &&
        usedByBindings.length > 0 && (
          <OverviewItem
            label="Used by"
            fullWidth
            value={
              <div className="overview-stacked">
                {usedByBindings.map((bindingName) => (
                  <ObjectPanelLink
                    key={bindingName}
                    objectRef={buildRequiredObjectReference({
                      kind: usedByKind,
                      name: bindingName,
                      namespace: usedByKind === 'rolebinding' ? namespace : undefined,
                      ...clusterMeta,
                    })}
                  >
                    {bindingName}
                  </ObjectPanelLink>
                ))}
              </div>
            }
          />
        )}

      {/* RoleBinding/ClusterRoleBinding-specific fields */}
      {(normalizedKind === 'rolebinding' || normalizedKind === 'clusterrolebinding') && (
        <>
          {props.roleRef && (
            <OverviewItem
              label="Role Reference"
              value={
                <ObjectPanelLink
                  objectRef={buildRequiredObjectReference({
                    kind: props.roleRef.kind.toLowerCase(),
                    name: props.roleRef.name,
                    // RoleBindings can reference either a (namespaced) Role
                    // in the same namespace or a (cluster-scoped) ClusterRole.
                    namespace: props.roleRef.kind === 'Role' ? namespace : undefined,
                    ...clusterMeta,
                  })}
                >
                  {props.roleRef.kind}/{props.roleRef.name}
                </ObjectPanelLink>
              }
            />
          )}
          {props.subjects && props.subjects.length > 0 && (
            <OverviewItem
              label="Subjects"
              fullWidth
              value={
                <SubjectGroups
                  subjects={props.subjects}
                  namespace={namespace}
                  clusterMeta={clusterMeta}
                />
              }
            />
          )}
        </>
      )}

      {/* ServiceAccount-specific fields */}
      {normalizedKind === 'serviceaccount' && (
        <>
          <OverviewItem
            label="Secrets"
            value={props.secrets ? `${props.secrets.length} secret(s)` : undefined}
          />
          <OverviewItem
            label="Image Pull Secrets"
            value={
              props.imagePullSecrets ? `${props.imagePullSecrets.length} secret(s)` : undefined
            }
          />
          <OverviewItem
            label="Automount Token"
            value={props.automountServiceAccountToken ? 'Yes' : 'No'}
          />
        </>
      )}

      {/* Use the shared metadata renderer for RBAC resources. */}
      {(normalizedKind === 'role' ||
        normalizedKind === 'rolebinding' ||
        normalizedKind === 'serviceaccount' ||
        normalizedKind === 'clusterrole' ||
        normalizedKind === 'clusterrolebinding') && (
        <ResourceMetadata labels={props.labels} annotations={props.annotations} />
      )}
    </>
  );
};
