/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/nodeShell.ts
 *
 * Node shell identity: the Shell tab on a Node runs `kubectl debug
 * node/<name> --profile=sysadmin` through a debug pod the backend creates.
 */

import type { ResourceRef } from '@core/refresh/types';
import { lookupKindFacets } from '@shared/kinds/kindFacets';

/** Namespace of node shell debug pods; mirrors backend `nodes.DebugPodNamespace`. */
export const NODE_SHELL_POD_NAMESPACE = 'default';

/** Whether a shell target's kind opens a node shell (its shell facet), not a pod exec. */
export const isNodeShellTarget = (target: Pick<ResourceRef, 'group' | 'version' | 'kind'>) =>
  lookupKindFacets(target)?.panel.shell === 'node';
