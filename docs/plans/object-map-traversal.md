# Object map: directional edge traversal

## Problem (user-observed)

Open the object map for a Deployment. The map includes Pods owned by *unrelated* Deployments, plus those Deployments and their ReplicaSets. Trace shows the path:

```
Deployment "fusionauth" (seed, depth 0)
→ ReplicaSet (depth 1, owner)
→ Pod (depth 2, owner)
→ Node "ip-10-120-94-94" (depth 3, schedules)
→ OTHER Pod scheduled on the same Node (depth 4, schedules — reverse)
→ OTHER ReplicaSet (depth 5, owner — reverse)
→ OTHER Deployment (depth 6, owner — reverse)
```

The Node is acting as a hub: BFS reaches it via the seed's Pod, then walks back outward through every other Pod scheduled there. Same problem with shared `ServiceAccount` (especially `default`), shared `ConfigMap` (e.g. `kube-root-ca.crt`), shared `Secret`s (image pull secrets), shared `PersistentVolume`s. Any kind that's referenced by many consumers becomes a hub that pulls the entire cluster into the map.

## Cause

The BFS in `buildGraph` (`backend/refresh/snapshot/object_map.go`) adds every edge to the adjacency map *bidirectionally*:

```go
for _, edge := range allEdges {
    graph.adjacency[edge.Source] = append(graph.adjacency[edge.Source], edge.ID)
    graph.adjacency[edge.Target] = append(graph.adjacency[edge.Target], edge.ID)
    graph.edges[edge.ID] = edge
}
```

This treats every edge as undirected for traversal. That's correct for some edge types (you want owner edges traversed both directions to see ancestors and descendants) but wrong for others — `uses` / `mounts` / `storage` / `schedules` / `endpoint→target` are inherently consumer→resource directions and have no reverse meaning from the user's perspective.

## Proposed fix

Per-edge-type directional rule for adjacency. When building the adjacency map, decide for each edge type whether to add the reverse direction:

| Edge type   | Forward (consumer/source → resource/target) | Reverse (resource → consumer) | Notes                                                                                  |
| ----------- | :-----------------------------------------: | :---------------------------: | -------------------------------------------------------------------------------------- |
| `owner`     |                     ✅                      |              ✅               | We want both ancestors (Deployment from a Pod seed) and descendants (Pods from a Deployment seed). |
| `selector`  |                     ✅                      |              ✅               | Service → Pod and Pod → Service-that-selects-me are both meaningful.                   |
| `endpoint`  |                     ✅                      |              ✅               | Service → EndpointSlice → Pod path needs both directions.                              |
| `routes`    |                     ✅                      |              ✅               | Ingress → Service and Service → Ingress-routing-to-me.                                 |
| `scales`    |                     ✅                      |              ✅               | HPA → workload and workload → HPA-scaling-me.                                          |
| `uses`      |                     ✅                      |              ❌               | A Pod's view of "what CM/Secret/SA does it use" — not "what other Pods use this CM".   |
| `mounts`    |                     ✅                      |              ❌               | A Pod's PVC, not "what other Pods mount this PVC".                                     |
| `storage`   |                     ✅                      |              ❌               | PVC's bound PV, not "what other PVCs bind this PV" (rare but possible).                |
| `schedules` |                     ✅                      |              ❌               | A Pod's Node, not "what other Pods run on this Node". Main one bitten by user report.  |

Effect: leaf-resource hubs (Node, SA, CM, Secret, PV) still **appear** in the map (the forward edge from the seed's Pod still traverses to them) — they just stop the BFS from continuing outward through their other consumers.

## Where to change

`backend/refresh/snapshot/object_map.go`, in `buildGraph`. Roughly:

```go
// Whitelist of edge types where reverse traversal makes sense.
var bidirectionalEdgeTypes = map[string]bool{
    "owner":    true,
    "selector": true,
    "endpoint": true,
    "routes":   true,
    "scales":   true,
}

for _, edge := range allEdges {
    graph.adjacency[edge.Source] = append(graph.adjacency[edge.Source], edge.ID)
    if bidirectionalEdgeTypes[edge.Type] {
        graph.adjacency[edge.Target] = append(graph.adjacency[edge.Target], edge.ID)
    }
    graph.edges[edge.ID] = edge
}
```

Then the existing BFS loop (which walks adjacency) automatically respects the rule — no further changes needed in the traversal itself.

## Why this is the right shape

- It captures the semantic distinction between "I own / am owned by / front / am fronted by" (bidirectional relationships about identity and traffic) and "I use / am scheduled on / mount" (consumer→resource references that don't reverse meaningfully).
- It's expressed at the edge-type level, so adding a new tracer in the future requires one decision: bidirectional or not.
- Existing tests for owner/service/endpoint/scaling chains keep passing because those types stay bidirectional.

## Test updates

- New test: from a Deployment seed in a cluster with two Deployments scheduled on the same Node, confirm the second Deployment's Pods are NOT in the resulting graph.
- New test: shared ServiceAccount used by two unrelated workloads — confirm only the seed's chain reaches the SA, the other workload doesn't appear.
- Existing tests: should be unaffected because the test fixtures don't typically wire up shared infrastructure to trigger the reverse-traversal path.

## Frontend impact

None — the frontend rendering and layout already handle whatever node set the backend returns. The frontend will simply receive smaller, more focused graphs. The "ghost objects" the user reported are a downstream consequence of this same issue plus a now-fixed foreignObject scaling bug; with this change, those phantom unrelated objects will stop appearing in the data entirely.
