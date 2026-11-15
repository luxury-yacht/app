/**
 * frontend/src/core/persistence/namedWorkspaces.ts
 *
 * The saved named workspaces, in the backend's order. Nothing announces a
 * change to the list, and any window can save, rename, replace or delete one,
 * so every consumer reads it again when it opens instead of keeping a copy.
 */

import { readNamedWorkspaces, requestAppState } from '@/core/app-state-access';

export const listNamedWorkspaces = () =>
  requestAppState({
    resource: 'named-workspaces',
    adapter: 'persistence-read',
    read: readNamedWorkspaces,
  });
