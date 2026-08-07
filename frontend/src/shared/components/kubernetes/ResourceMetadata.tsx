/**
 * frontend/src/shared/components/kubernetes/ResourceMetadata.tsx
 *
 * UI component for ResourceMetadata.
 * Handles rendering and interactions for the shared components.
 */

import { LabelsAndAnnotations } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/LabelsAndAnnotations';
import React from 'react';

interface ResourceMetadataProps {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selector?: Record<string, string>;
  showSelector?: boolean;
}

interface ResourceMetadataPresentation {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selectorEntries?: Record<string, string>;
}

const hasMetadataEntries = (
  entries: Record<string, string> | undefined
): entries is Record<string, string> => !!entries && Object.keys(entries).length > 0;

const selectVisibleSelector = (
  selector: Record<string, string> | undefined,
  showSelector: boolean
): Record<string, string> | undefined =>
  showSelector && hasMetadataEntries(selector) ? selector : undefined;

const mergeSelectorLabels = (
  labels: Record<string, string> | undefined,
  selectorEntries: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!labels && !selectorEntries) {
    return undefined;
  }
  const combined = { ...labels };
  for (const [key, value] of Object.entries(selectorEntries ?? {})) {
    if (!(key in combined)) {
      combined[key] = value;
    }
  }
  return hasMetadataEntries(combined) ? combined : undefined;
};

const buildResourceMetadataPresentation = ({
  labels,
  annotations,
  selector,
  showSelector = false,
}: ResourceMetadataProps): ResourceMetadataPresentation | null => {
  const selectorEntries = selectVisibleSelector(selector, showSelector);
  const combinedLabels = mergeSelectorLabels(labels, selectorEntries);
  if (!combinedLabels && !hasMetadataEntries(annotations)) {
    return null;
  }
  return { labels: combinedLabels, annotations, selectorEntries };
};

export const ResourceMetadata = React.memo<ResourceMetadataProps>((props) => {
  const presentation = buildResourceMetadataPresentation(props);
  if (!presentation) {
    return null;
  }

  return <LabelsAndAnnotations {...presentation} />;
});
