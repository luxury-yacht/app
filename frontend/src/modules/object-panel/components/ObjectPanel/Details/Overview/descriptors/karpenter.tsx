import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import type {
  ConditionFacts,
  CustomResourceDetails,
  KarpenterFacts,
  ResourceLink,
} from '@/core/refresh/types';
import { claimProgressTracks, KarpenterProgress, poolProgressTracks } from '../KarpenterProgress';
import {
  KarpenterCapacity,
  KarpenterClaimInstance,
  KarpenterConditions,
  KarpenterDisruption,
  KarpenterFields,
  KarpenterLifecycle,
  KarpenterMap,
  KarpenterScheduling,
  KarpenterSection,
  KarpenterValues,
} from '../KarpenterSections';
import type { OverviewDescriptor } from '../schema';

const renderLink = (link?: ResourceLink) => {
  if (!link) {
    return undefined;
  }
  const ref = resourceLinkToObjectReference(link);
  return ref ? <ObjectPanelLink objectRef={ref}>{ref.name}</ObjectPanelLink> : link.display?.name;
};

interface KindOverviewProps {
  facts: KarpenterFacts;
  conditions?: ConditionFacts[];
}

// A pool reads top-down as: whether it can provision, what it provisions from, what it has
// provisioned against its limits, and how it schedules and disrupts nodes.
function PoolOverview({ facts, conditions }: Readonly<KindOverviewProps>) {
  return (
    <>
      <KarpenterProgress conditions={conditions} tracks={poolProgressTracks} />
      <KarpenterFields
        fields={[
          ['NodeClass', renderLink(facts.nodeClass)],
          ['Weight', facts.weight],
          ['Replicas', facts.replicas],
        ]}
      />
      <KarpenterCapacity facts={facts} />
      <KarpenterScheduling facts={facts} />
      <KarpenterDisruption facts={facts} />
      <KarpenterLifecycle facts={facts} />
    </>
  );
}

const claimCapacityTooltip =
  'Capacity is the instance total. Allocatable is what remains for pods after the kubelet reserves resources for the system.';

// A claim reads top-down as: where it is in its lifecycle, what it belongs to, what it became,
// and what the node offers. Conditions feed the lifecycle rows instead of a trailing chip list.
function ClaimOverview({ facts, conditions }: Readonly<KindOverviewProps>) {
  return (
    <>
      <KarpenterProgress conditions={conditions} tracks={claimProgressTracks} />
      <KarpenterFields
        fields={[
          ['NodePool', renderLink(facts.nodePool)],
          ['NodeClass', renderLink(facts.nodeClass)],
          ['Node', renderLink(facts.node)],
        ]}
      />
      <KarpenterClaimInstance facts={facts} />
      <KarpenterCapacity facts={facts} tooltip={claimCapacityTooltip} />
      <KarpenterScheduling facts={facts} />
      <KarpenterLifecycle facts={facts} />
    </>
  );
}

function ClassOverview({ facts, conditions }: Readonly<KindOverviewProps>) {
  return (
    <>
      <KarpenterFields
        fields={[
          ['Image Family', facts.imageFamily],
          ['Role', facts.role],
          ['Instance Profile', facts.instanceProfile],
        ]}
      />
      {(!!facts.subnets?.length || !!facts.securityGroups?.length) && (
        <KarpenterSection title="Networking">
          <KarpenterValues label="Subnets" values={facts.subnets} />
          <KarpenterValues label="Security Groups" values={facts.securityGroups} />
        </KarpenterSection>
      )}
      {!!facts.images?.length && (
        <KarpenterSection title="Images">
          <div className="overview-ref-list">
            {facts.images.map((image) => (
              <span key={image} className="overview-ref-item">
                {image}
              </span>
            ))}
          </div>
        </KarpenterSection>
      )}
      {!!Object.keys(facts.tags ?? {}).length && (
        <KarpenterSection title="Tags">
          <KarpenterMap label="Tags" values={facts.tags} />
        </KarpenterSection>
      )}
      <KarpenterConditions conditions={conditions} />
    </>
  );
}

function OverlayOverview({ facts, conditions }: Readonly<KindOverviewProps>) {
  return (
    <>
      <KarpenterFields
        fields={[
          ['Weight', facts.weight],
          ['Price Adjustment', facts.priceAdjustment],
        ]}
      />
      <KarpenterCapacity facts={facts} />
      <KarpenterScheduling facts={facts} />
      <KarpenterConditions conditions={conditions} />
    </>
  );
}

const kindOverviews: Record<string, typeof PoolOverview> = {
  nodepool: PoolOverview,
  provisioner: PoolOverview,
  nodeclaim: ClaimOverview,
  machine: ClaimOverview,
  nodeoverlay: OverlayOverview,
};

export const karpenterDescriptor: OverviewDescriptor<CustomResourceDetails> = {
  displayKind: 'Karpenter',
  dtoName: 'CustomResourceDetails',
  coveredElsewhere: [
    'certManager',
    'externalSecrets',
    'prometheus',
    'ref',
    'resourceFamily',
    'argoCD',
  ],
  schema: {
    items: [
      { kind: 'status' },
      {
        kind: 'widget',
        consumes: ['karpenter', 'conditions'],
        render: (data) => {
          if (!data.karpenter) {
            return null;
          }
          const KindOverview = kindOverviews[data.kind.toLowerCase()] ?? ClassOverview;
          return (
            <div className="karpenter-overview">
              <KindOverview facts={data.karpenter} conditions={data.conditions} />
            </div>
          );
        },
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
