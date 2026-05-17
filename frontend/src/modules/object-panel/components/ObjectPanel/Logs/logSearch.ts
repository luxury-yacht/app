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
    new RegExp(trimmed, 'i');
    return true;
  } catch {
    return false;
  }
};
