import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type { ReactNode } from 'react';
import type {
  ArgoCDApplicationFacts,
  ArgoCDApplicationSetFacts,
  ArgoCDApplicationSpec,
  ArgoCDAutomatedSync,
  ArgoCDCondition,
  ArgoCDDestination,
  ArgoCDFacts,
  ArgoCDGenerator,
  ArgoCDOperation,
  ArgoCDProjectFacts,
  ArgoCDProjectRole,
  ArgoCDResourceRestriction,
  ArgoCDSource,
  ArgoCDSyncPolicy,
  ArgoCDSyncWindow,
} from '@/core/refresh/types';
import { formatFullDate } from '@/utils/ageFormatter';
import {
  OperatorCard as Card,
  OperatorFields as Fields,
  OperatorList as List,
  OperatorMessage as Message,
  OperatorSection as Section,
} from './shared/OperatorOverview';

const variants: Record<string, StatusChipVariant> = {
  ready: 'healthy',
  error: 'unhealthy',
  warning: 'warning',
  progressing: 'info',
  unknown: 'info',
};

function Badge({
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

// A status chip with its explanation in place, so a degraded health or a failed sync reads
// without hovering: chip and short detail on one line, the controller's message beneath.
function StatusNote({
  value,
  presentation,
  detail,
  note,
}: Readonly<{ value: string; presentation?: string; detail?: string; note?: string }>) {
  return (
    <div className="operator-status">
      <div className="operator-status-line">
        <Badge value={value} presentation={presentation} />
        {!!detail && <span className="operator-status-detail">{detail}</span>}
      </div>
      {!!note && <p className="operator-note">{note}</p>}
    </div>
  );
}

const listOrNothing = (values?: string[]) =>
  values?.length ? <List values={values} /> : undefined;

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function conditionChips(conditions?: ArgoCDCondition[]) {
  return conditions?.length ? (
    <div className="overview-condition-list">
      {withStableListKeys(conditions, (condition) => condition.type).map(({ key, value }) => (
        <Badge
          key={key}
          value={value.type}
          presentation={value.presentation}
          tooltip={[value.status, value.message || value.reason].filter(Boolean).join(': ')}
        />
      ))}
    </div>
  ) : undefined;
}

const operationDetail = (operation: ArgoCDOperation): string =>
  [
    operation.startedAt ? `started ${formatFullDate(operation.startedAt)}` : '',
    operation.finishedAt ? `finished ${formatFullDate(operation.finishedAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

function lastSync(operation?: ArgoCDOperation) {
  return operation?.phase ? (
    <StatusNote
      value={operation.phase}
      presentation={operation.phasePresentation}
      detail={operationDetail(operation)}
      note={operation.message}
    />
  ) : undefined;
}

export function ArgoCDStatus({
  facts,
  status,
  presentation,
}: Readonly<{ facts: ArgoCDFacts; status?: string; presentation?: string }>) {
  const application = facts.application;
  return (
    <Fields
      fields={[
        [
          'Status',
          facts.applicationSet || presentation === 'terminating' ? (
            <Badge key="status" value={status} presentation={presentation} />
          ) : undefined,
        ],
        [
          'Health',
          application?.health ? (
            <StatusNote
              key="health"
              value={application.health}
              presentation={application.healthPresentation}
              note={application.healthMessage}
            />
          ) : undefined,
        ],
        [
          'Sync',
          application?.sync ? (
            <Badge
              key="sync"
              value={application.sync}
              presentation={application.syncPresentation}
            />
          ) : undefined,
        ],
        ['Last Sync', lastSync(application?.operation)],
        ['Conditions', conditionChips(facts.conditions)],
      ]}
    />
  );
}

// Destination names and servers are Argo CD targets, not Luxury Yacht clusters: plain text, with
// the server kept beside a resolved name so the target stays unambiguous.
function destinationValue(destination: ArgoCDDestination): ReactNode | undefined {
  const name = destination.name || destination.resolvedName;
  if (!name) {
    return destination.server ? (
      <span className="overview-value-mono">{destination.server}</span>
    ) : undefined;
  }
  return (
    <span className="operator-inline">
      <span>{name}</span>
      {!!destination.server && (
        <span className="overview-value-mono operator-secondary">{destination.server}</span>
      )}
    </span>
  );
}

const repoLeaf = (repoURL?: string): string => {
  const url = repoURL ?? '';
  let end = url.length;
  // Scan from the end to avoid regex backtracking on long slash runs.
  while (end > 0 && url[end - 1] === '/') {
    end--;
  }
  const trimmed = url.slice(0, end).replace(/\.git$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
};

// A source is known by its name, else its chart, else the repository's last path segment.
const sourceTitle = (source: ArgoCDSource, index: number): string =>
  source.name || source.chart || repoLeaf(source.repoURL) || `Source ${index + 1}`;

function SourceCard({ source, index }: Readonly<{ source: ArgoCDSource; index: number }>) {
  return (
    <Card
      title={sourceTitle(source, index)}
      meta={source.path || undefined}
      tag={source.targetRevision || undefined}
    >
      <Fields
        fields={[
          [
            'Repository',
            source.repoURL ? (
              <span key="repository" className="overview-value-mono">
                {source.repoURL}
              </span>
            ) : undefined,
          ],
          ['Chart', source.name ? source.chart : undefined],
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
      <Section title="Deployed Revisions">
        <List values={revisions} />
      </Section>
    ) : null;
  }
  return (
    <Section title={title}>
      <div className="overview-card-list">
        {withStableListKeys(
          sources,
          (source) => `${source.repoURL}:${source.path}:${source.chart}:${source.ref}`
        ).map(({ key, value }, index) => (
          <SourceCard key={key} source={value} index={index} />
        ))}
      </div>
      {/* Revisions stay a separate list: the facts do not say which source each one belongs to. */}
      <Fields fields={[['Deployed Revisions', listOrNothing(revisions)]]} />
    </Section>
  );
}

const automationSummary = (automated?: ArgoCDAutomatedSync): string => {
  if (!automated || automated.enabled === false) {
    return 'Disabled';
  }
  const flags = [
    automated.prune ? 'prune' : '',
    automated.selfHeal ? 'self heal' : '',
    automated.allowEmpty ? 'allow empty' : '',
  ].filter(Boolean);
  return ['Enabled', ...flags].join(' · ');
};

function SyncPolicy({
  policy,
  title = 'Sync Policy',
  always = false,
}: Readonly<{ policy?: ArgoCDSyncPolicy; title?: string; always?: boolean }>) {
  if (!policy && !always) {
    return null;
  }
  return (
    <Section title={title}>
      <Fields
        fields={[
          ['Automated Sync', automationSummary(policy?.automated)],
          ['Sync Options', listOrNothing(policy?.syncOptions)],
        ]}
      />
    </Section>
  );
}

export function ArgoCDApplication({ facts }: Readonly<{ facts: ArgoCDApplicationFacts }>) {
  const owner = resourceLinkToObjectReference(facts.applicationSet);
  return (
    <>
      <Fields
        fields={[
          ['Project', facts.spec.project],
          ['Destination', destinationValue(facts.spec.destination)],
          ['Namespace', facts.spec.destination.namespace],
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
      <Sources spec={facts.spec} revisions={facts.revisions} />
      <SyncPolicy policy={facts.spec.syncPolicy} always />
    </>
  );
}

function Generators({ generators }: Readonly<{ generators?: ArgoCDGenerator[] }>) {
  return generators?.length ? (
    <Section title="Generators">
      <div className="overview-card-list">
        {withStableListKeys(
          generators,
          (generator) => `${generator.type}:${generator.repoURL}`
        ).map(({ key, value }) => (
          <Card
            key={key}
            title={value.type}
            meta={value.repoURL || undefined}
            tag={value.revision || undefined}
          />
        ))}
      </div>
    </Section>
  ) : null;
}

export function ArgoCDApplicationSet({ facts }: Readonly<{ facts: ArgoCDApplicationSetFacts }>) {
  return (
    <>
      <Fields
        fields={[
          ['Template', facts.templateName],
          ['Project', facts.template.project],
          ['Destination', destinationValue(facts.template.destination)],
          ['Namespace', facts.template.destination.namespace],
          ['Go Template', facts.goTemplate === undefined ? undefined : yesNo(facts.goTemplate)],
        ]}
      />
      <Generators generators={facts.generators} />
      <Sources spec={facts.template} title="Template Sources" />
      <SyncPolicy policy={facts.template.syncPolicy} title="Template Sync Policy" />
      <Section title="Application Management">
        <Fields
          fields={[
            ['Applications Sync', facts.applicationsSync || 'sync'],
            ['Preserve on Delete', yesNo(facts.preserveResourcesOnDeletion ?? false)],
            ['Strategy', facts.strategy || 'AllAtOnce'],
          ]}
        />
      </Section>
    </>
  );
}

const restrictionValues = (resources?: ArgoCDResourceRestriction[]) =>
  resources?.map((resource) => {
    const name = resource.name ? ` (${resource.name})` : '';
    return `${resource.group || 'core'}/${resource.kind}${name}`;
  });

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
  return (
    <Card title={title}>
      <Fields
        fields={[
          ['Allowed', listOrNothing(restrictionValues(allowed))],
          ['Denied', listOrNothing(restrictionValues(denied))],
        ]}
      />
    </Card>
  );
}

function ProjectResourcePolicy({ facts }: Readonly<{ facts: ArgoCDProjectFacts }>) {
  const lists = [
    facts.clusterResourceWhitelist,
    facts.clusterResourceBlacklist,
    facts.namespaceResourceWhitelist,
    facts.namespaceResourceBlacklist,
  ];
  if (!lists.some((resources) => resources?.length)) {
    return null;
  }
  return (
    <Section title="Resource Permissions">
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
    </Section>
  );
}

function ProjectDestinations({ destinations }: Readonly<{ destinations?: ArgoCDDestination[] }>) {
  return destinations?.length ? (
    <Section title="Destinations">
      <div className="overview-card-list">
        {withStableListKeys(
          destinations,
          (destination) => `${destination.name}:${destination.server}:${destination.namespace}`
        ).map(({ key, value }) => (
          <Card
            key={key}
            title={value.name || value.resolvedName || value.server || 'Destination'}
            meta={value.namespace || undefined}
            tag={value.name || value.resolvedName ? value.server || undefined : undefined}
          />
        ))}
      </div>
    </Section>
  ) : null;
}

function ProjectRoles({ roles }: Readonly<{ roles?: ArgoCDProjectRole[] }>) {
  return roles?.length ? (
    <Section title="Roles">
      <div className="overview-card-list">
        {withStableListKeys(roles, (role) => role.name).map(({ key, value }) => (
          <Card key={key} title={value.name}>
            {!!value.description && <p className="operator-message">{value.description}</p>}
            <Fields
              fields={[
                ['Groups', listOrNothing(value.groups)],
                ['Policies', listOrNothing(value.policies)],
              ]}
            />
          </Card>
        ))}
      </div>
    </Section>
  ) : null;
}

function ProjectSyncWindows({ windows }: Readonly<{ windows?: ArgoCDSyncWindow[] }>) {
  return windows?.length ? (
    <Section title="Sync Windows">
      <div className="overview-card-list">
        {withStableListKeys(
          windows,
          (window) => `${window.kind}:${window.schedule}:${window.duration}`
        ).map(({ key, value }) => (
          <Card
            key={key}
            title={value.kind || 'Sync Window'}
            meta={[value.schedule, value.duration].filter(Boolean).join(' · ') || undefined}
            tag={value.timeZone || undefined}
          >
            <Fields
              fields={[
                ['Manual Sync', yesNo(value.manualSync)],
                ['Selector Match', value.andOperator ? 'All' : 'Any'],
                ['Applications', listOrNothing(value.applications)],
                ['Namespaces', listOrNothing(value.namespaces)],
                ['Clusters', listOrNothing(value.clusters)],
              ]}
            />
          </Card>
        ))}
      </div>
    </Section>
  ) : null;
}

export function ArgoCDProject({ facts }: Readonly<{ facts: ArgoCDProjectFacts }>) {
  return (
    <>
      <Message label="Description" text={facts.description} />
      {!!(facts.sourceRepos?.length || facts.sourceNamespaces?.length) && (
        <Section title="Source Access">
          <Fields
            fields={[
              ['Repositories', listOrNothing(facts.sourceRepos)],
              ['Source Namespaces', listOrNothing(facts.sourceNamespaces)],
            ]}
          />
        </Section>
      )}
      <ProjectDestinations destinations={facts.destinations} />
      <ProjectResourcePolicy facts={facts} />
      <ProjectRoles roles={facts.roles} />
      <ProjectSyncWindows windows={facts.syncWindows} />
    </>
  );
}
