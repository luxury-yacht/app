/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/OverviewRenderer.tsx
 *
 * Generic, descriptor-driven Overview renderer (X1, Architecture A). Renders the fixed frame
 * (ResourceHeader top, ResourceMetadata bottom) and the descriptor's ordered schema items in
 * between. No per-kind logic lives here.
 */

import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import React from 'react';
import type { OverviewContext, OverviewDescriptor, OverviewField, OverviewWidget } from './schema';
import { OverviewItem } from './shared/OverviewItem';

/** Frame fields read off any DTO (optional so T is not over-constrained). */
interface FrameAccess {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  selector?: Record<string, string>;
  status?: string;
  statusState?: string;
  statusPresentation?: string;
}

interface OverviewRendererProps<T> {
  descriptor: OverviewDescriptor<T>;
  data: T | null | undefined;
  context?: OverviewContext;
}

function resolve<T, V>(value: V | ((data: T) => V), data: T): V {
  return typeof value === 'function' ? (value as (data: T) => V)(data) : value;
}

function renderField<T>(
  field: OverviewField<T>,
  data: T,
  context: OverviewContext,
  key: React.Key
): React.ReactElement | null {
  // Decide visibility before doing any work: a hidden row is dropped, so evaluating its
  // render/label/fullWidth resolvers would be wasted — and it would force every conditional
  // render() to re-guard against the absent value to avoid throwing on a row nobody sees.
  if (field.hidden?.(data)) {
    return null;
  }

  const rawValue = field.render
    ? field.render(data, context)
    : field.field
      ? (data[field.field] as React.ReactNode)
      : undefined;
  const value = field.mono ? <span className="overview-value-mono">{rawValue}</span> : rawValue;
  return (
    <OverviewItem
      key={key}
      label={resolve(field.label, data)}
      value={value}
      fullWidth={field.fullWidth ? resolve(field.fullWidth, data) : false}
    />
  );
}

export function OverviewRenderer<T>({
  descriptor,
  data,
  context = {},
}: OverviewRendererProps<T>): React.ReactElement | null {
  if (!data) {
    return null;
  }
  const frame = data as unknown as FrameAccess;

  return (
    <>
      <ResourceHeader
        kind={descriptor.displayKind}
        name={frame.name ?? ''}
        namespace={frame.namespace}
      />

      {withStableListKeys(descriptor.schema.items, (item) => {
        if (item.kind === 'status') {
          return 'status';
        }
        if (item.kind === 'widget') {
          return `widget:${item.consumes?.join(',') ?? ''}`;
        }
        return `field:${item.field ?? String(item.label)}`;
      }).map(({ key, value: item }) => {
        const itemKind = (item as { kind?: string }).kind;
        if (itemKind === 'status') {
          return (
            <ResourceStatus
              key={key}
              status={frame.status}
              statusState={frame.statusState}
              statusPresentation={frame.statusPresentation}
            />
          );
        }
        if (itemKind === 'widget') {
          return (
            <React.Fragment key={key}>
              {(item as OverviewWidget<T>).render(data, context)}
            </React.Fragment>
          );
        }
        const field = item as OverviewField<T>;
        return renderField(field, data, context, key);
      })}

      <ResourceMetadata
        labels={frame.labels}
        annotations={frame.annotations}
        selector={frame.selector}
        showSelector={descriptor.schema.showSelector}
      />
    </>
  );
}
