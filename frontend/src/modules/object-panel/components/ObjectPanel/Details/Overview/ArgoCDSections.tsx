import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type { ReactNode } from 'react';
import type {
  ArgoCDApplicationFacts,
  ArgoCDApplicationSetFacts,
  ArgoCDApplicationSpec,
  ArgoCDCondition,
  ArgoCDDestination,
  ArgoCDFacts,
  ArgoCDProjectFacts,
  ArgoCDResourceRestriction,
  ArgoCDSource,
  ArgoCDSyncPolicy,
} from '@/core/refresh/types';
import { formatFullDate } from '@/utils/ageFormatter';
import { OverviewItem } from './shared/OverviewItem';
import './shared/OverviewBlocks.css';
import './ArgoCDOverview.css';

function ArgoCDSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="argocd-overview-section" aria-label={title}>
      <h3 className="metadata-label">{title}</h3>
      {children}
    </section>
  );
}

function Fields({ fields }: Readonly<{ fields: readonly (readonly [string, ReactNode])[] }>) {
  const visible = fields.filter(
    ([, value]) => value !== '' && value !== undefined && value !== null
  );
  return visible.length ? (
    <div className="argocd-fields">
      {visible.map(([label, value]) => (
        <OverviewItem key={label} label={label} value={value} />
      ))}
    </div>
  ) : null;
}

