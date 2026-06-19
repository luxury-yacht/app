/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/configmap.tsx
 *
 * ConfigMap Overview descriptor (X1 P0). Presentation moved verbatim from ConfigMapOverview.tsx.
 */

import { configmap } from '@wailsjs/go/models';
import type { OverviewDescriptor } from '../schema';
import { renderUsedByLinks } from './shared';

type ConfigMapDetails = configmap.ConfigMapDetails;

export const configMapDescriptor: OverviewDescriptor<ConfigMapDetails> = {
  displayKind: 'ConfigMap',
  dtoClass: configmap.ConfigMapDetails,
  schema: {
    items: [
      {
        // Usage information — always rendered. The backend leaves UsedBy nil when no pods
        // reference this ConfigMap, so undefined means "not in use" rather than "unknown".
        field: 'usedBy',
        label: 'Used By',
        render: (d) => renderUsedByLinks(d.usedBy),
      },
    ],
  },
  // data/binaryData are surfaced by the derived DataSection (not the Overview); details/dataCount
  // are summary fields intentionally not surfaced here (the DataSection shows the actual keys).
  coveredElsewhere: ['data', 'binaryData', 'details', 'dataCount'],
};
