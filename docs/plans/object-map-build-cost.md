# Object Map Build Cost

Temporary plan from the 2026-10-15 object-map review.

- **Order:** Phase 1 (the benchmark) can land any time. Phases 2-4 edit
  `object_map.go` and follow the backend phases of
  [object-map-graph-membership](object-map-graph-membership.md).
- **Status:** cost is code-traced, not measured. Phase 1 produces the numbers
  that justify, or cancel, the later phases.

## Decision

Build budget (John, 2026-10-15): one map build, object scope or namespace
scope, takes under 100 ms on the 10k-Pod synthetic cluster from Phase 1.

## Target Model

- A map build meets the budget above. It costs roughly in proportion to the
  objects in the scopes it reads, not to the whole cluster times the number of
  selectors.
- Catalog data is looked up when a relationship needs it, not copied in full
  on every build.
- Repeated polls of an unchanged cluster don't redo whole-cluster work. This
  part is trigger-gated: do it only if builds still miss the budget after
  Phases 2-3.

## Non-goals

- Persistent stores. SQLite is settled as trigger-gated.
- Changing the 5 s poll interval or the global snapshot cache TTL.
- Membership changes. Those belong to the graph-membership plan.

## Inventory

- **Catalog copy:** every build copies the whole catalog.
  `newObjectMapAssembler` calls `addCatalog`
  ([object_map_assembler.go:19](../../backend/refresh/snapshot/object_map_assembler.go)
  → [object_map.go:355](../../backend/refresh/snapshot/object_map.go)), which
  calls `objectcatalog.Service.Snapshot()`
  ([catalog_index.go:96](../../backend/objectcatalog/catalog_index.go)).
- **Indexed lookups already exist:** `FindExactMatch` and `FindByUID`
  ([lookup.go:19](../../backend/objectcatalog/lookup.go), `:46`).
- **Catalog-only records are lookup targets only.** Uses:
  - owner edges resolved by UID (`resolveOwner`);
  - link and core-reference targets;
  - never namespace-map members (`isNamespaceMapSupportedRecord`).
- **Eight direct index reads in five functions.** Every lookup that can land on
  a catalog-only record reads `byIdent` or `byUID` directly:
  - `findIdentity`, the seed lookup
    ([object_map.go:786](../../backend/refresh/snapshot/object_map.go));
  - `resolveOwner` (`:1262`, `:1270`);
  - `resolveCoreObjectRef` (`:1278`, `:1296`);
  - `recordForResourceLink` (`:1301`, `:1304`);
  - the `CoreRef` branch of `resolveEdgeTargets` (`:1389`).
- **Today's merge precedence is catalog first.** `addCatalog` runs before the
  typed collectors, and `mergeRecord`
  ([object_map.go:624](../../backend/refresh/snapshot/object_map.go)) fills
  only empty fields.
  - The catalog wins for `Resource`, `UID`, and `creationTimestamp`.
  - Typed and ingest records supply `status`, `actionFacts`, `owners`,
    `labels`, `obj`, `presented`, and `ingestEdges`, which catalog rows lack.
  - **A shared node id does not mean the same API version.** When a UID
    exists, the node id is only cluster + UID
    ([object_map.go:1460](../../backend/refresh/snapshot/object_map.go)).
    - So a catalog row and a typed record merge whenever their UIDs match,
      even if their group or version differ.
    - `mergeRecord` never reconciles group, version, kind, namespace, or name.
      The first record added keeps its ref, and today the catalog is added
      first.
    - `addRecord` then indexes only that ref's identity key (`:618`).
  - **HPA can hit this.** HPA declares two served identities, v2 and v1
    ([hpa/identity.go:15](../../backend/resources/hpa/identity.go)), and the
    object map collects it as v2.
    - The catalog records each group's server-preferred version, falling back
      to every served version
      ([discovery.go:129](../../backend/objectcatalog/discovery.go)).
    - When the catalog row is v1, the merged node carries v1, and a v2 seed or
      link lookup misses. The seed build then fails with "object-map seed not
      found".
    - Traced in code. Which clusters the app supports that prefer v1 while
      serving v2 is [unverified].
  - A differing UID means a different node id, so UIDs never merge across
    values.
  - Both sources format timestamps as RFC3339 UTC
    ([collect.go:425](../../backend/objectcatalog/collect.go), and
    `objectCreationTimestamp` in `object_map.go`).
  - Today's tests can't show precedence. The test catalog leaves
    `CreationTimestamp` empty
    ([object_map_test.go:115](../../backend/refresh/snapshot/object_map_test.go)).
