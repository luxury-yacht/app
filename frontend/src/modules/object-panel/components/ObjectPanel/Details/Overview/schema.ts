/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/schema.ts
 *
 * Types for the descriptor-driven Overview rendering (X1, Architecture A) plus the coverage helper
 * that backs the runtime drift-check. Presentation lives in the view layer; the Wails-generated
 * per-kind DTO classes stay the data contract.
 *
 * A schema is an ORDERED list of items so a kind can place its status block, conditional rows, and
 * custom widgets exactly where they belong. The renderer adds only the fixed frame: ResourceHeader
 * (top) and ResourceMetadata (bottom).
 */

import type React from 'react';

/** DTO keys the renderer's frame consumes directly (ResourceHeader + ResourceMetadata). */
const FRAME_FIELDS = ['kind', 'name', 'namespace', 'labels', 'annotations'] as const;

/** DTO keys a status item accounts for (ResourceStatus renders status/statusState/presentation). */
const STATUS_FIELDS = ['status', 'statusState', 'statusPresentation', 'statusReason'] as const;

type Dynamic<T, V> = V | ((data: T) => V);

/**
 * Panel context the renderer threads to render/widget fns — values NOT on the DTO: HPA-managed
 * detection, node drain state/handler, and the active cluster identity (for building links).
 */
export interface OverviewContext {
  hpaManaged?: boolean;
  drainInProgress?: boolean;
  onOpenDrain?: () => void;
  clusterId?: string;
  clusterName?: string;
}

/** A label/value row, rendered via the shared OverviewItem. */
export interface OverviewField<T> {
  kind?: 'field';
  /** DTO key this row reads — drives drift-check coverage and is the default value source. */
  field?: keyof T & string;
  label: Dynamic<T, string>;
  /** Custom value renderer; receives the typed DTO and panel context. Falls back to `data[field]`. */
  render?: (data: T, context: OverviewContext) => React.ReactNode;
  /** Hide conditionally (e.g. quiet-filtering of empty values, or kind-conditional rows). */
  hidden?: (data: T) => boolean;
  fullWidth?: Dynamic<T, boolean>;
  /** Wrap the value in the monospace span. */
  mono?: boolean;
  /** Extra DTO keys a custom `render`/`hidden` reads beyond `field`; counts toward coverage. */
  derivedFrom?: (keyof T & string)[];
}

/** The shared ResourceStatus block (status/statusState/statusPresentation). */
export interface OverviewStatusItem {
  kind: 'status';
}

/** An escape hatch for irreducible per-kind UI. `consumes` lists the DTO keys it reads. */
export interface OverviewWidget<T> {
  kind: 'widget';
  render: (data: T, context: OverviewContext) => React.ReactNode;
  consumes?: (keyof T & string)[];
}

export type OverviewItemSpec<T> = OverviewField<T> | OverviewStatusItem | OverviewWidget<T>;

export interface OverviewSchema<T> {
  items: OverviewItemSpec<T>[];
  /** Show the selector in the metadata block (ResourceMetadata showSelector). */
  showSelector?: boolean;
}

/**
 * A constructable Wails model class. Its generated constructor assigns every field of the kind's
 * Go struct unconditionally, so `Object.keys(new C({}))` enumerates the kind's full field set.
 */
export interface DtoClass<T> {
  new (source?: unknown): T;
}

export interface OverviewDescriptor<T> {
  displayKind: string;
  dtoClass: DtoClass<T>;
  schema: OverviewSchema<T>;
  /**
   * DTO keys handled OUTSIDE the Overview schema: consumed by a derived sibling section (e.g.
   * ConfigMap `data`/`binaryData` → DataSection) or deliberately not surfaced. The explicit
   * opt-out the drift-check honors — a NEW backend field that nobody places fails the check.
   */
  coveredElsewhere?: string[];
  /** Secret masks its data values in the derived DataSection. */
  masksValues?: boolean;
}

/**
 * Every DTO key the descriptor accounts for: frame ∪ schema field keys (+ each field's
 * `derivedFrom`) ∪ status-item fields ∪ widget `consumes` ∪ `selector` (when shown) ∪
 * `coveredElsewhere`. The drift-check asserts this covers `Object.keys(new dto)`.
 */
export function coverageKeys<T>(descriptor: OverviewDescriptor<T>): Set<string> {
  const keys = new Set<string>(FRAME_FIELDS);
  if (descriptor.schema.showSelector) {
    keys.add('selector');
  }
  for (const item of descriptor.schema.items) {
    const itemKind = (item as { kind?: string }).kind;
    if (itemKind === 'status') {
      for (const k of STATUS_FIELDS) {
        keys.add(k);
      }
    } else if (itemKind === 'widget') {
      for (const k of (item as OverviewWidget<T>).consumes ?? []) {
        keys.add(k);
      }
    } else {
      const field = item as OverviewField<T>;
      if (field.field) {
        keys.add(field.field);
      }
      for (const k of field.derivedFrom ?? []) {
        keys.add(k);
      }
    }
  }
  for (const k of descriptor.coveredElsewhere ?? []) {
    keys.add(k);
  }
  return keys;
}
