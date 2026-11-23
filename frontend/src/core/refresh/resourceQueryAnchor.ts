import type { ResourceQueryAnchor } from './types';

export const appendAnchorParams = (params: URLSearchParams, anchor: ResourceQueryAnchor): void => {
  params.set('anchor.clusterId', anchor.clusterId);
  if (anchor.group) {
    params.set('anchor.group', anchor.group);
  }
  params.set('anchor.version', anchor.version);
  params.set('anchor.kind', anchor.kind);
  if (anchor.namespace) {
    params.set('anchor.namespace', anchor.namespace);
  }
  params.set('anchor.name', anchor.name);
  if (anchor.uid) {
    params.set('anchor.uid', anchor.uid);
  }
};

export const readAnchorParams = (params: URLSearchParams): ResourceQueryAnchor | undefined => {
  const clusterId = params.get('anchor.clusterId');
  const version = params.get('anchor.version');
  const kind = params.get('anchor.kind');
  const name = params.get('anchor.name');
  if (!clusterId || !version || !kind || !name) {
    return undefined;
  }
  return {
    clusterId,
    group: params.get('anchor.group') ?? '',
    version,
    kind,
    namespace: params.get('anchor.namespace') ?? undefined,
    name,
    uid: params.get('anchor.uid') ?? undefined,
  };
};