- **Benchmark data sources differ by kind.**
  - Ingest-owned kinds, Pods and Nodes among them, are read from ingest
    projections, not informers (`collectTypedCollector`,
    [object_map.go:394](../../backend/refresh/snapshot/object_map.go)).
  - `newObjectMapTestBuilder` rebuilds its catalog on every `Build`
    ([object_map_test.go:104](../../backend/refresh/snapshot/object_map_test.go)),
    so it can't be timed as-is.
- **All edges are built on every build** (`buildAllEdges`,
  [object_map.go:1187](../../backend/refresh/snapshot/object_map.go)). Each
  selector scans every record:
  - `matchingPodsWhere` (`:1348`);
  - `endpointSlicesForService` (`:1361`);
  - `clusterRolesMatchingSelector` (`:1309`).
- **The cache rarely helps:**
  - The poll interval is 5000 ms
    ([policy_generated.go:135](../../backend/refresh/domain/policy_generated.go)).
  - The snapshot cache TTL is also 5 s
    ([config.go:64](../../backend/internal/config/config.go)).
  - Truncated snapshots are never cached
    ([service.go:555](../../backend/refresh/snapshot/service.go)).
- **ReplicaSets ignore namespace scope.** ReplicaSet is the only typed,
  non-ingest kind. Its collector path doesn't filter to the namespace scope
  (`addTypedCollectorItems`, `:418`), while the Gateway (`:528`) and HPA
  (`:569`) collectors do. The cost is extra projection; it has no visible
  effect.
- **No object-map benchmark exists.** The `qc:benchmark` task covers resource
  model benchmarks only ([Taskfile.yml:140](../../Taskfile.yml)).

## Phases

### Phase 1: Benchmark baseline

- [x] Add `BenchmarkObjectMapBuild` in `backend/refresh/snapshot`:
  - object scope for a Deployment seed, and namespace scope;
  - synthetic clusters with 1k, 10k, and 50k Pods, with Services, PDBs,
    NetworkPolicies, and EndpointSlices per namespace, plus catalog-only
    custom-resource rows.
- [x] Feed each kind from its production source, all built once before timing:
      - Ingest-owned kinds: a prebuilt `objectMapRowsProvider` whose rows are
        projected once with `objectmapnode.NewNodeProjector`, as
        `newFakeObjectMapIngestSource` does.
      - ReplicaSet, HPA v2, and Gateway API kinds: informer indexers populated
        directly, not fake clientsets.
      - Catalog: one `objectcatalog.Service` built once (`seedCatalogService`),
        with a Summary per object plus the catalog-only rows. The builder's
        `catalogService` returns that same instance.

      Don't reuse `newObjectMapTestBuilder`.
- [x] Assert the fixture before timing: row counts per GVR from the ingest
      source, the catalog count, and one untimed `Build` containing the seed
      and its Service.
- [x] Call `b.ResetTimer()` after setup. The timed loop calls only
      `builder.Build`, with no fixture construction inside it.
- [x] Add the benchmark to the `qc:benchmark` pattern. Record ns/op and
      allocs/op in this plan.

Baseline (2026-10-15, Apple M2 Max, `object_map_bench_test.go`). Synthetic
cluster:

- 100 Pods per namespace in 10 workloads, each with a Service, an
  EndpointSlice, a ConfigMap, and a Secret;
