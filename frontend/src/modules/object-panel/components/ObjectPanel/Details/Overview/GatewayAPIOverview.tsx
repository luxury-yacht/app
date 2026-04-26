/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/GatewayAPIOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { buildObjectReference } from '@shared/utils/objectIdentity';
import './NetworkOverview.css';

interface GatewayAPIOverviewProps {
  gatewayDetails?: types.GatewayDetails | null;
  gatewayClassDetails?: types.GatewayClassDetails | null;
  routeDetails?: types.RouteDetails | null;
  listenerSetDetails?: types.ListenerSetDetails | null;
  referenceGrantDetails?: types.ReferenceGrantDetails | null;
  backendTLSPolicyDetails?: types.BackendTLSPolicyDetails | null;
}

const conditionClass = (condition: types.ConditionState): string => {
  switch (condition.status) {
    case 'True':
      return 'success';
    case 'False':
      return 'error';
    default:
      return 'warning';
  }
};

const objectRefLabel = (ref: types.ObjectRef): string =>
  `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ''}${ref.name}`;

const displayRefLabel = (ref: types.DisplayRef): string =>
  `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ''}${ref.name || '(name not specified)'}`;

const hasObjectRefFields = (value: unknown): value is types.ObjectRef => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const ref = value as Partial<types.ObjectRef>;
  return Boolean(ref.clusterId && ref.group !== undefined && ref.version && ref.kind && ref.name);
};

const getRefParts = (
  value?: types.ObjectRef | types.RefOrDisplay | null
): { ref?: types.ObjectRef; display?: types.DisplayRef } => {
  if (!value) {
    return {};
  }
  if (hasObjectRefFields(value)) {
    return { ref: value };
  }
  return {
    ref: value.ref,
    display: value.display,
  };
};

const RefLink: React.FC<{
  value?: types.ObjectRef | types.RefOrDisplay | null;
  clusterName?: string;
}> = ({ value, clusterName }) => {
  const { ref, display } = getRefParts(value);

  if (ref) {
    return (
      <ObjectPanelLink
        objectRef={buildObjectReference({
          kind: ref.kind,
          name: ref.name,
          namespace: ref.namespace,
          clusterId: ref.clusterId,
          clusterName,
          group: ref.group,
          version: ref.version,
        })}
      >
        {objectRefLabel(ref)}
      </ObjectPanelLink>
    );
  }

  if (display) {
    return <span>{displayRefLabel(display)}</span>;
  }

  return null;
};

const ConditionList: React.FC<{ conditions?: types.ConditionState[] | null }> = ({
  conditions,
}) => {
  if (!conditions || conditions.length === 0) {
    return null;
  }
  return (
    <div className="gateway-condition-list">
      {conditions.map((condition) => (
        <div
          key={`${condition.type ?? 'condition'}-${condition.reason ?? condition.status}`}
          className="gateway-condition"
          title={condition.message}
        >
          <span className={`status-badge ${conditionClass(condition)}`}>
            {condition.type || 'Condition'}: {condition.status}
          </span>
          {condition.reason && <span className="gateway-condition-reason">{condition.reason}</span>}
        </div>
      ))}
    </div>
  );
};

const ListenerList: React.FC<{ listeners?: types.GatewayListenerDetails[] | null }> = ({
  listeners,
}) => {
  if (!listeners || listeners.length === 0) {
    return null;
  }
  return (
    <div className="gateway-listener-list">
      {listeners.map((listener) => (
        <div
          key={`${listener.name}-${listener.port}-${listener.protocol}`}
          className="gateway-listener"
        >
          <div className="gateway-listener-main">
            <span className="gateway-listener-name">{listener.name}</span>
            <span className="gateway-listener-protocol">
              {listener.protocol}/{listener.port}
            </span>
            {listener.hostname && (
              <span className="gateway-listener-host">{listener.hostname}</span>
            )}
            <span className="gateway-listener-routes">
              {listener.attachedRoutes} attached route(s)
            </span>
          </div>
          <ConditionList conditions={listener.conditions} />
        </div>
      ))}
    </div>
  );
};

