/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/GatewayAPIOverview.tsx
 */

import React from 'react';
import { types } from '@wailsjs/go/models';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { buildObjectReference } from '@shared/utils/objectIdentity';
import './shared/OverviewBlocks.css';

interface GatewayAPIOverviewProps {
  gatewayDetails?: types.GatewayDetails | null;
  gatewayClassDetails?: types.GatewayClassDetails | null;
  routeDetails?: types.RouteDetails | null;
  listenerSetDetails?: types.ListenerSetDetails | null;
  referenceGrantDetails?: types.ReferenceGrantDetails | null;
  backendTLSPolicyDetails?: types.BackendTLSPolicyDetails | null;
}

const conditionVariant = (status: string): StatusChipVariant => {
  if (status === 'True') return 'healthy';
  if (status === 'False') return 'unhealthy';
  return 'warning';
};

const objectRefLabel = (ref: types.ObjectRef): string =>
  `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ''}${ref.name}`;

const displayRefLabel = (ref: types.DisplayRef): string =>
  `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ''}${ref.name || '*'}`;

const formatAttachedRoutes = (count: number): string =>
  `${count} ${count === 1 ? 'route' : 'routes'}`;

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
    <div className="overview-condition-list">
      {conditions.map((condition) => (
        <StatusChip
          key={`${condition.type ?? 'condition'}-${condition.reason ?? condition.status}`}
          variant={conditionVariant(condition.status)}
          tooltip={condition.message || condition.reason || undefined}
        >
          {condition.type || 'Condition'}
        </StatusChip>
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
    <div className="overview-card-list">
      {listeners.map((listener) => {
        const hasRows = Boolean(listener.hostname);
        return (
          <div
            key={`${listener.name}-${listener.port}-${listener.protocol}`}
            className="overview-card"
          >
            <div className="overview-card-header">
              <span className="overview-card-title">{listener.name}</span>
              <span className="overview-card-meta">
                {listener.protocol}/{listener.port}
              </span>
              <span className="overview-card-tag">
                {formatAttachedRoutes(listener.attachedRoutes)}
              </span>
            </div>
            {hasRows && (
              <div className="overview-card-rows">
                {listener.hostname && (
                  <div className="overview-row">
                    <span className="overview-row-label">Hostname</span>
                    <span className="overview-row-value">{listener.hostname}</span>
                  </div>
                )}
              </div>
            )}
            <ConditionList conditions={listener.conditions} />
          </div>
        );
      })}
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
    <div className="overview-ref-list">
      {refs.map((ref, index) => (
        <div key={`ref-${index}`} className="overview-ref-item">
          <RefLink value={ref} clusterName={clusterName} />
        </div>
      ))}
    </div>
  );
};

const RouteRulesList: React.FC<{
  rules?: types.RouteRuleDetails[] | null;
  clusterName?: string;
}> = ({ rules, clusterName }) => {
  if (!rules || rules.length === 0) {
    return null;
  }
  return (
    <div className="overview-card-list">
      {rules.map((rule, index) => {
        const hasMatches = Boolean(rule.matches?.length);
        const hasBackends = Boolean(rule.backendRefs?.length);
        return (
          <div key={`rule-${index}`} className="overview-card">
            <div className="overview-card-header">
              <span className="overview-card-title">Rule {index + 1}</span>
            </div>
            {(hasMatches || hasBackends) && (
              <div className="overview-card-rows">
                {hasMatches && (
                  <div className="overview-row">
                    <span className="overview-row-label">Matches</span>
                    <span className="overview-row-value">{rule.matches?.join(', ')}</span>
                  </div>
                )}
                {hasBackends && (
                  <div className="overview-row">
                    <span className="overview-row-label">Backends</span>
                    <span className="overview-row-value plain">
                      <RefList refs={rule.backendRefs} clusterName={clusterName} />
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const groupFromByNamespace = (
  from?: types.ReferenceGrantFromInfo[] | null
): Array<{ namespace: string; entries: types.ReferenceGrantFromInfo[] }> => {
  if (!from || from.length === 0) {
    return [];
  }
  const order: string[] = [];
  const map = new Map<string, types.ReferenceGrantFromInfo[]>();
  for (const entry of from) {
    const ns = entry.namespace;
    if (!map.has(ns)) {
      order.push(ns);
      map.set(ns, []);
    }
    map.get(ns)!.push(entry);
  }
  return order.map((namespace) => ({ namespace, entries: map.get(namespace)! }));
};

const groupRefsByNamespace = (
  refs?: Array<types.ObjectRef | types.RefOrDisplay> | null
): Array<{ namespace: string; refs: Array<types.ObjectRef | types.RefOrDisplay> }> => {
  if (!refs || refs.length === 0) {
    return [];
  }
  const order: string[] = [];
  const map = new Map<string, Array<types.ObjectRef | types.RefOrDisplay>>();
  for (const ref of refs) {
    const parts = getRefParts(ref);
    const ns = parts.ref?.namespace ?? parts.display?.namespace ?? '';
    if (!map.has(ns)) {
      order.push(ns);
      map.set(ns, []);
    }
    map.get(ns)!.push(ref);
  }
  return order.map((namespace) => ({ namespace, refs: map.get(namespace)! }));
};

const ReferenceGrantDiagram: React.FC<{
  from?: types.ReferenceGrantFromInfo[] | null;
  to?: Array<types.ObjectRef | types.RefOrDisplay> | null;
  clusterName?: string;
}> = ({ from, to, clusterName }) => {
  const fromGroups = groupFromByNamespace(from);
  const toGroups = groupRefsByNamespace(to);
  if (fromGroups.length === 0 && toGroups.length === 0) {
    return null;
  }
  return (
    <div className="reference-grant-diagram">
      <div className="reference-grant-side-stack">
        {fromGroups.map((group) => (
          <div className="reference-grant-side" key={`from-ns-${group.namespace}`}>
            <div className="reference-grant-namespace">{group.namespace}</div>
            {group.entries.map((entry) => (
              <div
                key={`from-${group.namespace}-${entry.group}-${entry.kind}`}
                className="reference-grant-item"
              >
                {entry.group}/{entry.kind}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="reference-grant-arrow" aria-hidden="true">
        →
      </div>
      <div className="reference-grant-side-stack">
        {toGroups.map((group, groupIndex) => (
          <div
            className="reference-grant-side"
            key={`to-ns-${group.namespace || groupIndex}`}
          >
            {group.namespace && (
              <div className="reference-grant-namespace">{group.namespace}</div>
            )}
            {group.refs.map((ref, refIndex) => (
              <div
                key={`to-${group.namespace}-${refIndex}`}
                className="reference-grant-item"
              >
                <RefLink value={ref} clusterName={clusterName} />
              </div>
            ))}
          </div>
        ))}
      </div>
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
        value={<RouteRulesList rules={details.rules} clusterName={clusterName} />}
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
  const hasGrant = Boolean(details.from?.length) || Boolean(details.to?.length);

  return (
    <>
      <ResourceHeader
        kind="ReferenceGrant"
        name={details.name}
        namespace={details.namespace}
        age={details.age}
      />
      {hasGrant && (
        <div className="overview-stacked">
          <div className="overview-label">Grant</div>
          <ReferenceGrantDiagram
            from={details.from}
            to={details.to}
            clusterName={clusterName}
          />
        </div>
      )}
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
