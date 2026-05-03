/**
 * frontend/src/modules/object-map/objectMapCollapse.ts
 *
 * Collapses inactive ReplicaSets in the object-map payload. Default:
 * every RS that still owns Pods is rendered, while zero-Pod siblings
 * are hidden behind a +N badge. The user can expand a Deployment's
 * group via the badge to see all its RSs.
 *
 * The badge is attached to the RS owning the most Pods (lexicographic
 * name as tiebreaker). During rollouts this still shows every active
 * RS, so newly-created Pods are visible before they become Ready.
 *
 * Seed protection: any RS in the owner chain reachable from the seed
 * stays visible regardless of its "current" status, so opening an
 * old Pod doesn't accidentally hide its ancestor RS and disconnect
 * the chain.
 *
 * Frontend-only: no backend change is required because the payload
 * already carries owner edges (Deployment→RS, RS→Pod) — pod counts
 * fall out of `childrenOf(rs).size`.
 */

import type { ObjectMapEdge, ObjectMapNode } from '@core/refresh/types';

const REPLICASET_KIND = 'ReplicaSet';
const DEPLOYMENT_KIND = 'Deployment';

export interface DeploymentGroup {
  /** Stable id of the Deployment that owns these ReplicaSets. */
  deploymentId: string;
  /** Id of the chosen "current" RS for this Deployment. */
  currentRsId: string;
  /** All RS ids in this Deployment, ordered as discovered. */
  rsIds: string[];
  /** Ids of RSs that would be hidden if this group is collapsed. */
  collapsibleRsIds: string[];
}

export interface CollapseInfo {
  /** Set of node ids the renderer should include. */
  visibleNodeIds: Set<string>;
  /**
   * Maps a current-RS id to its Deployment group. Use for rendering
   * the +N / − badge on the current RS card.
   */
  groupsByCurrentRs: Map<string, DeploymentGroup>;
}

const buildOwnerMaps = (
  edges: ObjectMapEdge[]
): { ownerOf: Map<string, string>; childrenOf: Map<string, Set<string>> } => {
  const ownerOf = new Map<string, string>();
  const childrenOf = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (edge.type !== 'owner') return;
    ownerOf.set(edge.target, edge.source);
    let children = childrenOf.get(edge.source);
    if (!children) {
      children = new Set();
      childrenOf.set(edge.source, children);
    }
    children.add(edge.target);
  });
  return { ownerOf, childrenOf };
};

/**
 * Walk owner edges UPWARD from the seed and collect any ReplicaSet
 * encountered. Protecting only the ancestor chain — not descendants —
 * is critical: a Deployment seed has every RS as a descendant, and
 * protecting them all would defeat the collapse entirely. The case we
 * actually need to guard is "seed is a Pod owned by an old RS" —
 * hiding that RS would disconnect the chain.
 */
const findSeedAncestorReplicaSets = (
  seedId: string,
  ownerOf: Map<string, string>,
  isReplicaSet: (id: string) => boolean
): Set<string> => {
  const lineageRs = new Set<string>();
  const visited = new Set<string>();
  let current: string | undefined = seedId;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (isReplicaSet(current)) lineageRs.add(current);
    current = ownerOf.get(current);
  }
  return lineageRs;
};

const podChildCount = (
  rsId: string,
  childrenOf: Map<string, Set<string>>,
  nodesById: Map<string, ObjectMapNode>
): number => {
  let count = 0;
  childrenOf.get(rsId)?.forEach((childId) => {
    if (nodesById.get(childId)?.ref.kind === 'Pod') {
      count += 1;
    }
  });
  return count;
};

/**
 * Choose the current RS from a group. Heuristic: most owned Pods,
 * lexicographically larger name as a deterministic tiebreaker.
 */
const chooseCurrentRs = (
  rsIds: string[],
  childrenOf: Map<string, Set<string>>,
  nodesById: Map<string, ObjectMapNode>
): string | null => {
  let bestId: string | null = null;
  let bestCount = -1;
  let bestName = '';
  for (const rsId of rsIds) {
    const podCount = podChildCount(rsId, childrenOf, nodesById);
    const name = nodesById.get(rsId)?.ref.name ?? '';
    if (podCount > bestCount || (podCount === bestCount && name > bestName)) {
      bestCount = podCount;
      bestName = name;
      bestId = rsId;
    }
  }
  return bestId;
};