const RefList: React.FC<{
  refs?: Array<types.ObjectRef | types.RefOrDisplay> | null;
  clusterName?: string;
}> = ({ refs, clusterName }) => {
  if (!refs || refs.length === 0) {
    return null;
  }
  return (
    <div className="gateway-ref-list">
      {refs.map((ref, index) => (
        <div key={`ref-${index}`} className="gateway-ref-item">
          <RefLink value={ref} clusterName={clusterName} />
        </div>
      ))}
    </div>
  );
};

const GatewayDetailsOverview: React.FC<{
  details: types.GatewayDetails;
  clusterName?: string;
}> = ({ details, clusterName }) => {
  const hasAddresses = Boolean(details.addresses?.length);
  const hasListeners = Boolean(details.listeners?.length);
  const hasConditions = Boolean(details.conditions?.length);

  return (
    <>
      <ResourceHeader
        kind="Gateway"
        name={details.name}
        namespace={details.namespace}
        age={details.age}
      />
      <OverviewItem
        label="Gateway Class"
        value={<RefLink value={details.gatewayClassRef} clusterName={clusterName} />}
      />
      <OverviewItem
        label="Addresses"
        value={details.addresses?.join(', ')}
        fullWidth
        hidden={!hasAddresses}
      />
      <OverviewItem
        label="Listeners"
        value={<ListenerList listeners={details.listeners} />}
        fullWidth
        hidden={!hasListeners}
      />
      <OverviewItem
        label="Conditions"
        value={<ConditionList conditions={details.conditions} />}
        fullWidth
        hidden={!hasConditions}
      />
      <ResourceMetadata labels={details.labels} annotations={details.annotations} />
    </>
  );
};

const GatewayClassOverview: React.FC<{
  details: types.GatewayClassDetails;
  clusterName?: string;
}> = ({ details, clusterName }) => {
  const hasUsedBy = Boolean(details.usedBy?.length);
  const hasConditions = Boolean(details.conditions?.length);

  return (
    <>
      <ResourceHeader kind="GatewayClass" name={details.name} age={details.age} />
      <OverviewItem label="Controller" value={details.controller} fullWidth />
      <OverviewItem
        label="Parameters"
        value={<RefLink value={details.parameters} clusterName={clusterName} />}
        fullWidth
        hidden={!details.parameters}
      />
      <OverviewItem
        label="Used By"
        value={<RefList refs={details.usedBy} clusterName={clusterName} />}
        fullWidth
        hidden={!hasUsedBy}
      />
      <OverviewItem
        label="Conditions"
        value={<ConditionList conditions={details.conditions} />}
        fullWidth
        hidden={!hasConditions}
      />
      <ResourceMetadata labels={details.labels} annotations={details.annotations} />
    </>
  );
};

const RouteOverview: React.FC<{
  details: types.RouteDetails;
  clusterName?: string;
}> = ({ details, clusterName }) => {
  const hasHostnames = Boolean(details.hostnames?.length);
  const hasParentRefs = Boolean(details.parentRefs?.length);
  const hasBackendRefs = Boolean(details.backendRefs?.length);
  const hasRules = Boolean(details.rules?.length);
  const hasConditions = Boolean(details.conditions?.length);

  return (
    <>
      <ResourceHeader
        kind={details.kind}
        name={details.name}
        namespace={details.namespace}
        age={details.age}
      />
      <OverviewItem
        label="Hostnames"
        value={details.hostnames?.join(', ')}
        fullWidth
        hidden={!hasHostnames}
      />
      <OverviewItem
        label="Parent Refs"
        value={<RefList refs={details.parentRefs} clusterName={clusterName} />}
        fullWidth
        hidden={!hasParentRefs}
      />
      <OverviewItem
        label="Backend Refs"
        value={<RefList refs={details.backendRefs} clusterName={clusterName} />}
        fullWidth
        hidden={!hasBackendRefs}
      />
      <OverviewItem
        label="Rules"
        value={
          <div className="gateway-rule-list">
            {details.rules?.map((rule, index) => (
              <div key={`rule-${index}`} className="gateway-rule">
                {rule.matches && rule.matches.length > 0 && (
                  <div className="gateway-rule-line">
                    <strong>Matches:</strong> {rule.matches.join(', ')}
                  </div>
                )}
                <RefList refs={rule.backendRefs} clusterName={clusterName} />
              </div>
            ))}
          </div>
        }
        fullWidth
        hidden={!hasRules}
      />
      <OverviewItem
        label="Conditions"
        value={<ConditionList conditions={details.conditions} />}
        fullWidth
        hidden={!hasConditions}
      />
      <ResourceMetadata labels={details.labels} annotations={details.annotations} />
    </>
  );
};

