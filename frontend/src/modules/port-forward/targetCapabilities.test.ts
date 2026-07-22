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
    expect(
      lookupPortForwardTargetCapability({ kind: 'Pod', group: '', version: 'v1' })
    ).toMatchObject({
      group: '',
      version: 'v1',
      reconnect: false,
      usesServicePortSpec: false,
    });
    expect(
      lookupPortForwardTargetCapability({ kind: 'Service', group: '', version: 'v1' })
    ).toMatchObject({
      group: '',
      version: 'v1',
      reconnect: true,
      usesServicePortSpec: true,
    });
    expect(
      lookupPortForwardTargetCapability({ kind: 'Deployment', group: 'apps', version: 'v1' })
    ).toMatchObject({
      group: 'apps',
      version: 'v1',
      reconnect: true,
    });
    expect(
      lookupPortForwardTargetCapability({ kind: 'StatefulSet', group: 'apps', version: 'v1' })
    ).toMatchObject({
      group: 'apps',
      version: 'v1',
      reconnect: true,
    });
    expect(
      lookupPortForwardTargetCapability({ kind: 'DaemonSet', group: 'apps', version: 'v1' })
    ).toMatchObject({
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
