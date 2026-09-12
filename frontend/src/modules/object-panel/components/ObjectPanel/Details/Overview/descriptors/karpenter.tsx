import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type React from 'react';
import type { CustomResourceDetails, KarpenterFacts, ResourceLink } from '@/core/refresh/types';
import type { OverviewDescriptor, OverviewField } from '../schema';

const renderLink = (link?: ResourceLink): React.ReactNode => {
  if (!link) {
    return undefined;
  }
  const ref = resourceLinkToObjectReference(link);
  return ref ? <ObjectPanelLink objectRef={ref}>{ref.name}</ObjectPanelLink> : link.display?.name;
};

const mapText = (values?: Record<string, string>) =>
  values && Object.keys(values).length
    ? Object.entries(values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ')
    : undefined;

const fact = (
  label: string,
  render: (facts: KarpenterFacts) => React.ReactNode,
  fullWidth = false
): OverviewField<CustomResourceDetails> => ({
  label,
  derivedFrom: ['karpenter'],
  fullWidth,
  render: (data) => (data.karpenter ? render(data.karpenter) : undefined),
});

const scalarFields = [
  ['weight', 'Weight'],
  ['replicas', 'Replicas'],
  ['consolidationPolicy', 'Consolidation Policy'],
  ['consolidateAfter', 'Consolidate After'],
  ['expireAfter', 'Expire After'],
  ['terminationGracePeriod', 'Termination Grace Period'],
  ['instanceType', 'Instance Type'],
  ['capacityType', 'Capacity Type'],
  ['zone', 'Zone'],
  ['architecture', 'Architecture'],
  ['providerID', 'Provider ID'],
  ['imageID', 'Image ID'],
  ['role', 'Role'],
  ['instanceProfile', 'Instance Profile'],
  ['imageFamily', 'Image Family'],
  ['priceAdjustment', 'Price Adjustment'],
] as const;

export const karpenterDescriptor: OverviewDescriptor<CustomResourceDetails> = {
  displayKind: 'Karpenter',
  dtoName: 'CustomResourceDetails',
  coveredElsewhere: ['ref', 'resourceFamily'],
  schema: {
    items: [
      { kind: 'status' },
      fact('NodePool', (facts) => renderLink(facts.nodePool)),
      fact('NodeClass', (facts) => renderLink(facts.nodeClass)),
      fact('Node', (facts) => renderLink(facts.node)),
      ...scalarFields.map(([key, label]) =>
        fact(label, (facts) => (facts[key] === '' ? undefined : facts[key]))
      ),
      fact('Capacity', (facts) => mapText(facts.capacity), true),
      fact('Allocatable', (facts) => mapText(facts.allocatable), true),
      fact('Limits', (facts) => mapText(facts.limits), true),
      fact(
        'Requirements',
        (facts) =>
          facts.requirements
            ?.map(
              (r) =>
                `${r.key} ${r.operator} ${r.values?.join(', ') ?? ''}${r.minValues === undefined ? '' : ` (min values: ${r.minValues})`}`
            )
            .join('; ') || undefined,
        true
      ),
      fact(
        'Taints',
        (facts) =>
          facts.taints
            ?.map((t) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`)
            .join(', ') || undefined,
        true
      ),
      fact(
        'Startup Taints',
        (facts) =>
          facts.startupTaints
            ?.map((t) => `${t.key}${t.value ? `=${t.value}` : ''}:${t.effect}`)
            .join(', ') || undefined,
        true
      ),
      fact(
        'Disruption Budgets',
        (facts) =>
          facts.budgets
            ?.map((b) =>
              [b.nodes, b.reasons?.join(', '), b.schedule, b.duration].filter(Boolean).join(' · ')
            )
            .join('; ') || undefined,
        true
      ),
      fact('Subnets', (facts) => facts.subnets?.join(', ') || undefined, true),
      fact('Security Groups', (facts) => facts.securityGroups?.join(', ') || undefined, true),
      fact('Images', (facts) => facts.images?.join(', ') || undefined, true),
      fact('Tags', (facts) => mapText(facts.tags), true),
      {
        field: 'conditions',
        label: 'Conditions',
        fullWidth: true,
        render: (data) =>
          data.conditions?.length ? (
            <div className="overview-condition-list">
              {withStableListKeys(data.conditions, (condition) => condition.type).map(
                ({ key, value: condition }) => (
                  <div key={key}>
                    {[`${condition.type}: ${condition.status}`, condition.reason, condition.message]
                      .filter(Boolean)
                      .join(' — ')}
                  </div>
                )
              )}
            </div>
          ) : undefined,
      },
    ],
  },
};

export function getKarpenterOverviewDescriptor(
  kind: string,
  detail: unknown
): OverviewDescriptor<never> | undefined {
  const data = detail as Partial<CustomResourceDetails> | null | undefined;
  if (data?.resourceFamily !== 'karpenter' || !data.karpenter) {
    return undefined;
  }
  return { ...karpenterDescriptor, displayKind: data.kind ?? kind } as OverviewDescriptor<never>;
}
