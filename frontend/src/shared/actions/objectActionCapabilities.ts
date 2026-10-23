import { KIND_FACETS, type KindFacets, lookupKindFacets } from '@shared/kinds/kindFacets';

export interface ObjectActionKindIdentity {
  group: string;
  version: string;
  kind: string;
}

/** A kind's object-action eligibility, with its canonical kind name. */
export type ObjectActionKindCapability = KindFacets['actions'] & { readonly kind: string };

const capabilityByRow = new Map<KindFacets, ObjectActionKindCapability>(
  KIND_FACETS.map((row) => [row, { kind: row.kind, ...row.actions }])
);

export const lookupObjectActionKindCapability = (
  identity: ObjectActionKindIdentity
): ObjectActionKindCapability | null => {
  const row = lookupKindFacets(identity);
  return row ? (capabilityByRow.get(row) ?? null) : null;
};
