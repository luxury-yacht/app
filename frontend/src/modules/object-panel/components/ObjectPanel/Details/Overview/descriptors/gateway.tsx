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

import type {
  backendtlspolicy,
  gateway,
  gatewayclass,
  listenerset,
  referencegrant,
  resourcemodel,
  types,
} from '@core/backend-api/models';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { OverviewContext, OverviewDescriptor } from '../schema';
import { ExternalHostLinks } from '../shared/ExternalHostLinks';
import { listenerScheme } from '../shared/hostLink';
import {
  FlowArrow,
  FlowEndpoint,
  FlowEndpoints,
  FlowScope,
  FlowSubject,
  FlowTerm,
  FlowTermLines,
  TrafficFlow,
  TrafficFlowRule,
  TrafficFlowRules,
  TrafficFlowSection,
} from '../shared/TrafficFlow';
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

const namespacePrefix = (namespace?: string): string => (namespace ? `${namespace}/` : '');

interface RefLabelOptions {
  omitNamespace?: boolean;
  nameOnly?: boolean;
}

// `Kind namespace/name` by default; shorter when the surrounding context already shows the rest.
const refLabel = (
  kind: string,
  namespace: string | undefined,
  name: string,
  { omitNamespace, nameOnly }: RefLabelOptions
): string => {
  if (nameOnly) {
    return name;
  }
  if (omitNamespace) {
    return `${kind}/${name}`;
  }
  return `${kind} ${namespacePrefix(namespace)}${name}`;
};

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
    ref: value.ref ?? undefined,
    display: value.display ?? undefined,
  };
};

