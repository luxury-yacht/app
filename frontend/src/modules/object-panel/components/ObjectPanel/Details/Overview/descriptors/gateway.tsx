/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/gateway.tsx
 *
 * Overview descriptors for the eight Gateway API kinds (X1), one descriptor per kind reading its raw
 * DTO: Gateway, GatewayClass, ListenerSet, HTTPRoute/GRPCRoute/TLSRoute (one shared schema via
 * makeRouteDescriptor), ReferenceGrant, and BackendTLSPolicy. Presentation ported from
 * GatewayAPIOverview.tsx — its per-DTO sub-renderers collapse into per-kind schemas, with the
 * shared helpers (RefLink, condition/listener/rule rendering, ReferenceGrant diagram) moved here.
 *
 * Cluster identity for links comes from the threaded OverviewContext (the legacy component read it
 * from useObjectPanel), so render functions read `context.clusterName`.
 *
 * These DTOs carry `conditions` + `summary` rather than status/statusState, so there is no
 * `{kind:'status'}` item — conditions render as a field and `summary` is not surfaced.
 */

import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import {
  backendtlspolicy,
  gateway,
  gatewayclass,
  listenerset,
  referencegrant,
  type resourcemodel,
  types,
} from '@wailsjs/go/models';
import type React from 'react';
import type { OverviewDescriptor } from '../schema';
import { ExternalHostLinks } from '../shared/ExternalHostLinks';
import { listenerScheme } from '../shared/hostLink';
import '../shared/OverviewBlocks.css';

type GatewayDetails = gateway.GatewayDetails;
type GatewayClassDetails = gatewayclass.GatewayClassDetails;
type ListenerSetDetails = listenerset.ListenerSetDetails;
type RouteDetails = types.RouteDetails;
type ReferenceGrantDetails = referencegrant.ReferenceGrantDetails;
type BackendTLSPolicyDetails = backendtlspolicy.BackendTLSPolicyDetails;

type ObjectRef = resourcemodel.ResourceRef;
type DisplayRef = resourcemodel.DisplayRef;

const conditionVariant = (status: string): StatusChipVariant => {
  if (status === 'True') {
    return 'healthy';
  }
  if (status === 'False') {
    return 'unhealthy';
  }
  return 'warning';
};

const objectRefLabel = (ref: ObjectRef): string =>
  `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ''}${ref.name ?? '*'}`;

const displayRefLabel = (ref: DisplayRef): string =>
  `${ref.kind} ${ref.namespace ? `${ref.namespace}/` : ''}${ref.name || '*'}`;

const formatAttachedRoutes = (count: number): string =>
  `${count} ${count === 1 ? 'route' : 'routes'}`;

const hasObjectRefFields = (value: unknown): value is ObjectRef => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const ref = value as Partial<ObjectRef>;
  return Boolean(ref.clusterId && ref.group !== undefined && ref.version && ref.kind && ref.name);
};

const getRefParts = (
  value?: ObjectRef | types.RefOrDisplay | null
): { ref?: ObjectRef; display?: DisplayRef } => {
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
  value?: ObjectRef | types.RefOrDisplay | null;
  clusterName?: string;
  /** Render as `Kind/name` (no namespace) when the surrounding context
   *  already shows the namespace — e.g., inside a per-namespace card. */
  omitNamespace?: boolean;
}> = ({ value, clusterName, omitNamespace }) => {
  const { ref, display } = getRefParts(value);

  if (ref) {
    if (!ref.name) {
      return null;
    }
    const label = omitNamespace ? `${ref.kind}/${ref.name}` : objectRefLabel(ref);
    return (
      <ObjectPanelLink
        objectRef={buildRequiredObjectReference({
          kind: ref.kind,
          name: ref.name,
          namespace: ref.namespace,
          clusterId: ref.clusterId,
          clusterName,
          group: ref.group,
          version: ref.version,
        })}
      >
        {label}
      </ObjectPanelLink>
    );
  }

  if (display) {
    const label = omitNamespace
      ? `${display.kind}/${display.name || '*'}`
      : displayRefLabel(display);
    return <span>{label}</span>;
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
      {withStableListKeys(conditions, (condition) => JSON.stringify(condition)).map(
        ({ key, value: condition }) => (
          <StatusChip
            key={key}
            variant={conditionVariant(condition.status)}
            tooltip={condition.message || condition.reason || undefined}
          >
            {condition.type || 'Condition'}
          </StatusChip>
        )
      )}
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
      {withStableListKeys(listeners, (listener) => JSON.stringify(listener)).map(
        ({ key, value: listener }) => {
          const hasRows = Boolean(listener.hostname);
          // Only HTTP/HTTPS listeners get a browsable link; other protocols
          // (TLS/TCP/UDP) keep the hostname as plain text.
          const hostScheme = listenerScheme(listener.protocol);
          return (
            <div key={key} className="overview-card">
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
                  {!!listener.hostname && (
                    <div className="overview-row">
                      <span className="overview-row-label">Hostname</span>
                      <span className="overview-row-value">
                        <ExternalHostLinks
                          host={listener.hostname}
                          schemes={hostScheme ? [{ scheme: hostScheme, port: listener.port }] : []}
                        />
                      </span>
                    </div>
                  )}
                </div>
              )}
              <ConditionList conditions={listener.conditions} />
            </div>
          );
        }
      )}
    </div>
  );
};

