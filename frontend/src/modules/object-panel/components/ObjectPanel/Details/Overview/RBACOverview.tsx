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
import { buildObjectReference } from '@shared/utils/objectIdentity';
import './shared/LabelsAndAnnotations.css';
import './RBACOverview.css';

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
                    objectRef={buildObjectReference({
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
              value={`${props.roleRef.kind}: ${props.roleRef.name}`}
            />
          )}
          {props.subjects && props.subjects.length > 0 && (
            <OverviewItem
              label="Subjects"
              value={props.subjects.map((subject: any, index: number) => (
                <div key={index}>
                  {subject.kind}: {subject.namespace ? `${subject.namespace}/` : ''}
                  {subject.name}
                </div>
              ))}
              fullWidth
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
