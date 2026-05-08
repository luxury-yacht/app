import { describe, expect, it } from 'vitest';

import {
  resolveDrainStartPermissionStatus,
  resolveNodeActionPermissionStatuses,
  resolveNodeDrainOperationPermissions,
} from './nodeActionPermissions';

const allowed = { allowed: true, pending: false };
const denied = { allowed: false, pending: false };

describe('resolveNodeActionPermissionStatuses', () => {
  it('requires Node get and patch for cordon actions', () => {
    expect(
      resolveNodeActionPermissionStatuses({
        nodeGet: denied,
        nodePatch: allowed,
        podEvictionCreate: allowed,
        podDelete: denied,
      }).cordon
    ).toEqual(denied);
  });

  it('allows drain when Node mutation and either Pod drain path is allowed', () => {
    expect(
      resolveNodeActionPermissionStatuses({
        nodeGet: allowed,
        nodePatch: allowed,
        podEvictionCreate: allowed,
        podDelete: denied,
      }).drain
    ).toEqual(allowed);

    expect(
      resolveNodeActionPermissionStatuses({
        nodeGet: allowed,
        nodePatch: allowed,
        podEvictionCreate: denied,
        podDelete: allowed,
      }).drain
    ).toEqual(allowed);
  });

  it('does not allow drain without a Pod drain path', () => {
    expect(
      resolveNodeActionPermissionStatuses({
        nodeGet: allowed,
        nodePatch: allowed,
        podEvictionCreate: denied,
        podDelete: denied,
      }).drain
    ).toEqual(denied);
  });

  it('derives option-specific start permission for eviction and direct delete', () => {
    const permissions = resolveNodeDrainOperationPermissions({
      nodeGet: allowed,
      nodePatch: allowed,
      podEvictionCreate: allowed,
      podDelete: denied,
    });

    expect(
      resolveDrainStartPermissionStatus({
        ...permissions,
        disableEviction: false,
      })
    ).toEqual(allowed);
    expect(
      resolveDrainStartPermissionStatus({
        ...permissions,
        disableEviction: true,
      })
    ).toEqual(denied);
  });
});