const RefLink: React.FC<{
  value?: ObjectRef | types.RefOrDisplay | null;
  clusterName?: string;
  /** Render as `Kind/name` (no namespace) when the surrounding context
   *  already shows the namespace — e.g., inside a per-namespace card. */
  omitNamespace?: boolean;
  /** Render only the name when the surrounding context already shows kind and namespace. */
  nameOnly?: boolean;
}> = ({ value, clusterName, omitNamespace, nameOnly }) => {
  const { ref, display } = getRefParts(value);

  if (ref) {
    if (!ref.name) {
      return null;
    }
    const label = refLabel(ref.kind, ref.namespace, ref.name, { omitNamespace, nameOnly });
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
    const label = refLabel(display.kind, display.namespace, display.name || '*', {
      omitNamespace,
      nameOnly,
    });
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

// ---------- Route rules as traffic flows ----------

const PATH_SUBJECTS: Record<string, string> = {
  Exact: 'Path exactly',
  PathPrefix: 'Paths starting with',
  RegularExpression: 'Paths matching regex',
};

// PathPrefix "/" is the API default and matches every path.
const HttpPathSubject: React.FC<{ path?: types.RouteValueMatch | null }> = ({ path }) => {
  if (!path || (path.type === 'PathPrefix' && path.value === '/')) {
    return <FlowSubject>Any path</FlowSubject>;
  }
  return (
    <>
      <FlowSubject>{PATH_SUBJECTS[path.type] ?? `Paths (${path.type})`}</FlowSubject>
      <FlowTermLines terms={[path.value]} />
    </>
  );
};

// An empty service or method matches any; RegularExpression applies to both values.
const GrpcMethodSubject: React.FC<{ method?: types.RouteGRPCMethod | null }> = ({ method }) => {
  if (!method || (!method.service && !method.method)) {
    return <FlowSubject>Any method</FlowSubject>;
  }
  const regex = method.type === 'RegularExpression';
  if (method.service && !method.method) {
    return (
      <>
        <FlowSubject>{regex ? 'Services matching' : 'Any method of'}</FlowSubject>
        <FlowTermLines terms={[method.service]} />
      </>
    );
  }
  return (
    <>
      <FlowSubject>{regex ? 'Methods matching' : 'Method'}</FlowSubject>
      <FlowTermLines terms={[[method.service, method.method].filter(Boolean).join('/')]} />
      {!method.service && <FlowScope>in any service</FlowScope>}
    </>
  );
};

/** "and header name = value" lines; regular-expression comparisons read "matching". */
const NamedConditions: React.FC<{ label: string; matches?: types.RouteNamedMatch[] | null }> = ({
  label,
  matches,
}) => (
  <>
    {withStableListKeys(matches ?? [], (match) => JSON.stringify(match)).map(
      ({ key, value: match }) => (
        <FlowScope key={key}>
          and {label} <FlowTerm>{match.name}</FlowTerm>{' '}
          {match.type === 'RegularExpression' ? 'matching' : '='} <FlowTerm>{match.value}</FlowTerm>
        </FlowScope>
      )
    )}
  </>
);

// One match is one box: every condition in it must hold.
const MatchEndpoint: React.FC<{ kind: string; match: types.RouteMatchDetails }> = ({
  kind,
  match,
}) => (
  <FlowEndpoint>
    {kind === 'GRPCRoute' ? (
      <GrpcMethodSubject method={match.grpcMethod} />
    ) : (
      <HttpPathSubject path={match.path} />
    )}
    {!!match.method && (
      <FlowScope>
        and method <FlowTerm>{match.method}</FlowTerm>
      </FlowScope>
    )}
    <NamedConditions label="header" matches={match.headers} />
    <NamedConditions label="query" matches={match.queryParams} />
  </FlowEndpoint>
);

// A rule with no matches takes every request; TLS rules never have matches, so the route's
// hostnames decide which connections they take.
const UnmatchedEndpoint: React.FC<{ kind: string; hostnames?: string[] | null }> = ({
  kind,
  hostnames,
}) => {
  if (kind !== 'TLSRoute') {
    return (
      <FlowEndpoint>
        <FlowSubject>Any request</FlowSubject>
      </FlowEndpoint>
    );
  }
  return (
    <FlowEndpoint>
      <FlowSubject>TLS connections</FlowSubject>
      <FlowScope>
        {hostnames?.length ? (
          <>
            for <FlowTerm>{hostnames.join(', ')}</FlowTerm>
          </>
        ) : (
          'for any hostname'
        )}
      </FlowScope>
    </FlowEndpoint>
  );
};

const backendScope = (
  backend: types.RouteBackendRefDetails,
  routeNamespace: string,
  share: number | null
): string[] => {
  const { ref, display } = getRefParts(backend.target);
  const namespace = ref?.namespace ?? display?.namespace;
  const parts: string[] = [];
  if (typeof backend.port === 'number') {
    parts.push(`port ${backend.port}`);
  }
  if (namespace && namespace !== routeNamespace) {
    parts.push(`in namespace ${namespace}`);
  }
  if (share !== null) {
    parts.push(`${share}% of traffic`);
  }
  return parts;
};

// Weights are relative to the rule's other backends.
const BackendEndpoint: React.FC<{
  backend: types.RouteBackendRefDetails;
  share: number | null;
  routeNamespace: string;
  clusterName?: string;
}> = ({ backend, share, routeNamespace, clusterName }) => {
  const { ref, display } = getRefParts(backend.target);
  const scope = backendScope(backend, routeNamespace, share);
  return (
    <FlowEndpoint target>
      <FlowSubject>{ref?.kind ?? display?.kind ?? 'Backend'}</FlowSubject>
      <div className="reference-grant-item">
        <RefLink value={backend.target} clusterName={clusterName} nameOnly />
      </div>
      {scope.length > 0 && <FlowScope>{scope.join(' · ')}</FlowScope>}
      {share !== null && (
        <div className="traffic-flow-share" aria-hidden="true">
          <span style={{ width: `${share}%` }} />
        </div>
      )}
    </FlowEndpoint>
  );
};

// A lone backend gets all of its rule's traffic, so its share is only shown when its weight is 0
// (no traffic at all); split backends always show their share.
const trafficShares = (backends: types.RouteBackendRefDetails[]): Array<number | null> => {
  if (backends.length < 2) {
    return backends.map((backend) => (backend.weight > 0 ? null : 0));
  }
  const total = backends.reduce((sum, backend) => sum + backend.weight, 0);
  return backends.map((backend) => (total > 0 ? Math.round((backend.weight / total) * 100) : 0));
};

const RouteRuleFlow: React.FC<{
  route: RouteDetails;
  kind: string;
  rule: types.RouteRuleDetails;
  clusterName?: string;
}> = ({ route, kind, rule, clusterName }) => {
  const backends = rule.backendRefs ?? [];
  const shares = trafficShares(backends);
  return (
    <TrafficFlow
      from={
        <FlowEndpoints label="Requests">
          {rule.matches?.length ? (
            withStableListKeys(rule.matches, (match) => JSON.stringify(match)).map(
              ({ key, value: match }) => <MatchEndpoint key={key} kind={kind} match={match} />
            )
          ) : (
            <UnmatchedEndpoint kind={kind} hostnames={route.hostnames} />
          )}
        </FlowEndpoints>
      }
      middle={<FlowArrow />}
      to={
        <FlowEndpoints label="Backends">
          {backends.length > 0 ? (
            withStableListKeys(backends, (backend) => JSON.stringify(backend)).map(
              ({ key, value: backend }, index) => (
                <BackendEndpoint
                  key={key}
                  backend={backend}
                  share={shares[index] ?? null}
                  routeNamespace={route.namespace}
                  clusterName={clusterName}
                />
              )
            )
          ) : (
            <FlowEndpoint target>
              <FlowSubject>No backends</FlowSubject>
            </FlowEndpoint>
          )}
        </FlowEndpoints>
      }
    />
  );
};

const routeRulesSection =
  (kind: string) =>
  (route: RouteDetails, context: OverviewContext): React.ReactNode => {
    if (!route.rules?.length) {
      return null;
    }
    return (
      <TrafficFlowSection label="Rules" tone="inbound">
        <TrafficFlowRules label="Route rules">
          {withStableListKeys(route.rules, (rule) => JSON.stringify(rule)).map(
            ({ key, value: rule }, index) => (
              <TrafficFlowRule key={key} title={`Rule ${index + 1}`}>
                <RouteRuleFlow
                  route={route}
                  kind={kind}
                  rule={rule}
                  clusterName={context.clusterName}
                />
              </TrafficFlowRule>
            )
          )}
        </TrafficFlowRules>
      </TrafficFlowSection>
    );
  };

const groupByNamespace = <T,>(
  values: readonly T[] | null | undefined,
  namespaceOf: (value: T) => string
): Array<{ namespace: string; entries: T[] }> => {
  const groups = new Map<string, T[]>();
  for (const value of values ?? []) {
    const namespace = namespaceOf(value);
    const entries = groups.get(namespace);
    if (entries) {
      entries.push(value);
    } else {
      groups.set(namespace, [value]);
    }
  }
  return Array.from(groups, ([namespace, entries]) => ({ namespace, entries }));
};

const ReferenceGrantDiagram: React.FC<{
  from?: types.ReferenceGrantFromInfo[] | null;
  to?: Array<ObjectRef | types.RefOrDisplay> | null;
  clusterName?: string;
}> = ({ from, to, clusterName }) => {
  const fromGroups = groupByNamespace(from, (entry) => entry.namespace);
  const toGroups = groupByNamespace(to, (ref) => {
    const parts = getRefParts(ref);
    return parts.ref?.namespace ?? parts.display?.namespace ?? '';
  });
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
            {withStableListKeys(group.entries, (ref) => JSON.stringify(ref)).map(
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
  dtoName: 'GatewayDetails',
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
  dtoName: 'GatewayClassDetails',
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
  dtoName: 'ListenerSetDetails',
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
  dtoName: 'RouteDetails',
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
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        hidden: (d) => !d.conditions?.length,
        render: (d) => <ConditionList conditions={d.conditions} />,
      },
      { kind: 'widget', consumes: ['rules', 'hostnames'], render: routeRulesSection(displayKind) },
    ],
  },
  // `age` and `details` are table-summary fields; `summary` is conveyed by the condition chips;
  // `backendRefs` is the route-wide list, and every backend already appears in its rule's flow.
  coveredElsewhere: ['age', 'details', 'summary', 'backendRefs'],
});

export const httpRouteDescriptor = makeRouteDescriptor('HTTPRoute');
export const grpcRouteDescriptor = makeRouteDescriptor('GRPCRoute');
export const tlsRouteDescriptor = makeRouteDescriptor('TLSRoute');

export const referenceGrantDescriptor: OverviewDescriptor<ReferenceGrantDetails> = {
  displayKind: 'ReferenceGrant',
  dtoName: 'ReferenceGrantDetails',
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
  dtoName: 'BackendTLSPolicyDetails',
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
