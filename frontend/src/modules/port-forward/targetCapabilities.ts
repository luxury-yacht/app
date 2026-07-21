/**
 * frontend/src/modules/port-forward/targetCapabilities.ts
 *
 * Port-forward view of the backend-generated object-action kind catalog.
 */

import { lookupObjectActionKindCapability } from '@shared/actions/objectActionCapabilities';

export interface PortForwardTargetCapability {
  kind: string;
  group: string;
  version: string;
  reconnect: boolean;
  usesServicePortSpec: boolean;
}

export interface PortForwardTargetIdentity {
  kind: string;
  group: string;
  version: string;
}

export function lookupPortForwardTargetCapability(
  kind: string
): PortForwardTargetCapability | null {
  const capability = lookupObjectActionKindCapability(kind);
  if (!capability?.portForward) {
    return null;
  }
  return {
    kind: capability.kind,
    group: capability.group,
    version: capability.version,
    reconnect: capability.reconnect ?? false,
    usesServicePortSpec: capability.usesServicePortSpec ?? false,
  };
}

export function isPortForwardTargetGVKSupported(target: PortForwardTargetIdentity): boolean {
  const capability = lookupPortForwardTargetCapability(target.kind);
  return Boolean(
    capability && capability.group === target.group && capability.version === target.version
  );
}
