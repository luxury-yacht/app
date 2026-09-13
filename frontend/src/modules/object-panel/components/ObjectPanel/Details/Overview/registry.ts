/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.ts
 *
 * GenericOverview fallback for unregistered/custom-resource kinds.
 * Registered kinds render via descriptorRegistry (see index.tsx).
 */

import React from 'react';
import { GenericOverview, type GenericOverviewProps } from './GenericOverview';

/**
 * Fallback renderer used by index.tsx for kinds without a registered descriptor (custom resources
 * and anything not yet covered). Renders the generic, field-agnostic overview.
 */
export const overviewRegistry = {
  renderComponent(props: unknown): React.ReactElement {
    const overviewProps =
      props !== null && typeof props === 'object' ? (props as GenericOverviewProps) : {};
    return React.createElement(GenericOverview, overviewProps);
  },
};
