/**
 * frontend/src/modules/port-forward/targetCapabilities.ts
 *
 * Shared frontend capability table for Kubernetes resources that can be used
 * as port-forward targets.
 */

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

const PORT_FORWARD_TARGET_CAPABILITIES: Record<string, PortForwardTargetCapability> = {
  Pod: {
    kind: 'Pod',
    group: '',
    version: 'v1',
    reconnect: false,
    usesServicePortSpec: false,
  },
  Service: {
    kind: 'Service',
    group: '',
    version: 'v1',
    reconnect: true,
    usesServicePortSpec: true,
  },
  Deployment: {
    kind: 'Deployment',
    group: 'apps',
    version: 'v1',
    reconnect: true,
    usesServicePortSpec: false,
  },
  StatefulSet: {
    kind: 'StatefulSet',
    group: 'apps',
    version: 'v1',
    reconnect: true,
    usesServicePortSpec: false,
  },
  DaemonSet: {
    kind: 'DaemonSet',
    group: 'apps',
    version: 'v1',
    reconnect: true,
    usesServicePortSpec: false,
  },
};

export function lookupPortForwardTargetCapability(
  kind: string
): PortForwardTargetCapability | null {
  return PORT_FORWARD_TARGET_CAPABILITIES[kind] ?? null;
}

export function isPortForwardTargetGVKSupported(target: PortForwardTargetIdentity): boolean {
  const capability = lookupPortForwardTargetCapability(target.kind);
  return Boolean(
    capability && capability.group === target.group && capability.version === target.version
  );
}
