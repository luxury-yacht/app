/**
 * frontend/src/utils/kindAliasMap.test.ts
 *
 * Test suite for kindAliasMap.
 * Covers key behaviors and edge cases for kindAliasMap.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { getDisplayKind, getTypeAlias } from './kindAliasMap';

describe('kindAliasMap utility', () => {
  afterEach(() => {
    localStorage.removeItem('useShortResourceNames');
  });

  it('returns undefined alias when short names are disabled', () => {
    localStorage.setItem('useShortResourceNames', 'false');
    expect(getTypeAlias('Pod')).toBeUndefined();
  });

  it('returns short alias from localStorage flag', () => {
    localStorage.setItem('useShortResourceNames', 'true');
    expect(getTypeAlias('Deployment')).toBe('deploy');
    expect(getTypeAlias('UnknownKind')).toBeUndefined();
  });

  it('uses display overrides when short names disabled', () => {
    localStorage.setItem('useShortResourceNames', 'false');
    expect(getDisplayKind('MutatingWebhookConfiguration')).toBe('MutatingWebhook');
    expect(getDisplayKind('CustomResourceDefinition')).toBe('CustomResourceDefinition');
  });

  it('prefers explicit useShortNames parameter over localStorage', () => {
    localStorage.setItem('useShortResourceNames', 'false');
    expect(getDisplayKind('Service', true)).toBe('svc');
    expect(getDisplayKind('UnknownKind', true)).toBe('UnknownKind');
  });
});
