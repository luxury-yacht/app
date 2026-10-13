/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/nodeShell.ts
 *
 * Node shell identity: the Shell tab on a Node runs `kubectl debug
 * node/<name> --profile=sysadmin` through a debug pod the backend creates.
 */

import type { ResourceRef } from '@core/refresh/types';

/** Namespace of node shell debug pods; mirrors backend `nodes.DebugPodNamespace`. */
export const NODE_SHELL_POD_NAMESPACE = 'default';

/** Whether a shell target is a core/v1 Node, which opens a node shell. */
export const isNodeShellTarget = (target: Pick<ResourceRef, 'group' | 'version' | 'kind'>) =>
  target.group === '' && target.version === 'v1' && target.kind === 'Node';