- per namespace: 2 PDBs, 2 NetworkPolicies, and 1 HPA;
- 1 Node per 50 Pods;
- 10 catalog-only custom-resource rows per namespace.

| Pods | Object scope | Namespace scope |
| --- | --- | --- |
| 1k | 13.9 ms, 14.0 MB | 14.4 ms, 11.7 MB |
| 10k | 760 ms, 126 MB | 759 ms, 98 MB |
| 50k (`OBJECT_MAP_BENCH_LARGE=1`, 1 run) | 23.2 s, 559 MB | 24.1 s, 435 MB |

At 10k Pods a build is 7.6× over the budget. Growth is superlinear: 10× the
Pods costs about 55× the time.

### Phase 2: Index selector targets per build

This is a refactor that keeps behavior the same. Existing tests guard it.

- [x] While adding records, index Pods by namespace, EndpointSlices by
      namespace and `kubernetes.io/service-name`, and ClusterRoles. Point the
      three scan helpers at these indexes.
- [x] Filter namespaced typed collector items to the namespace scope, matching
      Gateway and HPA. Extend the namespace-scope doc's object-map bullet.
- [x] Re-run the benchmark and record the delta.

Result (2026-10-15):

- At 10k Pods, a build went from 760 ms to about 116-120 ms (object scope) and
  115 ms (namespace scope). At 1k Pods it went from 14 ms to 9 ms.
- A pprof after the change shows the remaining cost is whole-cluster edge
  work:
  - `buildAllEdges` set inserts: 21%;
  - sorting every edge (`sortedObjectMapTraversalEdges`): 13%;
  - adjacency for all edges (`newSeedObjectMapGraph`): 9%;
  - GC: about 20%.
- The scope filter's red test is `TestObjectMapScopedCollectionFiltersReplicaSets`.

### Phase 3: Look up catalog rows on demand

Field precedence after this phase:

- When a typed or ingest record exists, it is the only source for every field
  of that node, including group and version. The payload ref is the identity
  the map collected. The catalog supplies only nodes that typed collection
  lacks, and then all of their fields.
- A UID names one object, whatever the served version. Any lookup that would
  materialize a catalog row whose UID already belongs to a record returns that
  record. It never creates or merges a second representation of the same
  object.
- That flips `Resource` and `creationTimestamp` from catalog-first to
  typed-first. It also flips `UID` when the catalog row has one and the typed
  record doesn't. Group and version become typed-first too, which fixes the
  HPA case in the Inventory.
- For real data this changes nothing visible. Both values describe the same
  immutable fields of the same object, in the same format (see Inventory). The
  typed record is the object the map projects.
- Keeping catalog-first would mean a catalog lookup for every typed record,
  which defeats this phase.

Steps:

- [x] Lock tests, added before removing `addCatalog`. They pass today and must
      stay green:
      - a catalog-only owner (a custom resource owning a ReplicaSet) keeps its
        `owner` edge;
      - a `CoreRef` target present only in the catalog (for example a ConfigMap
        a Pod's volume names) keeps its `uses` edge;
      - a catalog-only node carries the catalog's `Resource`, `UID`, and
        `creationTimestamp`.
- [x] Red: a precedence test with differing inputs. It fails today because the
      catalog wins. For the same node id, the catalog row and the typed or
      ingest record carry different `Resource` and `creationTimestamp` values,
      and the payload node carries the typed values.
- [x] Red: a served-version test. It fails today, as traced in the Inventory.
      The catalog has an `autoscaling/v1` HPA row and the informer has the
      same object as `autoscaling/v2`, with the same UID. The test expects:
      - a v2-seeded map builds, and its node ref says v2;
      - an `autoscaling/v1` identity lookup through the new boundary resolves
        to that same node, with no second node for the UID.
- [x] Green: add one lookup boundary with two methods, by UID and by identity.
      Each checks the typed index first, then materializes a record from
      `FindByUID` or `FindExactMatch`. Before materializing a catalog row, it
      returns any existing record with that row's UID.
      - Route all eight reads listed in the inventory through it.
      - No other code reads `byIdent` or `byUID` directly, except `addRecord`,
        which writes them.
      - Remove `addCatalog`.
- [x] Update the workflow doc's "Snapshot assembly seeds catalog records"
      bullet with this precedence.
- [x] Re-run the benchmark.

Result (2026-10-15):

- The lock tests (`TestObjectMapCatalogOnlyOwnerKeepsOwnerEdge`,
  `TestObjectMapCatalogOnlyCoreRefTargetKeepsEdge`) stayed green.
- The red tests (`TestObjectMapCollectedRecordFieldsWinOverCatalog`,
  `TestObjectMapServedVersionsResolveToOneNode`) failed as traced, then
  passed.
- `mergeRecord` is removed. After this change, collected kinds never produce
  the same node id twice.
- At 10k Pods: object scope 117 ms, namespace scope 100 ms, with allocations
  down about 10%. That is still over budget, so Phase 4 is triggered.

### Phase 4: Trigger-gated

Do this phase only if the Phase 3 numbers still miss the 100 ms budget at 10k
Pods. If both scopes meet it, close the plan after Phase 3.

- [ ] Resolve edges only for records reached by traversal. Use reverse
      indexes: owner UID to children, target identity to link sources, and
      namespace to selector sources.
- [ ] Or reuse one index per cluster across scopes and polls, invalidated by
      source versions.
- [x] Pick one option based on the profile, and write the decision here before
      coding.

Decision (2026-10-15). A pprof at 10k Pods after Phase 3 shows Build CPU
split as:

- `buildAllEdges`: 41% (edge-set inserts 21%, target resolution 15%);
- sorting every cluster edge (`sortedObjectMapTraversalEdges`): 24%;
- adjacency plus an edge map over every edge (`newSeedObjectMapGraph`): 21%;
- collection: 10%.

Neither listed option is chosen yet:

- Reachable-only resolution needs a reverse resolver for every edge type.
- Cross-poll reuse needs an invalidation signal across ingest, informers, and
  the catalog.

First, remove the global per-build work the traversal doesn't need:

- [x] Sort each node's adjacency when traversal first expands it, instead of
      sorting every edge. Same comparator, so the visit order is identical.
- [x] Hold adjacency by edge index, and collect the final edges from the
      included nodes' adjacency instead of re-scanning every edge.
- [x] Namespace scope: replace the repeated all-edge fixpoint passes with a
      breadth-first expansion over adjacency, under the same rules.
- [x] Prove byte-identical payloads against golden output captured before the
      change, for object and namespace seeds, including truncated ones.
- [x] If either scope still misses 100 ms at 10k Pods, take one of the two
      options above. Not needed: both scopes meet the budget.

Result (2026-10-15):

- `object_map_adjacency.go` holds the per-node index.
- A temporary golden test, since deleted, dumped 12 payloads before and after
  the change: object seeds (Deployment, Service, Pod, Node, ConfigMap,
  ReplicaSet at depth 6, PDB) and namespace seeds, three of them truncated.
  `diff -r` reports them byte-identical.

| Pods | Object scope | Namespace scope |
| --- | --- | --- |
| 1k | 5.6 ms, 9.2 MB | 5.9 ms, 10.0 MB |
| 10k | 71 ms, 87 MB | 71 ms, 88 MB |
| 50k (3 runs) | 455 ms, 395 MB | 466 ms, 396 MB |

Against the baseline: 10.7× faster at 10k Pods and 51× faster at 50k. Both
scopes are inside the 100 ms budget.

## Open Questions

None. See Decision.

## Validation

- `go test ./backend/refresh/snapshot -run ObjectMap`, plus `-race` on the
  package.
- Before and after benchmark numbers recorded in this plan, compared with the
  100 ms budget at 10k Pods.
- `mise exec -- wails3 task qc:prerelease`.
- App check on a large dev-stg cluster with the Map tab open: watch CPU before
  and after.
