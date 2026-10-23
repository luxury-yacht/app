/**
 * frontend/src/shared/kinds/kindDisplay.test.ts
 *
 * Kind display names come from the kind facets: short names follow the user's
 * preference unless a caller passes one, and only built-in kinds are renamed.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';
import { kindDisplayName, kindNameDisplay } from './kindDisplay';
import { HELM_RELEASE_GVK } from './kindFacets';

describe('kindDisplayName', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
  });

  it('follows the short-names preference', () => {
    setAppPreferencesForTesting({ useShortResourceNames: true });
    expect(kindDisplayName({ group: 'apps', kind: 'Deployment' })).toBe('deploy');
    setAppPreferencesForTesting({ useShortResourceNames: false });
    expect(kindDisplayName({ group: 'apps', kind: 'Deployment' })).toBe('Deployment');
  });

  it('prefers the caller’s choice over the preference', () => {
    setAppPreferencesForTesting({ useShortResourceNames: false });
    expect(kindDisplayName({ group: '', kind: 'Service' }, true)).toBe('svc');
  });

  it('uses a kind’s shorter full label where it has one', () => {
    expect(
      kindDisplayName(
        { group: 'admissionregistration.k8s.io', kind: 'MutatingWebhookConfiguration' },
        false
      )
    ).toBe('MutatingWebhook');
    expect(kindDisplayName(HELM_RELEASE_GVK, true)).toBe('helm');
  });

  it('leaves custom resources and unknown kinds as they are', () => {
    expect(kindDisplayName({ group: 'example.com', kind: 'Deployment' }, true)).toBe('Deployment');
    expect(kindDisplayName({ group: 'example.com', kind: 'Widget' }, true)).toBe('Widget');
  });
});

describe('kindNameDisplay', () => {
  it('names a bare built-in kind name, for kind-name filters', () => {
    expect(kindNameDisplay('Deployment', true)).toBe('deploy');
    expect(kindNameDisplay('Widget', true)).toBe('Widget');
  });
});
