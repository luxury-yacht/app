/**
 * frontend/src/ui/layout/namespaceScope.test.ts
 *
 * The namespace-scope editor's syntactic validation
 * (docs/architecture/namespace-scope.md): which names the sidebar accepts
 * before asking the backend to persist the scope. Loading, saving, and
 * removing run through the real editor in NamespaceScopeEditor.test.tsx.
 */

import { describe, expect, it } from 'vitest';
import { addNamespaceToScope, isValidNamespaceName } from './namespaceScope';

describe('isValidNamespaceName', () => {
  it('accepts DNS-1123 labels and rejects everything else', () => {
    expect(isValidNamespaceName('prod')).toBe(true);
    expect(isValidNamespaceName('team-a1')).toBe(true);
    expect(isValidNamespaceName('')).toBe(false);
    expect(isValidNamespaceName('Prod')).toBe(false);
    expect(isValidNamespaceName('-lead')).toBe(false);
    expect(isValidNamespaceName('trail-')).toBe(false);
    expect(isValidNamespaceName('has_underscore')).toBe(false);
    expect(isValidNamespaceName('a'.repeat(64))).toBe(false);
    expect(isValidNamespaceName('a'.repeat(63))).toBe(true);
  });
});

describe('addNamespaceToScope', () => {
  it('adds a trimmed name and rejects duplicates and invalid names', () => {
    expect(addNamespaceToScope(['prod'], ' dev ')).toEqual({ next: ['prod', 'dev'] });
    expect(addNamespaceToScope(['prod'], 'prod')).toEqual({ error: expect.any(String) });
    expect(addNamespaceToScope(['prod'], 'Not Valid')).toEqual({ error: expect.any(String) });
  });
});
