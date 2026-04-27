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
  return `hash-color-${hashKindColorIndex(trimmed, HASH_COLOR_PALETTE_SIZE) + 1}`;
};
