export interface LogSearchRegexOptions {
  regexMode?: boolean;
  caseSensitive?: boolean;
  global?: boolean;
}

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildLogSearchRegex = (
  searchText: string,
  { regexMode = false, caseSensitive = false, global = false }: LogSearchRegexOptions = {}
): RegExp | null => {
  const trimmed = searchText.trim();
  if (!trimmed) {
    return null;
  }

  const flags = `${caseSensitive ? '' : 'i'}${global ? 'g' : ''}`;
  try {
    return new RegExp(regexMode ? trimmed : escapeRegExp(trimmed), flags);
  } catch {
    return null;
  }
};

export const isValidRegexPattern = (pattern: string): boolean => {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return true;
  }

  try {
    // The constructed value is the point: it throws on an invalid pattern.
    // Returning it through Boolean keeps the instantiation used, which the
    // lint rule against discarded `new` expressions requires.
    return Boolean(new RegExp(trimmed, 'i'));
  } catch {
    return false;
  }
};
