import type { CertManagerCertificate, CertManagerFacts } from '@core/refresh/types';
import {
  OperatorFields as Fields,
  OperatorMessage as Message,
  operatorBoolean,
  operatorDate,
  operatorLink,
  OperatorSection as Section,
  OperatorValues as Values,
} from './shared/OperatorOverview';

function CertificateValidity({ facts }: Readonly<{ facts: CertManagerCertificate }>) {
  if (!facts.notBefore && !facts.notAfter && !facts.renewalTime && facts.revision === undefined) {
    return null;
  }
  return (
    <Section title="Validity">
      <Fields
        fields={[
          ['Valid From', operatorDate(facts.notBefore)],
          ['Expires', operatorDate(facts.notAfter)],
          ['Renewal Time', operatorDate(facts.renewalTime)],
          ['Revision', facts.revision],
        ]}
      />
    </Section>
  );
}

export function CertManagerSections({ facts }: Readonly<{ facts: CertManagerFacts }>) {
  const certificate = facts.certificate;
  const request = facts.request;
  const authority = facts.authority;
  const order = facts.order;
  const challenge = facts.challenge;
  return (
    <>
      <Fields
        fields={[
          ['Issuer', operatorLink(facts.issuer)],
          ['Secret', operatorLink(facts.secret)],
          ...(facts.owners ?? []).map(
            (link) => [link.ref?.kind ?? 'Owner', operatorLink(link)] as const
          ),
        ]}
      />
      {!!certificate && (
        <>
          <CertificateValidity facts={certificate} />
          <Section title="Certificate">
            <Fields
              fields={[
                ['Common Name', certificate.commonName],
                ['Duration', certificate.duration],
                ['Renew Before', certificate.renewBefore],
                ['Certificate Authority', operatorBoolean(certificate.isCA)],
              ]}
            />
            <Values label="DNS Names" values={certificate.dnsNames} />
            <Values label="IP Addresses" values={certificate.ipAddresses} />
            <Values label="URIs" values={certificate.uris} />
            <Values label="Email Addresses" values={certificate.emailAddresses} />
            <Values label="Usages" values={certificate.usages} />
          </Section>
          {!!certificate.privateKey && (
            <Section title="Private Key Configuration">
              <Fields
                fields={[
                  ['Algorithm', certificate.privateKey.algorithm],
                  ['Size', certificate.privateKey.size],
                  ['Encoding', certificate.privateKey.encoding],
                  ['Rotation Policy', certificate.privateKey.rotationPolicy],
                ]}
              />
            </Section>
          )}
        </>
      )}
      {!!request && (
        <Section title="Request">
          <Fields
            fields={[
              ['Duration', request.duration],
              ['Certificate Authority', operatorBoolean(request.isCA)],
              ['Failure Time', operatorDate(request.failureTime)],
            ]}
          />
          <Values label="Usages" values={request.usages} />
        </Section>
      )}
      {!!authority && (
        <Section title="Issuer Configuration">
          <Fields
            fields={[
              ['Type', authority.type],
              ['Server', authority.server],
              ['Email', authority.email],
              ['Path', authority.path],
            ]}
          />
          <Values label="ACME Solvers" values={authority.solvers} />
        </Section>
      )}
      {!!order && (
        <Section title="Order">
          <Fields
            fields={[
              ['State', order.state],
              ['Duration', order.duration],
              ['URL', order.url],
              ['Failure Time', operatorDate(order.failureTime)],
            ]}
          />
          <Values label="DNS Names" values={order.dnsNames} />
          <Message label="Reason" text={order.reason} />
        </Section>
      )}
      {!!challenge && (
        <Section title="Challenge">
          <Fields
            fields={[
              ['DNS Name', challenge.dnsName],
              ['Type', challenge.type],
              ['Wildcard', operatorBoolean(challenge.wildcard)],
              ['State', challenge.state],
              ['Presented', operatorBoolean(challenge.presented)],
              ['Processing', operatorBoolean(challenge.processing)],
            ]}
          />
          <Message label="Reason" text={challenge.reason} />
        </Section>
      )}
    </>
  );
}
