/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/RBACOverview.tsx
 *
 * UI component for RBACOverview.
 * Handles rendering and interactions for the object panel feature.
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
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

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} namespace={namespace} age={age} />

      {/* Role/ClusterRole-specific fields */}
      {(normalizedKind === 'role' || normalizedKind === 'clusterrole') && (
        <>{props.aggregationRule && <OverviewItem label="Aggregation" value="Enabled" />}</>
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

      {/* Rules section for Roles/ClusterRoles */}
      {(normalizedKind === 'role' || normalizedKind === 'clusterrole') &&
        props.policyRules &&
        props.policyRules.length > 0 && (
          <>
            <div className="metadata-section-separator" />
            <div className="metadata-section">
              <div className="metadata-label">Rules</div>
              <div className="metadata-pairs">
                {props.policyRules.map((rule: any, index: number) => (
                  <div key={index} className="metadata-pair rules-pair">
                    <span className="metadata-key">Rule {index + 1}:</span>
                    <div className="rule-details">
                      {rule.apiGroups && (
                        <div className="rule-field">
                          <span className="field-label">API Groups:</span>
                          <span className="field-value">
                            {rule.apiGroups.length === 1 && rule.apiGroups[0] === ''
                              ? '""'
                              : rule.apiGroups.length === 0
                                ? '""'
                                : rule.apiGroups
                                    .map((g: string) => (g === '' ? '""' : g))
                                    .join(', ')}
                          </span>
                        </div>
                      )}
                      {rule.resources && rule.resources.length > 0 && (
                        <div className="rule-field">
                          <span className="field-label">Resources:</span>
                          <span className="field-value">{rule.resources.join(', ')}</span>
                        </div>
                      )}
                      {rule.resourceNames && rule.resourceNames.length > 0 && (
                        <div className="rule-field">
                          <span className="field-label">Resource Names:</span>
                          <span className="field-value">{rule.resourceNames.join(', ')}</span>
                        </div>
                      )}
                      {rule.verbs && rule.verbs.length > 0 && (
                        <div className="rule-field">
                          <span className="field-label">Verbs:</span>
                          <span className="field-value verbs">
                            {rule.verbs.map((v: string) => (v === '*' ? '* (all)' : v)).join(', ')}
                          </span>
                        </div>
                      )}
                      {rule.nonResourceURLs && rule.nonResourceURLs.length > 0 && (
                        <div className="rule-field">
                          <span className="field-label">Non-Resource URLs:</span>
                          <span className="field-value">{rule.nonResourceURLs.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
