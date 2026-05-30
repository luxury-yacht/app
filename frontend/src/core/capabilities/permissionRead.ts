/**
 * frontend/src/core/capabilities/permissionRead.ts
 *
 * Owns the frontend QueryPermissions read contract. It keeps permission
 * payload typing, broker diagnostics, and paused-read behavior in one module
 * so capability hooks and the permission store do not duplicate the seam.
 */

import { readQueryPermissions, requestData } from '@/core/data-access';

export interface QueryPayloadItem {
  id: string;
  clusterId: string;
  /**
   * API group for the target kind. Optional: when present alongside
   * `version`, the backend routes through the strict GVK resolver. When
   * absent, the backend falls back to kind-only resolution.
   */
  group?: string;
  /** API version paired with `group`. */
  version?: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
}

export interface QueryResponseResult {
  id: string;
  clusterId: string;
  group?: string;
  version?: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
  allowed: boolean;
  source: string;
  reason: string;
  error: string;
}

export interface QueryResponseDiagnostics {
  key: string;
  clusterId: string;
  namespace?: string;
  method: string;
  ssrrIncomplete: boolean;
  ssrrRuleCount: number;
  ssarFallbackCount: number;
  checkCount: number;
}

export interface QueryPermissionsResponse {
  results: QueryResponseResult[];
  diagnostics?: QueryResponseDiagnostics[];
}

const permissionReadScope = (queries: QueryPayloadItem[]): string =>
  Array.from(
    new Set(
      queries.map((query) =>
        query.namespace
          ? `cluster:${query.clusterId}|namespace:${query.namespace}`
          : `cluster:${query.clusterId}`
      )
    )
  ).join(' || ');

export const queryPermissions = (queries: QueryPayloadItem[]): Promise<QueryPermissionsResponse> =>
  requestData<QueryPermissionsResponse>({
    resource: 'query-permissions',
    label: 'Query Permissions',
    adapter: 'permission-read',
    reason: 'startup',
    scope: permissionReadScope(queries),
    read: () => readQueryPermissions<QueryPermissionsResponse>(queries),
  }).then((result) => {
    if (result.status !== 'executed' || !result.data) {
      throw new Error(result.blockedReason ?? 'query-permissions-blocked');
    }
    return result.data;
  });
