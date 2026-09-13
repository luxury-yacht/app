import type {
  ClusterExternalSecretFacts,
  ExternalSecretFacts,
  ExternalSecretStoreFacts,
  ExternalSecretsFacts,
} from '@core/refresh/types';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import {
  OperatorCard as Card,
  OperatorFields as Fields,
  OperatorMessage as Message,
  operatorDate,
  operatorEntries,
  operatorLink,
  OperatorSection as Section,
  OperatorSelector as Selector,
  OperatorValues as Values,
} from './shared/OperatorOverview';

function SecretConfiguration({ facts }: Readonly<{ facts: ExternalSecretFacts }>) {
  return (
    <Fields
      fields={[
        ['Store', operatorLink(facts.store) ?? facts.storeName],
        ['Store Kind', facts.storeKind],
        ['Target Secret', operatorLink(facts.target) ?? facts.targetName],
        ['Refresh Policy', facts.refreshPolicy],
        ['Refresh Interval', facts.refreshInterval],
        ['Last Refresh', operatorDate(facts.refreshTime)],
        ['Creation Policy', facts.creationPolicy],
        ['Deletion Policy', facts.deletionPolicy],
      ]}
    />
  );
}

function SecretData({ facts }: Readonly<{ facts: ExternalSecretFacts }>) {
  return (
    <>
      {!!facts.data?.length && (
        <Section title="Secret Key Mappings">
          <div className="overview-card-list">
            {withStableListKeys(facts.data, (mapping) => mapping.secretKey).map(
              ({ key, value }) => (
                <Card key={key} title={value.secretKey}>
                  <Fields
                    fields={[
                      ['Remote Key', value.remoteRef.key],
                      ['Property', value.remoteRef.property],
                      ['Version', value.remoteRef.version],
                      ['Conversion', value.remoteRef.conversionStrategy],
                      ['Decoding', value.remoteRef.decodingStrategy],
                    ]}
                  />
                </Card>
              )
            )}
          </div>
        </Section>
      )}
      {!!facts.dataFrom?.length && (
        <Section title="Bulk Sources">
          <div className="overview-card-list">
            {withStableListKeys(facts.dataFrom, (source) => JSON.stringify(source)).map(
              ({ key, value }, index) => (
                <Card key={key} title={`Source ${index + 1}`}>
                  {!!value.extract && (
                    <Fields
                      fields={[
                        ['Extract Key', value.extract.key],
                        ['Property', value.extract.property],
                        ['Version', value.extract.version],
                        ['Conversion', value.extract.conversionStrategy],
                        ['Decoding', value.extract.decodingStrategy],
                      ]}
                    />
                  )}
                  {!!value.find && (
                    <>
                      <Fields
                        fields={[
                          ['Find Path', value.find.path],
                          ['Name Pattern', value.find.name?.regexp],
                        ]}
                      />
                      <Values label="Tags" values={operatorEntries(value.find.tags)} />
                    </>
                  )}
                  {!!value.sourceRef?.generatorRef && (
                    <Fields
                      fields={[
                        ['Generator', value.sourceRef.generatorRef.name],
                        ['Kind', value.sourceRef.generatorRef.kind],
                        ['API Version', value.sourceRef.generatorRef.apiVersion],
                      ]}
                    />
                  )}
                </Card>
              )
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function StoreConfiguration({ facts }: Readonly<{ facts: ExternalSecretStoreFacts }>) {
  return (
    <>
      <Section title="Store">
        <Values label="Providers" values={facts.providers} />
        <Fields
          fields={[
            ['Controller', facts.controller],
            ['Capabilities', facts.capabilities],
            [
              'Refresh Interval',
              facts.refreshInterval === undefined ? undefined : `${facts.refreshInterval}s`,
            ],
            ['Maximum Retries', facts.retrySettings?.maxRetries],
            ['Retry Interval', facts.retrySettings?.retryInterval],
          ]}
        />
      </Section>
      {!!facts.conditions?.length && (
        <Section title="Namespace Access">
          <div className="overview-card-list">
            {withStableListKeys(facts.conditions, (condition) => JSON.stringify(condition)).map(
              ({ key, value }, index) => (
                <Card key={key} title={`Condition ${index + 1}`}>
                  <Values label="Namespaces" values={value.namespaces} />
                  {!!value.namespaceSelector && (
                    <Selector label="Namespace Selector" selector={value.namespaceSelector} />
                  )}
                  <Values label="Namespace Patterns" values={value.namespaceRegexes} />
                </Card>
              )
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function ClusterSecret({ facts }: Readonly<{ facts: ClusterExternalSecretFacts }>) {
  const selectors = [...(facts.namespaceSelectors ?? [])];
  if (facts.namespaceSelector) {
    selectors.unshift(facts.namespaceSelector);
  }
  return (
    <>
      <Section title="Distribution">
        <Fields
          fields={[
            ['ExternalSecret Name', facts.externalSecretName],
            ['Refresh Interval', facts.refreshTime],
            ['Provisioned Namespaces', facts.provisionedNamespaces?.length],
            ['Failed Namespaces', facts.failedNamespaces?.length],
          ]}
        />
        <Values label="Target Namespaces" values={facts.namespaces} />
        {withStableListKeys(selectors, (selector) => JSON.stringify(selector)).map(
          ({ key, value }, index) => (
            <Selector key={key} label={`Namespace Selector ${index + 1}`} selector={value} />
          )
        )}
        <Values label="Provisioned Namespaces" values={facts.provisionedNamespaces} />
      </Section>
      {!!facts.failedNamespaces?.length && (
        <Section title="Distribution Failures">
          <div className="overview-card-list">
            {withStableListKeys(facts.failedNamespaces, (failure) => failure.namespace).map(
              ({ key, value }) => (
                <Card key={key} title={value.namespace}>
                  <Message label="Reason" text={value.reason} />
                </Card>
              )
            )}
          </div>
        </Section>
      )}
      {!!facts.template && (
        <>
          <Section title="ExternalSecret Template">
            <SecretConfiguration facts={facts.template} />
          </Section>
          <SecretData facts={facts.template} />
        </>
      )}
    </>
  );
}

export function ExternalSecretsSections({ facts }: Readonly<{ facts: ExternalSecretsFacts }>) {
  return (
    <>
      {!!facts.externalSecret && (
        <>
          <Section title="Synchronization">
            <SecretConfiguration facts={facts.externalSecret} />
          </Section>
          <SecretData facts={facts.externalSecret} />
        </>
      )}
      {!!facts.store && <StoreConfiguration facts={facts.store} />}
      {!!facts.clusterExternalSecret && <ClusterSecret facts={facts.clusterExternalSecret} />}
    </>
  );
}
