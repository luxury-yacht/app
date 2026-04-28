/**
 * Hash-based color slot selection for kind badges.
 *
 * Mirrors the approach used for pod-log row colors (see Logs/podColors.ts):
 * a deterministic FNV-1a hash maps a kind name to one of N palette slots,
 * where slot colors are defined as CSS custom properties (--hash-color-1 ..
 * --hash-color-N) per theme. The badge consumer attaches a class
 * "hash-color-{N}" and badges.css applies the color via the corresponding
 * custom property.
 */

const HASH_COLOR_PALETTE_SIZE = 24;

/**
 * Manual overrides for kind → palette-slot. The hash function gives an
 * even distribution across the palette but doesn't know which slots
 * actually read well for which kinds; for the cases where it picks a
 * poor color we pin a specific slot here.
 *
 * Keys are kind names lowercased (matching the normalization below).
 * Values are 1-based palette indices in the range [1, HASH_COLOR_PALETTE_SIZE].
 *
 * This is intentionally a static const, not user-configurable.
 */
const KIND_COLOR_OVERRIDES: Record<string, number> = {
  configmap: 10,
  daemonset: 2,
  deployment: 11,
  ingressclass: 8,
  secret: 14,
  statefulset: 6,
  mutatingwebhookconfiguration: 2,
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const hashKindColorIndex = (kind: string, paletteSize: number): number => {
  if (paletteSize <= 0) {
    return 0;
  }
  let hash = FNV_OFFSET;
  for (let i = 0; i < kind.length; i += 1) {
    hash ^= kind.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0) % paletteSize;
};

/**
 * Returns the slot class (e.g., "hash-color-7") for a kind name, or an empty
 * string when the kind is missing — letting the badge fall back to the grey
 * default defined in badges.css.
 */
export const getKindColorClass = (kind: string | null | undefined): string => {
  const trimmed = (kind ?? '').trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  const override = KIND_COLOR_OVERRIDES[trimmed];
  if (override) {
    return `hash-color-${override}`;
  }
  return `hash-color-${hashKindColorIndex(trimmed, HASH_COLOR_PALETTE_SIZE) + 1}`;
};