const RefList: React.FC<{
  refs?: Array<ObjectRef | types.RefOrDisplay> | null;
  clusterName?: string;
}> = ({ refs, clusterName }) => {
  if (!refs || refs.length === 0) {
    return null;
  }
  return (
    <div className="overview-ref-list">
      {withStableListKeys(refs, (ref) => JSON.stringify(ref)).map(({ key, value: ref }) => (
        <div key={key} className="overview-ref-item">
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
      {withStableListKeys(rules, (rule) => JSON.stringify(rule)).map(
        ({ key, value: rule }, index) => {
          const hasMatches = Boolean(rule.matches?.length);
          const hasBackends = Boolean(rule.backendRefs?.length);
          return (
            <div key={key} className="overview-card">
              <div className="overview-card-header">
                <span className="overview-card-title">Rule {index + 1}</span>
              </div>
              {!!(hasMatches || hasBackends) && (
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
        }
      )}
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
    map.get(ns)?.push(entry);
  }
  return order.map((namespace) => ({ namespace, entries: map.get(namespace) ?? [] }));
};

const groupRefsByNamespace = (
  refs?: Array<ObjectRef | types.RefOrDisplay> | null
): Array<{ namespace: string; refs: Array<ObjectRef | types.RefOrDisplay> }> => {
  if (!refs || refs.length === 0) {
    return [];
  }
  const order: string[] = [];
  const map = new Map<string, Array<ObjectRef | types.RefOrDisplay>>();
  for (const ref of refs) {
    const parts = getRefParts(ref);
    const ns = parts.ref?.namespace ?? parts.display?.namespace ?? '';
    if (!map.has(ns)) {
      order.push(ns);
      map.set(ns, []);
    }
    map.get(ns)?.push(ref);
  }
  return order.map((namespace) => ({ namespace, refs: map.get(namespace) ?? [] }));
};

const ReferenceGrantDiagram: React.FC<{
  from?: types.ReferenceGrantFromInfo[] | null;
  to?: Array<ObjectRef | types.RefOrDisplay> | null;
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
        {withStableListKeys(fromGroups, (group) => group.namespace).map(({ key, value: group }) => (
          <div className="reference-grant-side" key={key}>
            <div className="reference-grant-namespace">{group.namespace}</div>
            {withStableListKeys(group.entries, (entry) => JSON.stringify(entry)).map(
              ({ key: entryKey, value: entry }) => (
                <div key={entryKey} className="reference-grant-item">
                  {entry.group}/{entry.kind}
                </div>
              )
            )}
          </div>
        ))}
      </div>
      <div className="reference-grant-arrow" aria-hidden="true">
        →
      </div>
      <div className="reference-grant-side-stack">
        {withStableListKeys(toGroups, (group) => group.namespace).map(({ key, value: group }) => (
          <div className="reference-grant-side" key={key}>
            {!!group.namespace && (
              <div className="reference-grant-namespace">{group.namespace}</div>
            )}
            {withStableListKeys(group.refs, (ref) => JSON.stringify(ref)).map(
              ({ key: refKey, value: ref }) => (
                <div key={refKey} className="reference-grant-item">
                  <RefLink value={ref} clusterName={clusterName} omitNamespace />
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const gatewayDescriptor: OverviewDescriptor<GatewayDetails> = {
  displayKind: 'Gateway',
  dtoClass: gateway.GatewayDetails,
  schema: {
    items: [
      {
        field: 'gatewayClassRef',
        label: 'Gateway Class',
        render: (d, context) => (
          <RefLink value={d.gatewayClassRef} clusterName={context.clusterName} />
        ),
      },
      {
        field: 'addresses',
        label: 'Addresses',
        fullWidth: true,
        hidden: (d) => !d.addresses?.length,
        render: (d) => d.addresses?.join(', '),
      },
      {
        field: 'listeners',
        label: 'Listeners',
        fullWidth: true,
        hidden: (d) => !d.listeners?.length,
        render: (d) => <ListenerList listeners={d.listeners} />,
      },
      {
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        hidden: (d) => !d.conditions?.length,
        render: (d) => <ConditionList conditions={d.conditions} />,
      },
    ],
  },
  // `details` (table-summary string) and `summary` (ConditionsSummary) are not surfaced — the
  // condition chips already convey per-condition state.
  coveredElsewhere: ['details', 'summary'],
};

export const gatewayClassDescriptor: OverviewDescriptor<GatewayClassDetails> = {
  displayKind: 'GatewayClass',
  dtoClass: gatewayclass.GatewayClassDetails,
  schema: {
    items: [
      { field: 'controller', label: 'Controller', fullWidth: true },
      {
        field: 'parameters',
        label: 'Parameters',
        fullWidth: true,
        hidden: (d) => !d.parameters,
        render: (d, context) => <RefLink value={d.parameters} clusterName={context.clusterName} />,
      },
      {
        field: 'usedBy',
        label: 'Used By',
        fullWidth: true,
        hidden: (d) => !d.usedBy?.length,
        render: (d, context) => <RefList refs={d.usedBy} clusterName={context.clusterName} />,
      },
      {
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        hidden: (d) => !d.conditions?.length,
        render: (d) => <ConditionList conditions={d.conditions} />,
      },
    ],
  },
  coveredElsewhere: ['details', 'summary'],
};

export const listenerSetDescriptor: OverviewDescriptor<ListenerSetDetails> = {
  displayKind: 'ListenerSet',
  dtoClass: listenerset.ListenerSetDetails,
  schema: {
    items: [
      {
        field: 'parentRef',
        label: 'Parent Gateway',
        render: (d, context) => <RefLink value={d.parentRef} clusterName={context.clusterName} />,
      },
      {
        field: 'listeners',
        label: 'Listeners',
        fullWidth: true,
        hidden: (d) => !d.listeners?.length,
        render: (d) => <ListenerList listeners={d.listeners} />,
      },
      {
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        hidden: (d) => !d.conditions?.length,
        render: (d) => <ConditionList conditions={d.conditions} />,
      },
    ],
  },
  coveredElsewhere: ['details', 'summary'],
};

/**
 * HTTPRoute, GRPCRoute, and TLSRoute share one RouteDetails shape and presentation; only the
 * displayed kind differs. The factory builds a descriptor per kind from one schema definition.
 */
const makeRouteDescriptor = (displayKind: string): OverviewDescriptor<RouteDetails> => ({
  displayKind,
  dtoClass: types.RouteDetails,
  schema: {
    items: [
      {
        field: 'hostnames',
        label: 'Hostnames',
        fullWidth: true,
        hidden: (d) => !d.hostnames?.length,
        render: (d) => d.hostnames?.join(', '),
      },
      {
        field: 'parentRefs',
        label: 'Parent Refs',
        fullWidth: true,
        hidden: (d) => !d.parentRefs?.length,
        render: (d, context) => <RefList refs={d.parentRefs} clusterName={context.clusterName} />,
      },
      {
        field: 'backendRefs',
        label: 'Backend Refs',
        fullWidth: true,
        hidden: (d) => !d.backendRefs?.length,
        render: (d, context) => <RefList refs={d.backendRefs} clusterName={context.clusterName} />,
      },
      {
        field: 'rules',
        label: 'Rules',
        fullWidth: true,
        hidden: (d) => !d.rules?.length,
        render: (d, context) => (
          <RouteRulesList rules={d.rules} clusterName={context.clusterName} />
        ),
      },
      {
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        hidden: (d) => !d.conditions?.length,
        render: (d) => <ConditionList conditions={d.conditions} />,
      },
    ],
  },
  // `age` and `details` are table-summary fields; `summary` is conveyed by the condition chips.
  coveredElsewhere: ['age', 'details', 'summary'],
});

export const httpRouteDescriptor = makeRouteDescriptor('HTTPRoute');
export const grpcRouteDescriptor = makeRouteDescriptor('GRPCRoute');
export const tlsRouteDescriptor = makeRouteDescriptor('TLSRoute');

export const referenceGrantDescriptor: OverviewDescriptor<ReferenceGrantDetails> = {
  displayKind: 'ReferenceGrant',
  dtoClass: referencegrant.ReferenceGrantDetails,
  schema: {
    items: [
      {
        field: 'from',
        derivedFrom: ['to'],
        label: 'Grant',
        fullWidth: true,
        hidden: (d) => !(d.from?.length || d.to?.length),
        // Rendered as a stacked section (label above, diagram below) via fullWidth so the
        // from→to diagram spans the panel rather than sitting in a narrow value column.
        render: (d, context) => (
          <ReferenceGrantDiagram from={d.from} to={d.to} clusterName={context.clusterName} />
        ),
      },
    ],
  },
  coveredElsewhere: ['details'],
};

export const backendTLSPolicyDescriptor: OverviewDescriptor<BackendTLSPolicyDetails> = {
  displayKind: 'BackendTLSPolicy',
  dtoClass: backendtlspolicy.BackendTLSPolicyDetails,
  schema: {
    items: [
      {
        field: 'targetRefs',
        label: 'Target Refs',
        fullWidth: true,
        hidden: (d) => !d.targetRefs?.length,
        render: (d, context) => <RefList refs={d.targetRefs} clusterName={context.clusterName} />,
      },
      {
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        hidden: (d) => !d.conditions?.length,
        render: (d) => <ConditionList conditions={d.conditions} />,
      },
    ],
  },
  coveredElsewhere: ['details', 'summary'],
};
