export type GlobalTableView = 'clusters' | 'namespaces';

export interface GlobalTableOwner<View extends GlobalTableView> {
  readonly view: View;
  readonly identity: `global:${View}`;
}

const defineGlobalTableOwner = <const View extends GlobalTableView>(
  view: View
): Readonly<GlobalTableOwner<View>> =>
  Object.freeze({
    view,
    identity: `global:${view}`,
  });

// Global table ownership is a property of the workspace/view, never of the
// changing set of cluster rows currently displayed by that view.
export const GLOBAL_TABLE_OWNERS = Object.freeze({
  clusters: defineGlobalTableOwner('clusters'),
  namespaces: defineGlobalTableOwner('namespaces'),
});
