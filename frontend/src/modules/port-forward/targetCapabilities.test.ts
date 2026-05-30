/**
 * frontend/src/modules/port-forward/targetCapabilities.test.ts
 *
 * Tests for the frontend port-forward target capability table.
 */

import { describe, expect, it } from 'vitest';
import {
  isPortForwardTargetGVKSupported,
  lookupPortForwardTargetCapability,
} from './targetCapabilities';

describe('port-forward target capabilities', () => {
  it('describes the supported target GVKs', () => {
    expect(lookupPortForwardTargetCapability('Pod')).toMatchObject({
      group: '',
      version: 'v1',
      reconnect: false,
      usesServicePortSpec: false,
    });
    expect(lookupPortForwardTargetCapability('Service')).toMatchObject({
      group: '',
      version: 'v1',
      reconnect: true,
      usesServicePortSpec: true,
    });
    expect(lookupPortForwardTargetCapability('Deployment')).toMatchObject({
      group: 'apps',
      version: 'v1',
      reconnect: true,
    });
    expect(lookupPortForwardTargetCapability('StatefulSet')).toMatchObject({
      group: 'apps',
      version: 'v1',
      reconnect: true,
    });
    expect(lookupPortForwardTargetCapability('DaemonSet')).toMatchObject({
      group: 'apps',
      version: 'v1',
      reconnect: true,
    });
  });

  it('requires exact GVK matches', () => {
    expect(
      isPortForwardTargetGVKSupported({
        kind: 'Deployment',
        group: 'apps',
        version: 'v1',
      })
    ).toBe(true);
    expect(
      isPortForwardTargetGVKSupported({
        kind: 'Deployment',
        group: 'extensions',
        version: 'v1beta1',
      })
    ).toBe(false);
    expect(
      isPortForwardTargetGVKSupported({
        kind: 'ReplicaSet',
        group: 'apps',
        version: 'v1',
      })
    ).toBe(false);
  });
});
