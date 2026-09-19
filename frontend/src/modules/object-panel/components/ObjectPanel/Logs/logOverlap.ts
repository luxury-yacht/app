// Match the buffered suffix against the incoming prefix without duplicating repeated log lines.
const buildPrefixLengths = (pattern: string[]): Uint32Array => {
  const prefixLengths = new Uint32Array(pattern.length);
  for (let index = 1, matched = 0; index < pattern.length; index += 1) {
    while (matched > 0 && pattern[index] !== pattern[matched]) {
      matched = prefixLengths[matched - 1];
    }
    if (pattern[index] === pattern[matched]) {
      matched += 1;
    }
    prefixLengths[index] = matched;
  }
  return prefixLengths;
};

const matchSuffixAgainstPrefix = <T>(
  currentEntries: readonly T[],
  pattern: string[],
  prefixLengths: Uint32Array,
  keyOf: (entry: T) => string
): number => {
  let matched = 0;
  const comparisonStart = Math.max(0, currentEntries.length - pattern.length);
  for (let index = comparisonStart; index < currentEntries.length; index += 1) {
    const key = keyOf(currentEntries[index]);
    while (matched > 0 && key !== pattern[matched]) {
      matched = prefixLengths[matched - 1];
    }
    if (key === pattern[matched]) {
      matched += 1;
    }
    if (matched === pattern.length && index < currentEntries.length - 1) {
      matched = prefixLengths[matched - 1];
    }
  }
  return matched;
};

export const findLogOverlap = <T>(
  currentEntries: readonly T[],
  incomingEntries: readonly T[],
  keyOf: (entry: T) => string
): number => {
  if (currentEntries.length === 0 || incomingEntries.length === 0) {
    return 0;
  }

  const pattern = incomingEntries.map(keyOf);
  // Build a prefix table so a rolling buffer can be matched in linear time,
  // even when fallback refreshes regenerate the entries' render sequences.
  return matchSuffixAgainstPrefix(currentEntries, pattern, buildPrefixLengths(pattern), keyOf);
};
