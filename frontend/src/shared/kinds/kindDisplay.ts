/**
 * frontend/src/shared/kinds/kindDisplay.ts
 *
 * How the UI names a kind: its short name with "short resource names" on, else
 * its label, both from the kind facets. A kind the table does not know (a custom
 * resource) shows its kind as given.
 */

import { getPreference } from '@/core/settings/appPreferences';
import { type KindFacets, lookupKindByName, lookupKindMetadata } from './kindFacets';

const displayOf = (row: KindFacets | null, kind: string, useShortNames?: boolean): string => {
  if (!row) {
    return kind;
  }
  const short = useShortNames ?? getPreference('useShortResourceNames');
  return short ? row.display.shortName : row.display.label;
};

/** The display name of an object's kind, by its group and kind. */
export const kindDisplayName = (
  ref: { group?: string | null; kind: string },
  useShortNames?: boolean
): string => displayOf(lookupKindMetadata(ref), ref.kind, useShortNames);

/**
 * The display name for a bare kind name. Only for surfaces keyed by the kind name
 * itself, such as kind filters that group objects by name.
 */
export const kindNameDisplay = (kind: string, useShortNames?: boolean): string =>
  displayOf(lookupKindByName(kind), kind, useShortNames);
