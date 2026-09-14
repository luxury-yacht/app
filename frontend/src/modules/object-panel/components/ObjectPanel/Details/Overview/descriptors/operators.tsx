import type { CustomResourceDetails } from '@core/refresh/types';
import { CertManagerSections } from '../CertManagerSections';
import { ExternalSecretsSections } from '../ExternalSecretsSections';
import { PrometheusSections } from '../PrometheusSections';
import type { OverviewDescriptor } from '../schema';
import { OperatorStatus } from '../shared/OperatorOverview';

function OperatorContent({ data }: Readonly<{ data: CustomResourceDetails }>) {
  const conditions =
    data.certManager?.conditions ?? data.externalSecrets?.conditions ?? data.prometheus?.conditions;
  return (
    <div className="operator-overview">
      <OperatorStatus
        status={data.status}
        presentation={data.statusPresentation}
        conditions={conditions}
      />
      {!!data.certManager && <CertManagerSections facts={data.certManager} />}
      {!!data.externalSecrets && <ExternalSecretsSections facts={data.externalSecrets} />}
      {!!data.prometheus && (
        <PrometheusSections
          facts={data.prometheus}
          kind={data.kind}
          namespace={data.ref.namespace}
        />
      )}
    </div>
  );
}

export const operatorDescriptor: OverviewDescriptor<CustomResourceDetails> = {
  displayKind: 'Custom Resource',
  dtoName: 'CustomResourceDetails',
  coveredElsewhere: ['resourceFamily', 'karpenter', 'argoCD', 'conditions'],
  schema: {
    items: [
      {
        kind: 'widget',
        consumes: [
          'ref',
          'certManager',
          'externalSecrets',
          'prometheus',
          'status',
          'statusState',
          'statusPresentation',
        ],
        render: (data) => <OperatorContent data={data} />,
      },
    ],
  },
};

export function getOperatorOverviewDescriptor(
  kind: string,
  detail: unknown
): OverviewDescriptor<never> | undefined {
  const data = detail as Partial<CustomResourceDetails> | null | undefined;
  if (!data?.certManager && !data?.externalSecrets && !data?.prometheus) {
    return undefined;
  }
  return { ...operatorDescriptor, displayKind: data.kind ?? kind } as OverviewDescriptor<never>;
}
