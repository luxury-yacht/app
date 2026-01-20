/**
 * frontend/src/utils/kindAliasMap.test.ts
 *
 * Test suite for kindAliasMap.
 * Covers key behaviors and edge cases for kindAliasMap.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getDisplayKind, getTypeAlias } from './kindAliasMap';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';

describe('kindAliasMap utility', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
  });

  it('returns undefined alias when short names are disabled', () => {
    setAppPreferencesForTesting({ useShortResourceNames: false });
    expect(getTypeAlias('Pod')).toBeUndefined();
  });

  it('returns short alias when short names are enabled', () => {
    setAppPreferencesForTesting({ useShortResourceNames: true });
    expect(getTypeAlias('Deployment')).toBe('deploy');
    expect(getTypeAlias('UnknownKind')).toBeUndefined();
  });

  it('uses display overrides when short names disabled', () => {
    setAppPreferencesForTesting({ useShortResourceNames: false });
    expect(getDisplayKind('MutatingWebhookConfiguration')).toBe('MutatingWebhook');
    expect(getDisplayKind('CustomResourceDefinition')).toBe('CustomResourceDefinition');
  });

  it('prefers explicit useShortNames parameter over preference setting', () => {
    setAppPreferencesForTesting({ useShortResourceNames: false });
    expect(getDisplayKind('Service', true)).toBe('svc');
    expect(getDisplayKind('UnknownKind', true)).toBe('UnknownKind');
  });
});
