/**
 * Shared component for displaying resource metadata (labels and annotations)
 */

import React from 'react';
import { LabelsAndAnnotations } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/LabelsAndAnnotations';

interface ResourceMetadataProps {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selector?: Record<string, string>;
  showSelector?: boolean;
}

export const ResourceMetadata = React.memo<ResourceMetadataProps>(
  ({ labels, annotations, selector, showSelector = false }) => {
    const selectorEntries =
      showSelector && selector && Object.keys(selector).length > 0 ? selector : undefined;

    // Merge selectors into labels so they can be highlighted inline when missing
    let combinedLabels = labels ? { ...labels } : undefined;
    if (selectorEntries) {
      if (!combinedLabels) {
        // start with selectors if no labels exist
        const derived: Record<string, string> = {};
        Object.entries(selectorEntries).forEach(([key, value]) => {
          derived[key] = value;
        });
        combinedLabels = derived;
      } else {
        Object.entries(selectorEntries).forEach(([key, value]) => {
          if (!(key in combinedLabels!)) {
            combinedLabels![key] = value;
          }
        });
      }
    }

    if (
      (!combinedLabels || Object.keys(combinedLabels).length === 0) &&
      (!annotations || Object.keys(annotations).length === 0)
    ) {
      return null;
    }

    return (
      <LabelsAndAnnotations
        labels={combinedLabels}
        annotations={annotations}
        selectorEntries={selectorEntries}
      />
    );
  }
);
