/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ClusterResourceOverview.tsx
 *
 * UI component for ClusterResourceOverview.
 * Handles rendering and interactions for the object panel feature.
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import '@styles/components/badges.css';

interface ClusterResourceOverviewProps {
  kind?: string;
  name?: string;
  age?: string;
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  // Namespace-specific fields
  hasWorkloads?: boolean;
  workloadsUnknown?: boolean;
  // IngressClass-specific fields
  controller?: string;
  isDefault?: boolean;
  // CRD-specific fields
  group?: string;
  scope?: string;
  versions?: any[];
  names?: any;
  // Webhook-specific fields
  webhooks?: any[];
}

export const ClusterResourceOverview: React.FC<ClusterResourceOverviewProps> = (props) => {
  const { kind, name, age, status } = props;
  const normalizedKind = kind?.toLowerCase();

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} age={age} />
      <ResourceStatus status={status} />

      {/* Namespace-specific fields */}
      {normalizedKind === 'namespace' && (
        <>
          <OverviewItem
            label="Has Workloads"
            value={
              props.workloadsUnknown ? (
                <span className="status-badge warning">Unknown</span>
              ) : props.hasWorkloads ? (
                'Yes'
              ) : (
                'No'
              )
            }
          />
        </>
      )}

      {/* IngressClass-specific fields */}
      {normalizedKind === 'ingressclass' && (
        <>
          <OverviewItem label="Controller" value={props.controller} />
          <OverviewItem label="Default Class" value={props.isDefault ? 'Yes' : 'No'} />
        </>
      )}

      {/* CRD-specific fields */}
      {normalizedKind === 'customresourcedefinition' && (
        <>
          <OverviewItem label="Group" value={props.group} />
          <OverviewItem label="Scope" value={props.scope} />
          <OverviewItem
            label="Versions"
            value={props.versions ? `${props.versions.length} version(s)` : undefined}
          />
          {props.names && (
            <>
              <OverviewItem label="Kind" value={props.names.kind} />
              <OverviewItem label="Plural" value={props.names.plural} />
            </>
          )}
        </>
      )}

      {/* Webhook-specific fields */}
      {(normalizedKind === 'mutatingwebhookconfiguration' ||
        normalizedKind === 'validatingwebhookconfiguration') && (
        <>
          <OverviewItem
            label="Webhooks"
            value={props.webhooks ? `${props.webhooks.length} webhook(s)` : undefined}
          />
        </>
      )}

      {/* Cluster config resources should show metadata like ConfigMaps/Secrets. */}
      {(normalizedKind === 'customresourcedefinition' ||
        normalizedKind === 'ingressclass' ||
        normalizedKind === 'mutatingwebhookconfiguration' ||
        normalizedKind === 'validatingwebhookconfiguration') && (
        <ResourceMetadata labels={props.labels} annotations={props.annotations} />
      )}
    </>
  );
};
