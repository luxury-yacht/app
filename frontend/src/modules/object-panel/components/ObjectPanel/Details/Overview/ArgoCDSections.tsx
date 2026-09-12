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
  ArgoCDProjectFacts,
  ArgoCDResourceRestriction,
  ArgoCDSyncPolicy,
} from '@/core/refresh/types';
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
  return (
    <>
      {fields.map(([label, value]) => (
        <OverviewItem key={label} label={label} value={value === '' ? undefined : value} />
      ))}
    </>
  );
}
function Values({ values }: Readonly<{ values?: string[] }>) {
  if (!values?.length) {
    return null;
  }
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
const variants: Record<string, StatusChipVariant> = {
  ready: 'healthy',
  error: 'unhealthy',
  warning: 'warning',
  progressing: 'info',
  unknown: 'info',
};
export function ArgoCDBadge({
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
export function ArgoCDConditions({ conditions }: Readonly<{ conditions?: ArgoCDCondition[] }>) {
  if (!conditions?.length) {
    return null;
  }
  return (
    <ArgoCDSection title="Conditions">
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
    </ArgoCDSection>
  );
}
function Destination({ destination }: Readonly<{ destination: ArgoCDDestination }>) {
  return (
    <Fields
      fields={[
        ['Cluster', destination.name || destination.resolvedName || destination.server],
        ['Server', destination.name ? destination.server : undefined],
        ['Namespace', destination.namespace],
      ]}
    />
  );
}
function Sources({ spec }: Readonly<{ spec: ArgoCDApplicationSpec }>) {
  const sources = spec.sources?.length ? spec.sources : spec.source ? [spec.source] : [];
  if (!sources.length) {
    return null;
  }
  return (
    <ArgoCDSection title="Sources">
      <div className="overview-card-list">
        {withStableListKeys(
          sources,
          (source) => `${source.repoURL}:${source.path}:${source.chart}:${source.ref}`
        ).map(({ key, value }) => (
          <div className="overview-card" key={key}>
            <Fields
              fields={[
                ['Repository', value.repoURL],
                ['Path', value.path],
                ['Chart', value.chart],
                ['Revision', value.targetRevision],
                ['Ref', value.ref],
                ['Name', value.name],
              ]}
            />
          </div>
        ))}
      </div>
    </ArgoCDSection>
  );
}
const yesNo = (value: boolean) => (value ? 'Yes' : 'No');
function SyncPolicy({ policy }: Readonly<{ policy?: ArgoCDSyncPolicy }>) {
  const automated = policy?.automated;
  return (
    <ArgoCDSection title="Sync Policy">
      <Fields
        fields={[
          ['Automated', automated && automated.enabled !== false ? 'Enabled' : 'Disabled'],
          ['Prune', automated ? yesNo(automated.prune) : undefined],
          ['Self Heal', automated ? yesNo(automated.selfHeal) : undefined],
          ['Allow Empty', automated ? yesNo(automated.allowEmpty) : undefined],
        ]}
      />
      <Values values={policy?.syncOptions} />
    </ArgoCDSection>
  );
}
function ApplicationConfiguration({ spec }: Readonly<{ spec: ArgoCDApplicationSpec }>) {
  return (
    <>
      <Fields fields={[['Project', spec.project]]} />
      {!!(spec.destination.name || spec.destination.server || spec.destination.namespace) && (
        <ArgoCDSection title="Destination">
          <Destination destination={spec.destination} />
        </ArgoCDSection>
      )}
      <Sources spec={spec} />
      <SyncPolicy policy={spec.syncPolicy} />
    </>
  );
}
export function ArgoCDApplication({ facts }: Readonly<{ facts: ArgoCDApplicationFacts }>) {
  const owner = resourceLinkToObjectReference(facts.applicationSet);
  return (
    <>
      <Fields
        fields={[
          [
            'Sync',
            <ArgoCDBadge key="sync" value={facts.sync} presentation={facts.syncPresentation} />,
          ],
          [
            'Health',
            <ArgoCDBadge
              key="health"
              value={facts.health}
              presentation={facts.healthPresentation}
              tooltip={facts.healthMessage}
            />,
          ],
          ['Resources', facts.resourceCount],
          [
            'ApplicationSet',
            owner ? (
              <ObjectPanelLink key="applicationSet" objectRef={owner}>
                {owner.name}
              </ObjectPanelLink>
            ) : undefined,
          ],
        ]}
      />
      <ApplicationConfiguration spec={facts.spec} />
      {!!facts.revisions?.length && (
        <ArgoCDSection title="Deployed Revisions">
          <Values values={facts.revisions} />
        </ArgoCDSection>
      )}
      {!!facts.operation && (
        <ArgoCDSection title="Last Operation">
          <Fields
            fields={[
              ['Phase', facts.operation.phase],
              ['Message', facts.operation.message],
              ['Started', facts.operation.startedAt],
              ['Finished', facts.operation.finishedAt],
            ]}
          />
        </ArgoCDSection>
      )}
    </>
  );
}
export function ArgoCDApplicationSet({ facts }: Readonly<{ facts: ArgoCDApplicationSetFacts }>) {
  return (
    <>
      <Fields
        fields={[
          ['Template Name', facts.templateName],
          ['Go Template', facts.goTemplate === undefined ? undefined : yesNo(facts.goTemplate)],
        ]}
      />
      {!!facts.generators?.length && (
        <ArgoCDSection title="Generators">
          <div className="overview-card-list">
            {withStableListKeys(
              facts.generators,
              (generator) => `${generator.type}:${generator.repoURL}`
            ).map(({ key, value }) => (
              <div key={key} className="overview-card">
                <Fields
                  fields={[
                    ['Type', value.type],
                    ['Repository', value.repoURL],
                    ['Revision', value.revision],
                  ]}
                />
              </div>
            ))}
          </div>
        </ArgoCDSection>
      )}
      <ArgoCDSection title="Application Template">
        <ApplicationConfiguration spec={facts.template} />
      </ArgoCDSection>
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
  label,
  resources,
}: Readonly<{ label: string; resources?: ArgoCDResourceRestriction[] }>) {
  if (!resources?.length) {
    return null;
  }
  return (
    <div className="overview-stacked">
      <div className="overview-card-title">{label}</div>
      <Values
        values={resources.map(
          (resource) =>
            `${resource.group || 'core'}/${resource.kind}${resource.name ? ` (${resource.name})` : ''}`
        )}
      />
    </div>
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
      <ResourcePolicy
        label="Allowed Cluster Resources"
        resources={facts.clusterResourceWhitelist}
      />
      <ResourcePolicy label="Denied Cluster Resources" resources={facts.clusterResourceBlacklist} />
      <ResourcePolicy
        label="Allowed Namespace Resources"
        resources={facts.namespaceResourceWhitelist}
      />
      <ResourcePolicy
        label="Denied Namespace Resources"
        resources={facts.namespaceResourceBlacklist}
      />
    </ArgoCDSection>
  );
}
export function ArgoCDProject({ facts }: Readonly<{ facts: ArgoCDProjectFacts }>) {
  return (
    <>
      <Fields fields={[['Description', facts.description]]} />
      {!!facts.sourceRepos?.length && (
        <ArgoCDSection title="Source Repositories">
          <Values values={facts.sourceRepos} />
        </ArgoCDSection>
      )}
      {!!facts.sourceNamespaces?.length && (
        <ArgoCDSection title="Source Namespaces">
          <Values values={facts.sourceNamespaces} />
        </ArgoCDSection>
      )}
      {!!facts.destinations?.length && (
        <ArgoCDSection title="Destinations">
          <div className="overview-card-list">
            {withStableListKeys(
              facts.destinations,
              (destination) => `${destination.name}:${destination.server}:${destination.namespace}`
            ).map(({ key, value }) => (
              <div className="overview-card" key={key}>
                <Destination destination={value} />
              </div>
            ))}
          </div>
        </ArgoCDSection>
      )}
      <ProjectResourcePolicy facts={facts} />
      {!!facts.roles?.length && (
        <ArgoCDSection title="Roles">
          <div className="overview-card-list">
            {withStableListKeys(facts.roles, (role) => role.name).map(({ key, value }) => (
              <div className="overview-card" key={key}>
                <Fields
                  fields={[
                    ['Name', value.name],
                    ['Description', value.description],
                  ]}
                />
                <OverviewItem
                  label="Groups"
                  value={value.groups?.length ? <Values values={value.groups} /> : undefined}
                />
                <Values values={value.policies} />
              </div>
            ))}
          </div>
        </ArgoCDSection>
      )}
      {!!facts.syncWindows?.length && (
        <ArgoCDSection title="Sync Windows">
          <div className="overview-card-list">
            {withStableListKeys(
              facts.syncWindows,
              (window) => `${window.kind}:${window.schedule}:${window.duration}`
            ).map(({ key, value }) => (
              <div className="overview-card" key={key}>
                <Fields
                  fields={[
                    ['Kind', value.kind],
                    ['Schedule', value.schedule],
                    ['Duration', value.duration],
                    ['Time Zone', value.timeZone],
                    ['Manual Sync', yesNo(value.manualSync)],
                    ['Match All Selectors', yesNo(value.andOperator)],
                  ]}
                />
                <OverviewItem
                  label="Applications"
                  value={
                    value.applications?.length ? <Values values={value.applications} /> : undefined
                  }
                />
                <OverviewItem
                  label="Namespaces"
                  value={
                    value.namespaces?.length ? <Values values={value.namespaces} /> : undefined
                  }
                />
                <OverviewItem
                  label="Clusters"
                  value={value.clusters?.length ? <Values values={value.clusters} /> : undefined}
                />
              </div>
            ))}
          </div>
        </ArgoCDSection>
      )}
    </>
  );
}
