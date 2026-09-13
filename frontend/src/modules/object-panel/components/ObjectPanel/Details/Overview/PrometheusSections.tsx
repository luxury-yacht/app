import type {
  PrometheusFacts,
  PrometheusInstance,
  PrometheusMonitor,
  PrometheusRuleGroup,
} from '@core/refresh/types';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import {
  OperatorCard as Card,
  OperatorFields as Fields,
  OperatorMessage as Message,
  operatorBoolean,
  operatorEntries,
  OperatorSection as Section,
  OperatorSelector as Selector,
  OperatorValues as Values,
} from './shared/OperatorOverview';

function Monitor({ facts }: Readonly<{ facts: PrometheusMonitor }>) {
  let namespaces = facts.namespaceSelector.matchNames ?? [];
  if (facts.namespaceSelector.any) {
    namespaces = ['All Namespaces'];
  } else if (!namespaces.length) {
    namespaces = ['Same Namespace'];
  }
  return (
    <>
      <Section title="Targets">
        <Selector label="Selector" selector={facts.selector} />
        <Values label="Namespaces" values={namespaces} />
        <Fields
          fields={[
            ['Job Label', facts.jobLabel],
            ['Sample Limit', facts.sampleLimit],
            ['Target Limit', facts.targetLimit],
          ]}
        />
        <Values label="Target Labels" values={facts.targetLabels} />
        <Values label="Pod Target Labels" values={facts.podTargetLabels} />
      </Section>
      {!!facts.endpoints?.length && (
        <Section title="Scrape Endpoints">
          <div className="overview-card-list">
            {withStableListKeys(facts.endpoints, (endpoint) => JSON.stringify(endpoint)).map(
              ({ key, value }, index) => (
                <Card key={key} title={value.port || value.targetPort || `Endpoint ${index + 1}`}>
                  <Fields
                    fields={[
                      ['Port', value.port],
                      ['Port Number', value.portNumber],
                      ['Target Port', value.targetPort],
                      ['Path', value.path],
                      ['Scheme', value.scheme],
                      ['Interval', value.interval],
                      ['Timeout', value.scrapeTimeout],
                      ['Honor Labels', operatorBoolean(value.honorLabels)],
                      ['Honor Timestamps', operatorBoolean(value.honorTimestamps)],
                    ]}
                  />
                </Card>
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
}: Readonly<{ facts: PrometheusFacts; kind: string }>) {
  return (
    <>
      {!!facts.monitor && <Monitor facts={facts.monitor} />}
      {!!facts.ruleGroups?.length && <Rules groups={facts.ruleGroups} />}
      {!!facts.instance && <Instance facts={facts.instance} kind={kind} />}
    </>
  );
}
