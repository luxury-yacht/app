import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { resourceLinkToObjectReference } from '@shared/utils/resourceLinkIdentity';
import type { CustomResourceDetails, KarpenterFacts, ResourceLink } from '@/core/refresh/types';
import {
  KarpenterCapacity,
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

function PoolOverview({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  return (
    <>
      <KarpenterFields
        fields={[
          ['NodeClass', renderLink(facts.nodeClass)],
          ['Weight', facts.weight],
          ['Replicas', facts.replicas],
        ]}
      />
      <KarpenterCapacity facts={facts} showUsagePercentage />
      <KarpenterScheduling facts={facts} />
      <KarpenterDisruption facts={facts} />
      <KarpenterLifecycle facts={facts} />
    </>
  );
}

function ClaimOverview({ facts }: Readonly<{ facts: KarpenterFacts }>) {
  return (
    <>
      <KarpenterFields
        fields={[
          ['NodePool', renderLink(facts.nodePool)],
          ['Node', renderLink(facts.node)],
          ['NodeClass', renderLink(facts.nodeClass)],
          ['Instance Type', facts.instanceType],
          ['Capacity Type', facts.capacityType],
          ['Zone', facts.zone],
          ['Architecture', facts.architecture],
        ]}
      />
      <KarpenterCapacity
        facts={facts}
        tooltip={
          'Some resource capacity may be reserved for the system. In this case, the value will read "n of n" to show how much of that resource is available for pods.'
        }
      />
      <KarpenterScheduling facts={facts} />
      <KarpenterLifecycle facts={facts} />
      {!!(facts.providerID || facts.imageID) && (
        <KarpenterSection title="Provider">
          <KarpenterFields
            fields={[
              ['Provider ID', facts.providerID],
              ['Image ID', facts.imageID],
            ]}
          />
        </KarpenterSection>
      )}
    </>
  );
}

function ClassOverview({ facts }: Readonly<{ facts: KarpenterFacts }>) {
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
    </>
  );
}

function OverlayOverview({ facts }: Readonly<{ facts: KarpenterFacts }>) {
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
  coveredElsewhere: ['ref', 'resourceFamily', 'argoCD'],
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
              <KindOverview facts={data.karpenter} />
              <KarpenterConditions conditions={data.conditions} />
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
