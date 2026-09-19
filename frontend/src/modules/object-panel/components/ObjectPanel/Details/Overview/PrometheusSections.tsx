import type {
  PrometheusEndpoint,
  PrometheusFacts,
  PrometheusInstance,
  PrometheusMonitor,
  PrometheusNamespaceSelector,
  PrometheusRuleGroup,
} from '@core/refresh/types';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import {
  OperatorCard as Card,
  OperatorFields as Fields,
  OperatorList as List,
  OperatorMessage as Message,
  operatorBoolean,
  operatorEntries,
  operatorListValue,
  operatorSelectorValues,
  OperatorSection as Section,
  OperatorSelector as Selector,
  OperatorValues as Values,
} from './shared/OperatorOverview';

// ServiceMonitors select Services, PodMonitors select Pods; the row label says which.
const targetKind = (kind: string): string =>
  kind.toLowerCase() === 'podmonitor' ? 'Pods' : 'Services';

// An empty namespace selector means the monitor's own namespace, so name it when known.
const namespaceValues = (selector: PrometheusNamespaceSelector, namespace?: string): string[] => {
  if (selector.any) {
    return ['All namespaces'];
  }
  if (selector.matchNames?.length) {
    return selector.matchNames;
  }
  return [namespace ? `${namespace} (same namespace)` : 'Same namespace'];
};

// The card title is the port the endpoint names; when only a numeric target port or port number
// is set, the API field name says where the number came from.
const endpointIdentity = (
  endpoint: PrometheusEndpoint,
  index: number
): { title: string; source?: string } => {
  if (endpoint.port) {
    return { title: endpoint.port };
  }
  if (endpoint.targetPort) {
    return { title: endpoint.targetPort, source: 'targetPort' };
  }
  if (endpoint.portNumber !== undefined) {
    return { title: String(endpoint.portNumber), source: 'portNumber' };
  }
  return { title: `Endpoint ${index + 1}` };
};

