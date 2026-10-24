/**
 * frontend/src/utils/kindAliasMap.ts
 *
 * Command-palette kind search: the tokens a user may type for a kind (its short
 * name, kind, resource plural, and kubectl short names), from the kind facets.
 */

import { KIND_FACETS } from '@shared/kinds/kindFacets';

const buildAliasToKindMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  const add = (token: string, kind: string) => {
    const key = token.toLowerCase();
    if (!map.has(key)) {
      map.set(key, kind);
    }
  };
  for (const row of KIND_FACETS) {
    const lowerKind = row.kind.toLowerCase();
    const shortName = row.display.shortName;
    for (const token of [shortName, lowerKind, `${lowerKind}s`, `${shortName}s`, row.resource]) {
      add(token, row.kind);
    }
  }
  for (const row of KIND_FACETS) {
    for (const alias of row.display.searchAliases) {
      add(alias, row.kind);
    }
  }
  return map;
};

// Reverse lookup: user input token -> canonical Kind (for search/query parsing).
export const aliasToKindMap = buildAliasToKindMap();

// Canonical kinds for partial matching in search.
export const canonicalKinds = Array.from(new Set(aliasToKindMap.values())).map((k) =>
  k.toLowerCase()
);