function Card({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <div className="overview-card">
      <div className="overview-card-header">
        <h4 className="overview-card-title">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function Values({ values }: Readonly<{ values: string[] }>) {
  return (
    <div className="overview-ref-list">
      {withStableListKeys(values, (value) => value).map(({ key, value }) => (
        <span key={key} className="overview-ref-item">
          {value}
        </span>
      ))}
    </div>
  );
}

function ValueGroup({ label, values }: Readonly<{ label: string; values?: string[] }>) {
  return values?.length ? (
    <section className="overview-stacked" aria-label={label}>
      <div className="argocd-overview-subtitle">{label}</div>
      <Values values={values} />
    </section>
  ) : null;
}

function Message({ label, text }: Readonly<{ label: string; text?: string }>) {
  return text ? (
    <section className="overview-stacked" aria-label={label}>
      <div className="argocd-overview-subtitle">{label}</div>
      <p className="argocd-overview-message">{text}</p>
    </section>
  ) : null;
}

const variants: Record<string, StatusChipVariant> = {
  ready: 'healthy',
  error: 'unhealthy',
  warning: 'warning',
  progressing: 'info',
  unknown: 'info',
};

function ArgoCDBadge({
  value,
  presentation,
  tooltip,
}: Readonly<{ value?: string; presentation?: string; tooltip?: string }>) {
  return value ? (
    <StatusChip variant={variants[presentation ?? 'unknown'] ?? 'info'} tooltip={tooltip}>
      {value}
    </StatusChip>
  ) : null;
}

function Conditions({ conditions }: Readonly<{ conditions?: ArgoCDCondition[] }>) {
  return conditions?.length ? (
    <OverviewItem
      label="Conditions"
      value={
        <div className="overview-condition-list">
          {withStableListKeys(conditions, (condition) => condition.type).map(({ key, value }) => (
            <ArgoCDBadge
              key={key}
              value={value.type}
              presentation={value.presentation}
              tooltip={[value.status, value.message || value.reason].filter(Boolean).join(': ')}
            />
          ))}
        </div>
      }
    />
  ) : null;
}

export function ArgoCDStatus({
  facts,
  status,
  presentation,
}: Readonly<{ facts: ArgoCDFacts; status?: string; presentation?: string }>) {
  return (
    <div className="argocd-fields">
      {(facts.applicationSet || presentation === 'terminating') && (
        <OverviewItem
          label="Status"
          value={<ArgoCDBadge value={status} presentation={presentation} />}
        />
      )}
      {!!facts.application && (
        <Fields
          fields={[
            [
              'Health',
              <ArgoCDBadge
                key="health"
                value={facts.application.health}
                presentation={facts.application.healthPresentation}
              />,
            ],
            [
              'Sync',
              <ArgoCDBadge
                key="sync"
                value={facts.application.sync}
                presentation={facts.application.syncPresentation}
              />,
            ],
          ]}
        />
      )}
      <Conditions conditions={facts.conditions} />
      <Message label="Health Message" text={facts.application?.healthMessage} />
    </div>
  );
}

const destinationName = (destination: ArgoCDDestination) =>
  destination.name || destination.resolvedName || destination.server || '';

function Destination({ destination }: Readonly<{ destination: ArgoCDDestination }>) {
  return (
    <Fields
      fields={[
        ['Cluster', destinationName(destination)],
        ['Server', destination.name ? destination.server : undefined],
        ['Namespace', destination.namespace],
      ]}
    />
  );
}

function SourceCard({ source, index }: Readonly<{ source: ArgoCDSource; index: number }>) {
  return (
    <Card title={source.name || `Source ${index + 1}`}>
      <ValueGroup label="Repository" values={source.repoURL ? [source.repoURL] : undefined} />
      <Fields
        fields={[
          ['Path', source.path],
          ['Chart', source.chart],
          ['Target Revision', source.targetRevision],
          ['Ref', source.ref],
        ]}
      />
    </Card>
  );
}

function Sources({
  spec,
  revisions,
  title = 'Sources',
}: Readonly<{ spec: ArgoCDApplicationSpec; revisions?: string[]; title?: string }>) {
  const singleSource = spec.source ? [spec.source] : [];
  const sources = spec.sources?.length ? spec.sources : singleSource;
  if (!sources.length) {
    return revisions?.length ? (
      <ArgoCDSection title="Deployed Revisions">
        <Values values={revisions} />
      </ArgoCDSection>
    ) : null;
  }
  return (
    <ArgoCDSection title={title}>
      <div className="overview-card-list">
        {withStableListKeys(
          sources,
          (source) => `${source.repoURL}:${source.path}:${source.chart}:${source.ref}`
        ).map(({ key, value }, index) => (
          <SourceCard key={key} source={value} index={index} />
        ))}
      </div>
      <ValueGroup label="Deployed Revisions" values={revisions} />
    </ArgoCDSection>
  );
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function SyncPolicy({
  policy,
  title = 'Sync Policy',
}: Readonly<{ policy?: ArgoCDSyncPolicy; title?: string }>) {
  const automated = policy?.automated;
  return (
    <ArgoCDSection title={title}>
      <Fields
        fields={[
          ['Automated Sync', automated && automated.enabled !== false ? 'Enabled' : 'Disabled'],
          ['Prune', automated ? yesNo(automated.prune) : undefined],
          ['Self Heal', automated ? yesNo(automated.selfHeal) : undefined],
          ['Allow Empty', automated ? yesNo(automated.allowEmpty) : undefined],
        ]}
      />
      <ValueGroup label="Sync Options" values={policy?.syncOptions} />
    </ArgoCDSection>
  );
}

function LastOperation({
  operation,
}: Readonly<{ operation: ArgoCDApplicationFacts['operation'] }>) {
  return operation ? (
    <ArgoCDSection title="Last Operation">
      <Fields
        fields={[
          ['Phase', operation.phase],
          ['Started', operation.startedAt ? formatFullDate(operation.startedAt) : undefined],
          ['Finished', operation.finishedAt ? formatFullDate(operation.finishedAt) : undefined],
        ]}
      />
      <Message label="Message" text={operation.message} />
    </ArgoCDSection>
  ) : null;
}

export function ArgoCDApplication({ facts }: Readonly<{ facts: ArgoCDApplicationFacts }>) {
  const owner = resourceLinkToObjectReference(facts.applicationSet);
  return (
    <>
      <Fields
        fields={[
          ['Project', facts.spec.project],
          [
            'ApplicationSet',
            owner ? (
              <ObjectPanelLink key="applicationSet" objectRef={owner}>
                {owner.name}
              </ObjectPanelLink>
            ) : undefined,
          ],
          ['Managed Resources', facts.resourceCount],
        ]}
      />
      {!!(destinationName(facts.spec.destination) || facts.spec.destination.namespace) && (
        <ArgoCDSection title="Destination">
          <Destination destination={facts.spec.destination} />
        </ArgoCDSection>
      )}
      <Sources spec={facts.spec} revisions={facts.revisions} />
      <SyncPolicy policy={facts.spec.syncPolicy} />
      <LastOperation operation={facts.operation} />
    </>
  );
}

function Generators({
  generators,
}: Readonly<{ generators: ArgoCDApplicationSetFacts['generators'] }>) {
  return generators?.length ? (
    <ArgoCDSection title="Generators">
      <div className="overview-card-list">
        {withStableListKeys(
          generators,
          (generator) => `${generator.type}:${generator.repoURL}`
        ).map(({ key, value }) => (
          <Card key={key} title={value.type}>
            <ValueGroup label="Repository" values={value.repoURL ? [value.repoURL] : undefined} />
            <Fields fields={[['Revision', value.revision]]} />
          </Card>
        ))}
      </div>
    </ArgoCDSection>
  ) : null;
}

function ApplicationTemplate({ facts }: Readonly<{ facts: ArgoCDApplicationSetFacts }>) {
  const hasDestination = Boolean(
    destinationName(facts.template.destination) || facts.template.destination.namespace
  );
  if (
    !facts.templateName &&
    !facts.template.project &&
    facts.goTemplate === undefined &&
    !hasDestination
  ) {
    return null;
  }
  return (
    <ArgoCDSection title="Application Template">
      <Fields
        fields={[
          ['Name', facts.templateName],
          ['Project', facts.template.project],
          ['Go Template', facts.goTemplate === undefined ? undefined : yesNo(facts.goTemplate)],
        ]}
      />
      {hasDestination && (
        <section className="overview-stacked" aria-label="Destination">
          <div className="argocd-overview-subtitle">Destination</div>
          <Destination destination={facts.template.destination} />
        </section>
      )}
    </ArgoCDSection>
  );
}

export function ArgoCDApplicationSet({ facts }: Readonly<{ facts: ArgoCDApplicationSetFacts }>) {
  return (
    <>
      <Generators generators={facts.generators} />
      <ApplicationTemplate facts={facts} />
      <Sources spec={facts.template} title="Template Sources" />
      <SyncPolicy policy={facts.template.syncPolicy} title="Template Sync Policy" />
      <ArgoCDSection title="Application Management">
        <Fields
          fields={[
            ['Applications Sync', facts.applicationsSync || 'sync'],
            ['Preserve on Delete', yesNo(facts.preserveResourcesOnDeletion ?? false)],
            ['Strategy', facts.strategy || 'AllAtOnce'],
          ]}
        />
      </ArgoCDSection>
    </>
  );
}

function ResourcePolicy({
  title,
  allowed,
  denied,
}: Readonly<{
  title: string;
  allowed?: ArgoCDResourceRestriction[];
  denied?: ArgoCDResourceRestriction[];
}>) {
  if (!allowed?.length && !denied?.length) {
    return null;
  }
  const values = (resources?: ArgoCDResourceRestriction[]) =>
    resources?.map((resource) => {
      const name = resource.name ? ` (${resource.name})` : '';
      return `${resource.group || 'core'}/${resource.kind}${name}`;
    });
  return (
    <Card title={title}>
      <ValueGroup label="Allowed" values={values(allowed)} />
      <ValueGroup label="Denied" values={values(denied)} />
    </Card>
  );
}

function ProjectResourcePolicy({ facts }: Readonly<{ facts: ArgoCDProjectFacts }>) {
  if (
    ![
      facts.clusterResourceWhitelist,
      facts.clusterResourceBlacklist,
      facts.namespaceResourceWhitelist,
      facts.namespaceResourceBlacklist,
    ].some((resources) => resources?.length)
  ) {
    return null;
  }
  return (
    <ArgoCDSection title="Resource Permissions">
      <div className="overview-card-list">
        <ResourcePolicy
          title="Cluster Resources"
          allowed={facts.clusterResourceWhitelist}
          denied={facts.clusterResourceBlacklist}
        />
        <ResourcePolicy
          title="Namespaced Resources"
          allowed={facts.namespaceResourceWhitelist}
          denied={facts.namespaceResourceBlacklist}
        />
      </div>
    </ArgoCDSection>
  );
}

function ProjectDestinations({
  destinations,
}: Readonly<{ destinations: ArgoCDProjectFacts['destinations'] }>) {
  return destinations?.length ? (
    <ArgoCDSection title="Destinations">
      <div className="overview-card-list">
        {withStableListKeys(
          destinations,
          (destination) => `${destination.name}:${destination.server}:${destination.namespace}`
        ).map(({ key, value }) => (
          <Card key={key} title={destinationName(value) || 'Destination'}>
            <Fields
              fields={[
                ['Namespace', value.namespace],
                ['Server', value.name ? value.server : undefined],
              ]}
            />
          </Card>
        ))}
      </div>
    </ArgoCDSection>
  ) : null;
}

function ProjectRoles({ roles }: Readonly<{ roles: ArgoCDProjectFacts['roles'] }>) {
  return roles?.length ? (
    <ArgoCDSection title="Roles">
      <div className="overview-card-list">
        {withStableListKeys(roles, (role) => role.name).map(({ key, value }) => (
          <Card key={key} title={value.name}>
            {!!value.description && <p className="argocd-overview-message">{value.description}</p>}
            <ValueGroup label="Groups" values={value.groups} />
            <ValueGroup label="Policies" values={value.policies} />
          </Card>
        ))}
      </div>
    </ArgoCDSection>
  ) : null;
}

function ProjectSyncWindows({ windows }: Readonly<{ windows: ArgoCDProjectFacts['syncWindows'] }>) {
  return windows?.length ? (
    <ArgoCDSection title="Sync Windows">
      <div className="overview-card-list">
        {withStableListKeys(
          windows,
          (window) => `${window.kind}:${window.schedule}:${window.duration}`
        ).map(({ key, value }) => (
          <Card key={key} title={value.kind || 'Sync Window'}>
            <Fields
              fields={[
                ['Schedule', value.schedule],
                ['Duration', value.duration],
                ['Time Zone', value.timeZone],
                ['Manual Sync', yesNo(value.manualSync)],
                ['Selector Match', value.andOperator ? 'All' : 'Any'],
              ]}
            />
            <ValueGroup label="Applications" values={value.applications} />
            <ValueGroup label="Namespaces" values={value.namespaces} />
            <ValueGroup label="Clusters" values={value.clusters} />
          </Card>
        ))}
      </div>
    </ArgoCDSection>
  ) : null;
}

export function ArgoCDProject({ facts }: Readonly<{ facts: ArgoCDProjectFacts }>) {
  return (
    <>
      <Message label="Description" text={facts.description} />
      {!!(facts.sourceRepos?.length || facts.sourceNamespaces?.length) && (
        <ArgoCDSection title="Source Access">
          <ValueGroup label="Repositories" values={facts.sourceRepos} />
          <ValueGroup label="Source Namespaces" values={facts.sourceNamespaces} />
        </ArgoCDSection>
      )}
      <ProjectDestinations destinations={facts.destinations} />
      <ProjectResourcePolicy facts={facts} />
      <ProjectRoles roles={facts.roles} />
      <ProjectSyncWindows windows={facts.syncWindows} />
    </>
  );
}
