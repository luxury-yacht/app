/**
 * frontend/src/modules/object-panel/components/ObjectPanel/constants.test.ts
 */

import { describe, expect, it } from 'vitest';

import { getObjectDetailsRefresherName, getObjectEventsRefresherName } from './constants';

const PANEL_ID = 'obj:cluster-a:apps/v1/deployment:team-a:api';

describe('ObjectPanel constants', () => {
  it('scopes refresher names to the panel identity so same-kind panels never collide', () => {
    expect(getObjectDetailsRefresherName('Deployment', PANEL_ID)).toBe(
      `object-deployment:${PANEL_ID}`
    );
    expect(getObjectDetailsRefresherName('customResource', PANEL_ID)).toBe(
      `object-customresource:${PANEL_ID}`
    );
    expect(getObjectEventsRefresherName('Deployment', PANEL_ID)).toBe(
      `object-deployment:${PANEL_ID}-events`
    );
  });

  it('returns null when the kind or panel id is missing', () => {
    expect(getObjectDetailsRefresherName(undefined, PANEL_ID)).toBeNull();
    expect(getObjectDetailsRefresherName(null, PANEL_ID)).toBeNull();
    expect(getObjectDetailsRefresherName('Deployment', null)).toBeNull();
    expect(getObjectEventsRefresherName(undefined, PANEL_ID)).toBeNull();
    expect(getObjectEventsRefresherName('Deployment', null)).toBeNull();
  });
});