const ListenerSetOverview: React.FC<{
  details: types.ListenerSetDetails;
  clusterName?: string;
}> = ({ details, clusterName }) => {
  const hasListeners = Boolean(details.listeners?.length);
  const hasConditions = Boolean(details.conditions?.length);

  return (
    <>
      <ResourceHeader
        kind="ListenerSet"
        name={details.name}
        namespace={details.namespace}
        age={details.age}
      />
      <OverviewItem
        label="Parent Gateway"
        value={<RefLink value={details.parentRef} clusterName={clusterName} />}
      />
      <OverviewItem
        label="Listeners"
        value={<ListenerList listeners={details.listeners} />}
        fullWidth
        hidden={!hasListeners}
      />
      <OverviewItem
        label="Conditions"
        value={<ConditionList conditions={details.conditions} />}
        fullWidth
        hidden={!hasConditions}
      />
      <ResourceMetadata labels={details.labels} annotations={details.annotations} />
    </>
  );
};

const ReferenceGrantOverview: React.FC<{
  details: types.ReferenceGrantDetails;
  clusterName?: string;
}> = ({ details, clusterName }) => {
  const hasFrom = Boolean(details.from?.length);
  const hasTo = Boolean(details.to?.length);

  return (
    <>
      <ResourceHeader
        kind="ReferenceGrant"
        name={details.name}
        namespace={details.namespace}
        age={details.age}
      />
      <OverviewItem
        label="From"
        value={
          <div className="gateway-ref-list">
            {details.from?.map((from) => (
              <div
                key={`${from.group}-${from.kind}-${from.namespace}`}
                className="gateway-ref-item"
              >
                {from.group}/{from.kind} from {from.namespace}
              </div>
            ))}
          </div>
        }
        fullWidth
        hidden={!hasFrom}
      />
      <OverviewItem
        label="To"
        value={<RefList refs={details.to} clusterName={clusterName} />}
        fullWidth
        hidden={!hasTo}
      />
      <ResourceMetadata labels={details.labels} annotations={details.annotations} />
    </>
  );
};

const BackendTLSPolicyOverview: React.FC<{
  details: types.BackendTLSPolicyDetails;
  clusterName?: string;
}> = ({ details, clusterName }) => {
  const hasTargetRefs = Boolean(details.targetRefs?.length);
  const hasConditions = Boolean(details.conditions?.length);

  return (
    <>
      <ResourceHeader
        kind="BackendTLSPolicy"
        name={details.name}
        namespace={details.namespace}
        age={details.age}
      />
      <OverviewItem
        label="Target Refs"
        value={<RefList refs={details.targetRefs} clusterName={clusterName} />}
        fullWidth
        hidden={!hasTargetRefs}
      />
      <OverviewItem
        label="Conditions"
        value={<ConditionList conditions={details.conditions} />}
        fullWidth
        hidden={!hasConditions}
      />
      <ResourceMetadata labels={details.labels} annotations={details.annotations} />
    </>
  );
};

export const GatewayAPIOverview: React.FC<GatewayAPIOverviewProps> = ({
  gatewayDetails,
  gatewayClassDetails,
  routeDetails,
  listenerSetDetails,
  referenceGrantDetails,
  backendTLSPolicyDetails,
}) => {
  const { objectData } = useObjectPanel();
  const clusterName = objectData?.clusterName ?? undefined;

  if (gatewayDetails) {
    return <GatewayDetailsOverview details={gatewayDetails} clusterName={clusterName} />;
  }
  if (gatewayClassDetails) {
    return <GatewayClassOverview details={gatewayClassDetails} clusterName={clusterName} />;
  }
  if (routeDetails) {
    return <RouteOverview details={routeDetails} clusterName={clusterName} />;
  }
  if (listenerSetDetails) {
    return <ListenerSetOverview details={listenerSetDetails} clusterName={clusterName} />;
  }
  if (referenceGrantDetails) {
    return <ReferenceGrantOverview details={referenceGrantDetails} clusterName={clusterName} />;
  }
  if (backendTLSPolicyDetails) {
    return <BackendTLSPolicyOverview details={backendTLSPolicyDetails} clusterName={clusterName} />;
  }
  return null;
};