export const computeCollapseInfo = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  seedId: string,
  expandedDeploymentIds: ReadonlySet<string>
): CollapseInfo => {
  const nodesById = new Map<string, ObjectMapNode>();
  nodes.forEach((n) => nodesById.set(n.id, n));

  const replicaSetIds = new Set<string>();
  nodes.forEach((n) => {
    if (n.ref.kind === REPLICASET_KIND) replicaSetIds.add(n.id);
  });
  const isReplicaSet = (id: string) => replicaSetIds.has(id);

  const { ownerOf, childrenOf } = buildOwnerMaps(edges);

  // Group RSs by their owning Deployment. Standalone RSs (no
  // Deployment owner) get no group and stay visible as-is.
  const rsByDeployment = new Map<string, string[]>();
  replicaSetIds.forEach((rsId) => {
    const ownerId = ownerOf.get(rsId);
    if (!ownerId) return;
    const owner = nodesById.get(ownerId);
    if (!owner || owner.ref.kind !== DEPLOYMENT_KIND) return;
    let group = rsByDeployment.get(ownerId);
    if (!group) {
      group = [];
      rsByDeployment.set(ownerId, group);
    }
    group.push(rsId);
  });

  const seedLineageRs = findSeedAncestorReplicaSets(seedId, ownerOf, isReplicaSet);

  const hiddenRsIds = new Set<string>();
  const groupsByCurrentRs = new Map<string, DeploymentGroup>();

  rsByDeployment.forEach((rsIds, deploymentId) => {
    const currentRsId = chooseCurrentRs(rsIds, childrenOf, nodesById);
    if (!currentRsId) return;

    // Anything with owned Pods remains visible so rollout activity is
    // visible immediately. Zero-Pod siblings are collapsible unless
    // they are the current badge anchor or part of the seed lineage.
    const collapsibleRsIds: string[] = [];
    for (const rsId of rsIds) {
      if (rsId === currentRsId) continue;
      if (seedLineageRs.has(rsId)) continue;
      if (podChildCount(rsId, childrenOf, nodesById) > 0) continue;
      collapsibleRsIds.push(rsId);
    }

    if (collapsibleRsIds.length === 0) {
      // Nothing to collapse — don't render a badge for this group.
      return;
    }

    groupsByCurrentRs.set(currentRsId, {
      deploymentId,
      currentRsId,
      rsIds,
      collapsibleRsIds,
    });

    if (!expandedDeploymentIds.has(deploymentId)) {
      collapsibleRsIds.forEach((rsId) => hiddenRsIds.add(rsId));
    }
  });

  // Hide owner-chain descendants of every hidden RS — typically just
  // their (zero or near-zero) Pods. Don't hide the seed itself even
  // if it happens to be a descendant of a hidden RS (defensive; the
  // lineage protection above should already keep that RS visible).
  const hiddenDescendantIds = new Set<string>();
  hiddenRsIds.forEach((rsId) => {
    const queue: string[] = [rsId];
    for (let head = 0; head < queue.length; head += 1) {
      const u = queue[head];
      const children = childrenOf.get(u);
      if (!children) continue;
      children.forEach((c) => {
        if (c === seedId) return;
        if (hiddenDescendantIds.has(c)) return;
        hiddenDescendantIds.add(c);
        queue.push(c);
      });
    }
  });

  const visibleNodeIds = new Set<string>();
  nodes.forEach((n) => {
    if (hiddenRsIds.has(n.id)) return;
    if (hiddenDescendantIds.has(n.id)) return;
    visibleNodeIds.add(n.id);
  });

  return { visibleNodeIds, groupsByCurrentRs };
};

/**
 * Filter the snapshot's nodes/edges to the visible set. Edges whose
 * endpoints aren't both visible are dropped.
 */
export const filterByCollapseInfo = (
  nodes: ObjectMapNode[],
  edges: ObjectMapEdge[],
  visibleNodeIds: Set<string>
): { nodes: ObjectMapNode[]; edges: ObjectMapEdge[] } => ({
  nodes: nodes.filter((n) => visibleNodeIds.has(n.id)),
  edges: edges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)),
});
