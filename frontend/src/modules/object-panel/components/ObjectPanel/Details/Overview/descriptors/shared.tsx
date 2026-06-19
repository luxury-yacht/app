/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/shared.tsx
 *
 * Shared render helpers reused across Overview descriptors.
 */

import React from 'react';
import { resourcemodel } from '@wailsjs/go/models';
import { StatusChip } from '@shared/components/StatusChip';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';

/**
 * Renders a "Used By" value: a "Not in use" chip when empty, else a list of links to the
 * referencing objects. The backend leaves UsedBy nil when nothing references the object, so an
 * empty list means "not in use" rather than "unknown".
 */
export function renderUsedByLinks(usedBy?: resourcemodel.ResourceRef[] | null): React.ReactNode {
  if (!usedBy || usedBy.length === 0) {
    return <StatusChip variant="info">Not in use</StatusChip>;
  }
  return (
    <div>
      {usedBy.map((ref, index) => (
        <div
          key={`${ref.clusterId}-${ref.group}-${ref.version}-${ref.kind}-${ref.namespace ?? ''}-${ref.name ?? index}`}
          style={{ marginTop: index > 0 ? '4px' : 0 }}
        >
          <ObjectPanelLink
            objectRef={{ ...ref, group: ref.group, version: ref.version }}
            title={`Click to view pod: ${ref.name ?? ref.kind}`}
          >
            {ref.name ?? ref.kind}
          </ObjectPanelLink>
        </div>
      ))}
    </div>
  );
}