const endpointCadence = (endpoint: PrometheusEndpoint): string =>
  [
    endpoint.interval ? `every ${endpoint.interval}` : '',
    endpoint.scrapeTimeout ? `timeout ${endpoint.scrapeTimeout}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

function Endpoint({ endpoint, index }: Readonly<{ endpoint: PrometheusEndpoint; index: number }>) {
  const identity = endpointIdentity(endpoint, index);
  // Scheme and path are shown only when the object sets them; defaults are not invented here.
  const meta = [identity.source, endpoint.scheme, endpoint.path].filter(Boolean).join(' ');
  const named = !!endpoint.port;
  return (
    <Card
      title={identity.title}
      meta={meta || undefined}
      tag={endpointCadence(endpoint) || undefined}
    >
      <Fields
        fields={[
          ['Target Port', named ? endpoint.targetPort : undefined],
          ['Port Number', named || endpoint.targetPort ? endpoint.portNumber : undefined],
          ['Honor Labels', operatorBoolean(endpoint.honorLabels)],
          ['Honor Timestamps', operatorBoolean(endpoint.honorTimestamps)],
        ]}
      />
    </Card>
  );
}

function Monitor({
  facts,
  kind,
  namespace,
}: Readonly<{ facts: PrometheusMonitor; kind: string; namespace?: string }>) {
  return (
    <>
      <Section title="Targets">
        <Fields
          fields={[
            [
              targetKind(kind),
              <List key="selector" values={operatorSelectorValues(facts.selector)} />,
            ],
            [
              'Namespaces',
              <List
                key="namespaces"
                values={namespaceValues(facts.namespaceSelector, namespace)}
              />,
            ],
            ['Job Label', facts.jobLabel],
            ['Sample Limit', facts.sampleLimit],
            ['Target Limit', facts.targetLimit],
            ['Target Labels', operatorListValue(facts.targetLabels)],
            ['Pod Target Labels', operatorListValue(facts.podTargetLabels)],
          ]}
        />
      </Section>
      {!!facts.endpoints?.length && (
        <Section title="Scrape Endpoints">
          <div className="overview-card-list">
            {withStableListKeys(facts.endpoints, (endpoint) => JSON.stringify(endpoint)).map(
              ({ key, value }, index) => (
                <Endpoint key={key} endpoint={value} index={index} />
              )
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function Rules({ groups }: Readonly<{ groups: PrometheusRuleGroup[] }>) {
  return (
    <Section title="Rule Groups">
      {withStableListKeys(groups, (group) => group.name).map(({ key, value }) => (
        <Card key={key} title={value.name}>
          <Fields
            fields={[
              ['Interval', value.interval],
              ['Limit', value.limit],
              ['Rules', value.rules?.length ?? 0],
            ]}
          />
          {withStableListKeys(
            value.rules ?? [],
            (rule) => rule.alert || rule.record || rule.expr
          ).map(({ key: ruleKey, value: rule }) => (
            <div key={ruleKey} className="operator-rule">
              <Fields
                fields={[
                  [rule.alert ? 'Alert' : 'Recording Rule', rule.alert || rule.record],
                  ['For', rule.for],
                  ['Keep Firing For', rule.keepFiringFor],
                ]}
              />
              <Message label="Expression" text={rule.expr} />
              <Values label="Labels" values={operatorEntries(rule.labels)} />
              <Values label="Annotations" values={operatorEntries(rule.annotations)} />
            </div>
          ))}
        </Card>
      ))}
    </Section>
  );
}

function InstanceSelectors({ facts, kind }: Readonly<{ facts: PrometheusInstance; kind: string }>) {
  if (kind === 'Alertmanager') {
    return (
      <Section title="Configuration Selection">
        <Fields fields={[['Config Secret', facts.configSecret]]} />
        <Selector label="AlertmanagerConfig Selector" selector={facts.alertmanagerConfigSelector} />
        <Selector
          label="AlertmanagerConfig Namespaces"
          selector={facts.alertmanagerConfigNamespaceSelector}
          absent="Same Namespace"
        />
      </Section>
    );
  }
  return (
    <Section title="Resource Selection">
      <Selector label="ServiceMonitor Selector" selector={facts.serviceMonitorSelector} />
      <Selector
        label="ServiceMonitor Namespaces"
        selector={facts.serviceMonitorNamespaceSelector}
        absent="Same Namespace"
      />
      <Selector label="PodMonitor Selector" selector={facts.podMonitorSelector} />
      <Selector
        label="PodMonitor Namespaces"
        selector={facts.podMonitorNamespaceSelector}
        absent="Same Namespace"
      />
      <Selector label="PrometheusRule Selector" selector={facts.ruleSelector} />
      <Selector
        label="PrometheusRule Namespaces"
        selector={facts.ruleNamespaceSelector}
        absent="Same Namespace"
      />
    </Section>
  );
}

function Instance({ facts, kind }: Readonly<{ facts: PrometheusInstance; kind: string }>) {
  return (
    <>
      <Section title="Instance">
        <Fields
          fields={[
            ['Version', facts.version],
            ['Replicas', facts.replicas],
            ['Shards', facts.shards],
            ['Available Replicas', facts.availableReplicas],
            ['Updated Replicas', facts.updatedReplicas],
            ['Unavailable Replicas', facts.unavailableReplicas],
            ['Paused', operatorBoolean(facts.paused)],
            ['Storage Request', facts.storageRequest],
            ['Retention', facts.retention],
            ['Retention Size', facts.retentionSize],
            ['Scrape Interval', facts.scrapeInterval],
            ['Evaluation Interval', facts.evaluationInterval],
          ]}
        />
        <Values label="External Labels" values={operatorEntries(facts.externalLabels)} />
      </Section>
      <InstanceSelectors facts={facts} kind={kind} />
    </>
  );
}

export function PrometheusSections({
  facts,
  kind,
  namespace,
}: Readonly<{ facts: PrometheusFacts; kind: string; namespace?: string }>) {
  return (
    <>
      {!!facts.monitor && <Monitor facts={facts.monitor} kind={kind} namespace={namespace} />}
      {!!facts.ruleGroups?.length && <Rules groups={facts.ruleGroups} />}
      {!!facts.instance && <Instance facts={facts.instance} kind={kind} />}
    </>
  );
}
