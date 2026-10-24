import type { CustomResourceDetails } from '@/core/refresh/types';
import {
  ArgoCDApplication,
  ArgoCDApplicationSet,
  ArgoCDProject,
  ArgoCDStatus,
} from '../ArgoCDSections';
import type { OverviewDescriptor } from '../schema';

export const argoCDDescriptor: OverviewDescriptor<CustomResourceDetails> = {
  displayKind: 'Argo CD',
  dtoName: 'CustomResourceDetails',
  coveredElsewhere: [
    'ref',
    'resourceFamily',
    'karpenter',
    'conditions',
    'certManager',
    'externalSecrets',
    'prometheus',
  ],
  schema: {
    items: [
      {
        kind: 'widget',
        consumes: ['argoCD', 'status', 'statusState', 'statusPresentation'],
        render: (data) => {
          if (!data.argoCD) {
            return null;
          }
          return (
            <div className="operator-overview">
              <ArgoCDStatus
                facts={data.argoCD}
                status={data.status}
                presentation={data.statusPresentation}
              />
              {!!data.argoCD.application && <ArgoCDApplication facts={data.argoCD.application} />}
              {!!data.argoCD.applicationSet && (
                <ArgoCDApplicationSet facts={data.argoCD.applicationSet} />
              )}
              {!!data.argoCD.project && <ArgoCDProject facts={data.argoCD.project} />}
            </div>
          );
        },
      },
    ],
  },
};
export function getArgoCDOverviewDescriptor(
  details: CustomResourceDetails
): OverviewDescriptor<CustomResourceDetails> | undefined {
  if (details.resourceFamily !== 'argocd' || !details.argoCD) {
    return undefined;
  }
  return { ...argoCDDescriptor, displayKind: details.kind };
}
