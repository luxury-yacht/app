# Feed cutover: one per-cluster feed for every kind

Status: **approved by John on 2026-10-20** with the recommended answers to
Q1–Q6, Q8, and Q9. Q7 is open: John names the dev cluster and decides on the
restricted kind cluster before any step that needs a cluster. Revised on
2026-10-21 for seven review findings across three rounds (§9.1). Nothing here is
implemented.

Evidence was gathered on `main` at `5ba6fd6f` (2026-10-20). Every `file:line`
was read during this review. Claims that were not proven are tagged
**[unverified]** or **[assumed]**.

This is finding #1 of the second app-wide design review. PR #399 unified change
signals. This plan unifies the **feeds**: how Kubernetes objects reach the
stores, tables, catalog, object map, and caches that consumers read.

## 1. Summary

Two feed technologies run side by side today:

- **Owned ingest reflectors** (`backend/refresh/ingest`) feed 27 kinds.
- **Shared client-go informers** (`backend/refresh/informer/factory.go`) feed 13
  kinds: Namespace, ReplicaSet, HPA, Event, CRD, and the eight Gateway API kinds.
  A label-filtered helm-storage informer also watches Helm release Secrets and
  ConfigMaps.

Consumers choose between the two with the kind registry's `IngestOwned` facet.
The second technology costs more than the NO-CUT comments weighed:

- **Duplicate watches.** HPA is watched three times and Gateway kinds twice.
  Helm release Secrets and ConfigMaps are watched twice (§3.3).
- **Two readiness models.** The informer factory holds back the refresh
  manager's start (the metrics poller, the manual queue, and the spill
  reconcile) and supplies the global sync gate. Ingest does neither (§4.5).
- **Resync churn.** Informer kinds replay every 15 s. Each replay re-projects
  the store, rewrites RS-owned pod bundles, and evicts the detail/YAML cache
  (§4.6).
- **No namespace scope.** Informer kinds stay cluster-wide under a namespace
  scope (`docs/architecture/namespace-scope.md:144-152`).
- **No warm restart.** Informer kinds get no spill or delta resume.
- **The shipped stale-row bug.** Gateway, HPA, CRD and Helm tables kept old rows
  until the next change (`docs/release/pending.md:17`). PR #399 fixed it in the
  informer path specifically.

**Recommendation: Option A.** Cut every remaining kind to owned reflectors, in
eight phases. Then delete the informer factory as a feed, along with the
`IngestOwned` facet. Phases 1–2 (Gateway, HPA) are small and independently
shippable, and they remove the duplicate watches.

## 2. Target model: one feed contract per cluster

Each cluster generation has exactly one feed: its `ingest.IngestManager`. Every
built-in kind, and every runtime-discovered kind the catalog promotes, reaches
consumers only through it. The contract, with the code that already implements
each part:

| Property | Contract | Current owner |
| --- | --- | --- |
| Initial list | One LIST+WATCH per source and partition, with WatchList disabled. A relist is delivered once, bracketed by `RelistBoundary`. | `ingest/manager.go:298-310`; `docs/architecture/data-layer.md:78-81`; `docs/architecture/data-freshness.md:158-163` |
| Apply, then deliver | Sinks run under the projecting store's write lock **after** the mutation, so any read that starts after a ring sees the change. There is one sink path for tables, catalog, object map, response cache, and derived rings. | `docs/architecture/data-layer.md:75-77`; `docs/architecture/data-freshness.md:134-147`; `querypage_typed.go:959-982` |
| Sinks never read back | A sink runs under its source store's write lock (`ingest/projecting_store.go:97-104`). It must not read that store: `RowsByIndex`, `Rows`, and `GetByKey` take the same lock (`:632-636`). A consumer that aggregates across objects keeps its own index, fed by its sink. Work that must touch another store goes through `AsyncBundleSink`, which delivers in order off the lock (`ingest/async_bundle_sink.go`). | `JobControllerOwnerIndex` (`snapshot/job_controller_owner_index.go:9-80`) |
| Bundle sinks get no previous row | `emitBundleUpsert` passes only the new bundle (`ingest/projecting_store.go:432-438`). A consumer that compares old and new keeps its own last-seen state. | — |
| A relist is a full replacement | During an unpartitioned relist, a `BundleReplacer` sink receives no `DeleteBundle` for vanished keys, only `ReplaceBundles` with the complete new set (`ingest/projecting_store.go:823-834`, `:866-876`). A replacer whose removals have side effects must diff its own previous set against the replacement and act on what vanished. Retiring a source, evicting, or requesting work are examples. Partition relists still deliver per-key deletes (`ingest/partition.go:39-45`). | Existing replacers have no per-object removal side effects: the catalog, Attention, maintained stores, the Job index, and the notifiers (`objectcatalog/ingest_source.go:257`, `cluster_attention.go:1401`, `querypage_typed.go:1046`, `job_controller_owner_index.go:67`) |
| Restore baseline | **New.** `RestoreBundles` loads spilled rows silently and does not fan them to sinks (`ingest/projecting_store.go:977-1018`). A delta resume then sends only later changes (`ingest/resume.go:35-41`). Restore runs after every sink is registered and before `Start` (`backend/refresh_setup.go:312-333`; `ingest/manager.go:733-763`). A sink that needs the full set, and has no spill of its own, opts in to a **baseline seed**. The seed is delivered under the store's write lock during restore, so it always precedes the first live delta. | Today only `NamespaceWorkloadTracker` re-reads rows after sync (`projecting_store.go:982-985`) |
| One synced signal | `HasSyncedFor` (liveness only) and `ResourceReadinessFor` / `PartitionReadinessFor` (data availability), with a 15 s deadline that degrades a source instead of blocking. Treating "no rows" as authoritative requires `Ready` partition readiness: `HasSyncedFor` counts a degrade as settled, and `RawHasSyncedFor` misses a denial after restore (§9.1). | `ingest/manager.go:812-866`, `:1082-1170`; `ingest/partition_readiness.go:16-48` |
| Permission-gated sources | Every partition is checked before launch. A denied partition is skipped and settled; it never 403-retries. | `ingest/manager.go:207-213`, `:609-627`; `system/manager.go:549-563` |
| Namespace-scoped partitions | Under a namespace scope, a namespaced kind runs one reflector per configured namespace. | `ingest/manager.go:257-265` |
| Presence-gated sources | **New.** A source exists only when the API serves its kind. Today the factory gates Gateway kinds per kind (`factory.go:326-349`); ingest does not (§3.3). | — |
| Projection at intake | Each source keeps only its projected `Bundle` halves (Table, Catalog, ObjectMap, Aggregate). Typed objects are dropped after projection. | `ingest/manager.go:408-449`; `system/ingest_projectors.go:34-49` |
| Warm restart | Spill bundles on Cold and resume the watch from the persisted RV. | `ingest/manager.go:711-763`; `ingest/resume.go`; `backend/refresh_spill.go:153-182` |

**End state:**

- No consumer asks which technology fed a kind.
- `IngestOwned`, `IngestOwnedGVRs`/`IngestOwnedDescriptors`, the informer values
  of `CatalogSource`, the `Informer`/`GatewayInformer` closures on stream
  descriptors, `objectmapnode.Collector.List`, `GatewayCollector`, and the
  sentinel `ingestAvailabilityIndexer` are deleted.
- So are `registerMaintainedHandlers` and `registerMaintainedInformerHandler`,
  and the typed `informer.Factory` as a source of objects.

## 3. Current state (verified inventory)

### 3.1 The `IngestOwned` facet

The brief counted 97 references in 24 files. The current count:

```
grep -rn -a IngestOwned --include='*.go' backend | grep -v ^backend/kind/ | grep -v ^backend/resources/ | grep -v _test.go
```

That command finds 49 references in 22 production files; 22 of the lines are
code, in 12 files. Most of the rest are comments that describe MIXED domains.

There are 13 kinds with `IngestOwned` unset:

- ReplicaSet
- Namespace
- HPA (descriptor identity v1)
- Event
- CRD
- the 8 Gateway kinds

All 13 are `DetailCacheable`.

Facet values come from each `backend/resources/<kind>/descriptor.go`, and the
registry lists them at `kind/kindregistry/registry.go:67-108`.

### 3.2 Branch sites: every consumer that selects a feed

| # | Site | Owned (ingest) side | Not-owned (informer) side | Kinds on the informer side | Fate |
| --- | --- | --- | --- | --- | --- |
| 1 | Catalog collect: `objectcatalog/collect.go:33-55`, `ingest_source.go:47-85` | `collectViaIngest`. It errors until `HasSyncedFor`, then serves `CatalogRows`. | `collectViaSharedInformer` (shared, Gateway, or apiext lister). Then dynamic CRD ingest. Then live LIST plus promotion. | RS, Namespace, HPA, Gateway ×8, CRD | Ingest is the only static source. The informer plans in `collection_plan.go:26-57` are deleted. |
| 2 | Catalog readiness keys: `objectcatalog/sync.go:604-630` | Waited on per GVR (`catalogStaticIngestGVRs`) | Informer-cache keys (`readsInformerCache`) | same as #1 | One ingest GVR list |
| 3 | Catalog watch: `objectcatalog/watch.go:354-386`, `:388-405`, `:462-490` | `SubscribeCatalogSink` for each owned GVR | `factory.ForResource` handlers. There is no permission check, so the call can lazily create an informer [unverified at runtime]. Gateway handlers are checked for permission but not presence. The CRD handler marks discovery stale. | RS, Namespace, HPA, Gateway, CRD | Sinks only. The discovery-stale hook moves to the CRD source's sink. |
| 4 | Object map: `refresh/snapshot/object_map.go:379-399`, `:435-455`, `:485-540`, `:684-718` | `collectIngestNodes` uses projected nodes with pre-resolved edges (`:1144-1155`). | Typed listers. Records hold `record.obj`. The HPA "managed" facts join reads `record.obj.(*autoscalingv2.HorizontalPodAutoscaler)` and requires `listedGVRs` (`:689-701`). | RS, HPA v2, Gateway ×8 (via `collectGatewayTyped`) | Ingest nodes only. HPA facts are carried on the projected node, and readiness comes from `HasSyncedFor`. |
| 5 | Table availability: `snapshot/stream_collectors.go:58-136` | The sentinel `ingestAvailabilityIndexer` when `StoreFor != nil` | `d.Informer(shared)` / `d.GatewayInformer(gateway)` indexers. These are gated by permission only, not presence. | GatewayClass, Gateway ×7, HPA | Availability comes from `Tracks`/`StoreFor`. The sentinel is deleted. |
| 6 | Table feed: `snapshot/querypage_typed.go:813-871`, `:874-912`, `:959-982` | `feedMaintainedFromIngest` (BundleSink, row-based derived rings) | `registerMaintainedHandlers` / `registerMaintainedInformerHandler`. These are informer handlers with object-based derived rings (`store_doorbell.go:105`) and reconcile sources taken from the informer indexer. | Gateway ×8, HPA; CRD and events through the second helper | Ingest feed only |
| 7 | Readiness hub: `system/ingest_hub.go:47-60`, `:85-140` | Owned keys go to the ingest store | Factory `ResourcesSettled`/`ResourceReadiness`. `HasSynced` is the factory alone. | all 13 | The hub is ingest-only. The global gate is redefined (Q1). |
| 8 | Permission scope: `system/manager.go:222-239` | Namespaced owned kinds fan out over the namespace scope | Checked cluster-wide | Events, HPA, RS, Gateway, helm | Every namespaced kind is scoped (Q5) |
| 9 | Projector registration: `system/ingest_projectors.go:34-49` | Catalog and ObjectMap projectors for owned kinds that have a Stream descriptor | none | — | Every registry kind |
| 10 | Response cache: `backend/refresh_response_cache_invalidation.go:63-83`, `:96-147`, `:237-264` | `AddCatalogSink` | `ForResource` informer handlers. They evict on every update, including resync echoes (`:206-232`; `response_cache_invalidation.go:47-77`). Helm eviction comes from the helm-storage informers. | all 13 + Helm | Sinks only |
| 11 | Dynamic CRD admission: `ingest/dynamic_crds.go:55-69` | — | Registry kinds with owned, shared, Gateway, or apiext sources are excluded from dynamic admission. | Gateway CRDs in practice | Becomes "is a registry kind" |

Domains that mix the two feeds without naming the facet:

- **`cluster-config`** (`cluster_config.go:89-96`): GatewayClass comes from an
  informer; StorageClass, IngressClass and the webhooks come from ingest.
- **`namespace-network`** (`namespace_network.go:138-154`): seven Gateway kinds
  come from informers; Service, EndpointSlice, Ingress and NetworkPolicy come
  from ingest.
- **`namespace-autoscaling`** (`namespace_autoscaling.go:140-145`) is informer
  only, with a literal `nil` ingest manager.
- **`namespace-workloads`**: the HPA lister is at `namespace_workloads.go:198`,
  and `listHPAs` at `:724-731`.
- **`cluster-overview`**: namespace and event listers, and its build gate is the
  namespace informer's `HasSynced` (`cluster_overview.go:233-251`).
- **`namespaces`**: namespace and event informers (`namespaces.go:297-346`);
  ingest workload and quota sinks (`:363-377`).
- **`cluster-attention`**: the events informer (`cluster_attention.go:1322-1348`).
- **Owner heals**: an RS informer handler next to a Job ingest sink
  (`resourcestream/owner_heals.go:38-53`).

### 3.3 Duplicate and orphan sources (new finding)

`NewIngestManager` builds a reflector for **every** stream descriptor, not only
owned ones (`ingest/manager.go:251-253`, `:271-289`). `Start` launches every
entry, filtered only by permission (`:563-578`, `:609-627`).

A scratch overlay test confirmed this without touching the repo:
`go test -overlay` of a probe in package `ingest`, run with fake clients. With a
Gateway client present, the manager builds **9 entries outside `IngestOwned`**:
`autoscaling/v1 horizontalpodautoscalers` plus all 8 Gateway resources. No
projector or sink consumes them (`system/ingest_projectors.go:35` loops owned
kinds only).

Resulting source counts per kind:

| Objects | Watches today |
| --- | --- |
| HPA | 3: factory v1 (`factory.go:259`), factory v2 (`:260-262`), and an orphan ingest v1 reflector |
| Gateway kinds | 2: the Gateway informer factory and an orphan ingest reflector |
| Helm release Secrets/ConfigMaps | 2: the owned Secrets/ConfigMaps reflectors, and the label-filtered helm-storage informers (`informer/helm_storage.go:39`, `:100-128`) |

Gateway presence is handled inconsistently:

- The Gateway client exists whenever **any** Gateway kind is served
  (`backend/cluster_runtime_clients.go:494-511`).
- The factory registers each kind only if `presence.Has(kind)`
  (`factory.go:326-349`). The ingest manager ignores presence.
- So on a partial Gateway install, for example without ListenerSet, ingest
  starts reflectors for unserved resources. **[unverified at runtime]** The
  likely outcome is LIST 404 retries until the 15 s degrade, then background
  retries.

The orphan entries also feed the catalog's watch-unavailable report
(`objectcatalog/health.go:19-35` via `ingest/partition_readiness.go:16-24`). For
HPA, the catalog reads its data from the informer but its availability from the
orphan ingest entry.

### 3.4 Informer-fed kinds and their consumers

| Kind | Source | Created without a permission check? | Consumers |
| --- | --- | --- | --- |
| Namespace | `factory.go:236-238` | No (`:697-719`) | `namespaces` domain lister plus doorbell handler (`namespaces.go:328-346`, `:460`); `cluster-overview` lister plus build gate (`cluster_overview.go:233-251`); catalog (CatalogShared); response cache |
| ReplicaSet | `factory.go:247` | **Yes** (403 → terminal, `:656-661`) | Pod projector owner lookup (`system/ingest_projectors.go:86-97`), which reads only `OwnerReferences`; pod owner heal handler with no echo filter (`resourcestream/owner_heals.go:40-48`, `:70-89`, `stream_registration_helpers.go:21-27`); object map (`replicaset/objectmapnode.go:16-33`, owner resolution `object_map.go:1158-1166`); catalog; response cache |
| HPA v1 | `factory.go:259` | **Yes** | `namespace-autoscaling` table (`hpa/streamdescriptor.go:32-34`); derived workload ring (`namespace_autoscaling.go:85-99`); workloads join, which reads `ScaleTargetRef` only (`namespace_workloads.go:198`, `:724-750`); catalog (v1 identity); response cache |
| HPA v2 | `factory.go:260-262` | No | Object map only (`hpa/objectmapnode.go:15-31`): conditions for status (`statusPresentation`, `hpa/model.go:58`), plus the facts join (`object_map.go:684-718`, `BuildFacts`, `hpa/model.go:32`) |
| Event | `factory.go:263-266` (exempt from the factory gate) | **Yes** | `cluster-events` (`cluster_events.go:106-131`), `namespace-events` (`namespace_events.go:89-114`), `object-events` with an extra indexer (`object_events.go:95-130`), namespace warning rollups (`namespaces.go:297-326`), `cluster-overview` recent events, `cluster-attention` (`cluster_attention.go:1322-1348`), response cache |
| CRD | `factory.go:268-273` | No | `cluster-crds` (`cluster_crds.go:79-118`); ingest dynamic definitions (`system/ingest_projectors.go:166-178`, `ingest/dynamic_definitions.go:22-47`); catalog collect, watch, and discovery-stale hook; response cache. The only schema read is `HasSchema` (`apiextensions/model.go:125-133`). |
| Gateway ×8 | `factory.go:320-351` (presence- and permission-gated) | No | `namespace-network` (7 kinds) and `cluster-config` (GatewayClass) tables; object map, whose status and edges read only the object itself (`gateway/objectmapnode.go:11-16`, `object_map.go:1144-1155`); catalog; response cache |
| Helm (Secrets + ConfigMaps, `owner=helm`) | `informer/helm_storage.go:100-128` | No (cluster-wide check) | `namespace-helm` re-aggregates and decodes on each Secret event (`namespace_helm.go:111-147`), with a decode cache of up to 4096 releases (`:42`) and no spill; Helm response-cache eviction from both informers (`refresh_response_cache_invalidation.go:237-264`) |

The informer factory, the apiext factory, the Gateway factory, and helm storage
all use `StripManagedFields` only (`informer/projection.go:26-44`). They hold
full objects: CRD schemas, RS pod templates, and Helm release payloads.

Outside this plan's scope: the per-session container-logs pod informer
(`refresh/containerlogsstream/streamer.go:538-566`) is part of a live log
session. That is a deliberate boundary in `docs/architecture/data-layer.md:203-210`.

## 4. Options

### 4.1 The options

- **A. Cut every remaining kind to owned reflectors.**
  - Generic `IngestOwned` flips for the 8 Gateway kinds and HPA.
  - Bespoke `RegisterReflector` projectors, the shape already used by 9 kinds
    (`system/ingest_projectors.go:94-161`), for ReplicaSet, CRD, Namespace and
    Event.
  - A Helm half on the existing Secrets/ConfigMaps bundles.
  - Delete the informer feed afterwards.
- **B. An adapter that presents the ingest contract over informers.**
  - Consumers read one interface (sinks, rows, readiness).
  - The informer kinds keep client-go informers underneath.
- **C. A mix.** A for kinds with a clear cost (Gateway, HPA, RS, CRD, Helm); B
  or a documented exception for the expensive or delicate ones (Event,
  Namespace).

### 4.2 Object map typed-cache reads

The NO-CUT rationale for Gateway (`factory.go:314-316`) says the object map
reads these objects from the typed cache. The object map already serves 23 kinds
from projected nodes with pre-resolved edges (`object_map.go:385-391`,
`:435-455`, `:1144-1155`).

Gateway, RS and HPA status, action facts and edges each read only their own
object:

- `gateway/objectmapnode.go:11-16`
- `replicaset/objectmapnode.go:16-33`
- `hpa/objectmapnode.go:15-31`
- each kind's `objectmapedges.go`

`NewNodeProjector(status, actionFacts, edges)` (`ingest_projectors.go:58-67`)
already builds these nodes at intake. It needs to accept the `GatewayCollector`
shape.

The one assembly-time typed read is the HPA "managed" join
(`object_map.go:684-718`). It needs:

- the HPA facts carried on the projected node;
- "complete set known" taken from `HasSyncedFor` instead of `listedGVRs`.

**Per option:**

- **A:** this is a bounded change.
- **B:** the same projection work is needed for the adapter to present nodes,
  so it saves nothing.
- **C:** same as A for Gateway, RS and HPA.

### 4.3 The three namespace NO-CUT reasons (`factory.go:219-235`)

1. **"No value" on memory.** True, since namespace objects are small. But that
   is the wrong test. The cost is a second readiness source for the
   `namespaces` and `cluster-overview` domains, which are the two Cold-entry
   gate domains (`docs/architecture/data-layer.md:143-157`). It also costs a
   catalog informer path, and AGENTS.md calls the domain "informer-backed".
2. **"No Stream descriptor."** Nine kinds without Stream descriptors are
   already bespoke reflectors (`system/ingest_projectors.go:94-161`). This is
   the normal shape, not a blocker.
3. **"Full typed object needed."** `BuildResourceModel` and `BuildFacts` take a
   `*corev1.Namespace` plus workload presence that is joined when the snapshot
   is served (`namespaces.go:499-544`). There are two options:
   - Retain a stripped namespace in the stored bundle. Pods already retain
     their Table half: `retainTable`, `ingest_projectors.go:91-95`.
   - Or project only the namespace's own fields, as Node does
     (`factory.go:194-200`).
   The comment's line citations are stale: it cites `namespaces.go:128-129/:144`,
   and the code is now at `:512-513` and `:522/:539`.

Scoped mode synthesizes rows from probes and never builds this informer
(`namespaces.go:333-339`, `:464-476`). That does not change.

**Per option:**

- **A:** handles all three.
- **B:** keeps the factory and the global gate alive for one tiny kind.

### 4.4 HPA v2 conditions

The table row is built from v1 but reads only fields that v2 also has: metadata,
`scaleTargetRef`, min/max, and `currentReplicas`. Its `Ref` already uses the v2
`Identity` (`hpa/streamsummary.go:22-37`, `identity.go:17-23`). The workloads
join reads only `ScaleTargetRef` (`namespace_workloads.go:736-750`).

So **one autoscaling/v2 reflector** can project all four outputs:

- the table row;
- an aggregate for the workloads join;
- an object-map node with conditions and status;
- the HPA facts.

That replaces three watches with one.

There is a keying catch. The descriptor identity is v1 (`hpa/descriptor.go:10`),
and every GVR-keyed lookup uses that identity: `IngestOwnedGVRs`, the hub's
key→GVR routing (`ingest_hub.go:55-57`), the catalog and response-cache sinks,
and `domainpermissions` (`spec.go:285`, `:335-336`). A v2 reflector entry would
be keyed `autoscaling/v2`, so none of those lookups would find it. Q2 settles
this before Phase 2 starts.

**Per option:**

- **A:** collapses the three watches.
- **B:** keeps two informers, or adapts both.

### 4.5 Cold start, readiness, and deadline-degrade

| | Informer factory | Ingest |
| --- | --- | --- |
| Per-source deadline | 15 s degrade (`factory.go:430-442`) | Same 15 s rule (`ingest/manager.go:838-866`) |
| Holds back `Manager.Start` | **Yes.** `hub.Start` waits for the factory to settle (`ingest_hub.go:68-80`, `factory.go:355-381`). Only then does `Manager.Start` start the metrics poller and the manual queue (`refresh/types.go:199-211`). After `Manager.Start` returns, the generation runs `ReconcileMaintainedStores` (`backend/refresh_generation.go:62`, `:84-93`). Activation itself does not wait, because the manager runs in a goroutine. | No |
| Global gate | `hub.HasSynced` is the factory alone (`ingest_hub.go:85-87`). Domains that declare no readiness keys wait on it (`snapshot/service.go:409-418`). So do `HealthHandler` (`system/manager.go:566-576`) and the response-cache warm-up guard (`refresh_response_cache_invalidation.go:53-58`). | Per-GVR only |
| Re-warm after Cold | Full re-LIST. Maintained stores reconcile from the informer indexer (`querypage_typed.go:864-869`, `:902-910`). Helm is not spilled. | Spill plus delta resume from the persisted RV; full sync on 410 |
| Permission | RS, HPA v1 and Events are created unconditionally and rely on 403 being terminal | Skipped before launch |

**Per option:**

- **A:** removes the factory-wide gate. Before that, every domain must declare
  readiness keys (Q1). The gate weakens as kinds leave the factory, so this is
  Phase 0 work, not cleanup.
- **B:** keeps both models.

### 4.6 Resync churn

Owned reflectors never resync (`ingest/manager.go:368`, `resyncDisabled`;
`docs/architecture/data-layer.md:97-100`). Informer kinds replay every 15 s
(`internal/config/config.go:33`). Each replay causes three kinds of work:

- **Store re-projection.** Every maintained-store handler re-projects and
  re-upserts. It skips only the ring.
- **RS heal rewrites.** The heal handler has no echo filter, so every 15 s it
  runs `RewriteBundlesByIndex` for each Deployment-owned ReplicaSet
  (`stream_registration_helpers.go:21-27`, `owner_heals.go:70-89`).
- **Detail-cache eviction.** Response-cache eviction runs on every echo
  (`refresh_response_cache_invalidation.go:206-232`; only a warm-up guard,
  `response_cache_invalidation.go:65`). Detail/YAML cache entries for these 13
  kinds therefore last at most about 15 s. **[inferred, not measured]**

**Per option:**

- **A:** removes all three.
- **B:** removes them only if the adapter disables resync, and then the
  informer's safety net is gone anyway.

### 4.7 Memory

No per-kind heap figures exist. **[unverified]**

The likely large holders, all full objects, are:

- CRDs: `openAPIV3Schema`, of which only `HasSchema` is read.
- ReplicaSets: pod templates, times the revision history.
- Helm release Secrets, plus up to 4096 decoded releases.
- Events.

Namespaces, HPAs and Gateway objects are small. **[assumed]**

Phase 0 measures this before any memory claim is made. **A** stores only
projections. **B** keeps full objects plus the projected rows.

### 4.8 Ordering

client-go runs each informer handler on its own goroutine
(`docs/architecture/data-freshness.md:137-140`). A handler also lags the
informer's own `HasSynced` (`querypage_typed.go:888-890`).

- **B** would need one sequential fan-out handler per informer. It still could
  not see relist boundaries: the initial list arrives as individual adds, and
  relists arrive as diffs.
- **A** inherits the single ordering rule as it stands.

### 4.9 Verdict

| Criterion | A | B | C |
| --- | --- | --- | --- |
| No consumer branching | Yes | Yes (behind the adapter) | Only with B for the leftovers |
| One LIST/WATCH per kind | Yes | No, unless the orphans are fixed separately | Partly |
| Namespace-scope support | Yes | No: needs N factories (`docs/architecture/namespace-scope.md:144-152`) | Partly |
| Spill / delta resume | Yes | No | Partly |
| Consistency (AGENTS.md) | One pattern | Adds a third shape | Two patterns remain |
| Effort and risk | Highest. Bespoke projectors for RS, CRD, Namespace, Event; CRD locking; event volume | Medium now, ongoing cost later | Medium |

**Recommend A.** C is the fallback for Events only, if Phase 7's spike shows
ingest is worse for them. If that happens, Events keep a documented exception
(no adapter) and John re-decides the target.

## 5. Non-goals

These are out of scope:

- **The query and delivery path.** No change to `querypage`, the Query→Page
  delivery, the signal transport, or frontend payload shapes. No frontend
  change is expected.
- **The live boundaries.** Detail/YAML live GETs, logs (including the
  per-session container-logs pod informer), shell, port-forward, metrics
  polling, and permission reviews (`docs/architecture/data-layer.md:203-210`)
  are untouched.
- **HPA identity.** HPA's published v1 vs v2 identity is not unified (Q2).
- **Table behavior.** No WatchList, no new dependencies, and no change to
  columns, sorting, filtering, or row content. Each migration must be
  byte-identical under `…MatchesListPath`.
- **Catalog dynamic sources.** Runtime-discovered sources stay as they are,
  apart from their CRD-definition input (Phase 5).

## 6. Phased checklist (dependency order)

Each behavior change runs red, then green, then refactor. Every phase ends with
its docs updated and §8 evidence recorded.

### Phase 0: guard rails and measurement

- [ ] Add a **feed-uniqueness test**: for every registry GVR, count the ingest
      entries plus factory registrations. It carries an allowlist of current
      duplicates (HPA ×3, Gateway ×2, Helm Secrets/ConfigMaps ×2). The
      allowlist must shrink in each phase and be empty at Phase 8.
- [ ] Add a **readiness-declaration test** over the production
      `domainRegistrations`: every domain declares readiness keys, or is
      explicitly listed as needing none. Fix the gaps it finds. Which domains
      are undeclared today is **[unverified]**.
- [ ] Measure the heap held by each informer cache on a dev cluster (Q7).
- [ ] Add **ingest presence gating**: build an entry only when discovery serves
      its GVR. Gateway uses `GatewayAPIPresence`; the CRD and discovery source
      is decided in Phase 5. Red test: a presence set without ListenerSet
      builds no ListenerSet entry and issues no LIST.
- [ ] Add the **restore baseline seed** (§2):
  - **Interface.** An optional `BundleSink` extension, `SeedBundles([]Bundle)`.
  - **Delivery.** `RestoreBundles` calls it under the store's write lock, with
    every restored bundle, after the rows and indexes are installed.
  - **Who opts in.** Only sinks that need the full set and have no spill of
    their own. Maintained-store sinks restore from their own spill
    (`backend/refresh_spill.go:141-152`), and live-notify sinks want deltas
    only, so neither opts in.
  - **Ordering.** Restore must precede `Start` (`ingest/manager.go:733-738`), so
    the seed precedes every live delta through the same lock. A failed restore
    or a 410 falls back to a full relist, which reaches the same consumers
    through `ReplaceBundles`. Every opted-in sink must therefore also implement
    `BundleReplacer`. If its removals have side effects, its `ReplaceBundles`
    must diff against its own previous set (§2, "A relist is a full
    replacement").
  - **Async sinks.** `AsyncBundleSink` gains ordered `seed` and `replace` queue
    events, so a seed reaches its wrapped sink before any later upsert. Today
    the wrapper forwards only upserts and deletes (`ingest/async_bundle_sink.go`).
- [ ] Fix the **existing gap** this exposes. `JobControllerOwnerIndex` is a
      bundle sink registered before restore (`system/manager.go:270`) with no
      spill of its own. After a re-warm with a valid RV and no Job changes, it
      stays empty. A Pod created afterwards for an existing CronJob-owned Job
      then projects with the Job as its controller, not the CronJob. The Job heal
      fires only on Job deliveries (`resourcestream/owner_heals.go:93-112`), so
      nothing repairs it. The code path is verified; the runtime symptom is
      **[unverified]**.
  - Red: a real-reflector re-warm test, with a spilled Job store, a resume from
    a valid RV, and no Job events. A new Pod must resolve to the CronJob.
  - Green: `JobControllerOwnerIndex` implements `SeedBundles`.

### Phase 1: Gateway API ×8 (generic flip)

- [ ] Red: add HTTPRoute and GatewayClass sources to the ingest-fed harness
      (`system/ingest_fed_doorbell_test.go:237-302` pattern, copied from
      `informer_fed_doorbell_test.go:465-498`): create, update, deletion
      requested, delete, and other scope quiet.
- [ ] Set `IngestOwned` on the 8 descriptors.
- [ ] Generalize `ingestObjectMapProjector` to the `GatewayCollector` status
      shape.
- [ ] Add a node-equivalence test: the projected node equals the typed
      collector's node for the same object.
- [ ] Add sink-path `MatchesListPath` tests for `cluster-config` GatewayClass and
      `namespace-network` routes.
- [ ] Delete `WithGatewayFactory` registration, the Gateway informer factory
      plumbing (`cluster_runtime_clients.go:506-511`, system `Config`, catalog
      deps), `GatewayInformer` closures, `collectGatewayTyped`,
      `registerGatewayWatchHandlers`, and `collectionSourceGatewayInformer`.
- [ ] Docs: update the kept list (`docs/architecture/data-layer.md:124-126`)
      and `docs/architecture/namespace-scope.md` (Gateway is now scoped).

### Phase 2: HPA (single v2 reflector)

- [ ] Red: an equivalence test showing the v2-projected `AutoscalingSummary`
      equals today's v1 `BuildStreamSummary` row for matching objects.
- [ ] Red: ingest-harness HPA source, including
      `TestHPAChangeRingsTargetWorkloadRows` moved from the informer harness.
- [ ] Apply Q2's identity decision first. Red test: the hub, catalog, and
      response-cache sink all resolve HPA to the reflector's GVR.
- [ ] Switch the stream descriptor to v2 with Table, ObjectMap (conditions plus
      HPA facts), and Aggregate (scale-target key) halves.
- [ ] Make the derived workload ring row-based instead of object-based
      (`namespace_autoscaling.go:85-99` becomes a `rowPublication.derived`
      function).
- [ ] `namespace-workloads` reads HPA aggregates from ingest and declares HPA
      readiness.
- [ ] **HPA knowledge requires actual data.**
  - **Rule.** `hpaKnown` is true only when **every partition covering the
    request reports `Ready`** in `PartitionReadinessFor`
    (`ingest/partition_readiness.go:16-48`). Covering partitions are the
    request's namespace partition under a scope, every partition for an
    all-namespaces request, and the `""` part when unscoped. Unscoped, this
    equals `ResourceReadinessFor == Ready`.
  - **Not `HasSyncedFor`.** It returns true after a deadline degrade
    (`ingest/manager.go:1093-1112`).
  - **Not `RawHasSyncedFor`.** It reports only `store.HasSynced()`
    (`:1147-1153`). Restore marks the store synced
    (`ingest/projecting_store.go:1011`) before `Start` applies the permission
    filter (`ingest/manager.go:609-627`). A restored baseline whose source is
    then denied would still read as synced.
  - **Why per partition.** `ResourceReadinessFor` checks skips first, but only
    when *every* part is skipped (`:1118-1127`). Under a namespace scope, one
    denied namespace is visible only per partition, where a skipped part
    reports `Unavailable` before `synced` is considered.
  - **Unknown states.** Pending, degraded, permission-skipped, and unavailable
    all leave `HPAManaged` unset (`namespace_workloads.go:398-402`). That
    matters because `hpaManaged === false` offers the ordinary Scale action,
    while an unset value offers none (`frontend/src/shared/actions/objectActionPolicy.ts:195-200`).
  - **Today's behavior has the same hole.** `hpaKnown` is `hpaErr == nil` over
    an informer that is created even without permission
    (`namespace_workloads.go:266-272`, `:724-731`; `factory.go:259`), so a
    denied or unsynced HPA source can report "not managed". The code path is
    verified; runtime is **[unverified]**. This needs a release note.
  - **Object map.** The facts join uses the same rule in place of `listedGVRs`
    (`object_map.go:688-691`).
  - **Red tests,** using a real reflector and the production workloads
    assembler:
    - deadline timeout with an empty store → `HPAManaged` unset;
    - permission skip → unset;
    - **restore, then denial.** A spilled HPA store (empty, or with rows) is
      restored, and the permission filter then denies the source at `Start` →
      unset. Run it unscoped and with one denied namespace under a scope. Also
      record whether the denied partition's restored rows are served by the
      HPA table; that current behavior is **[unverified]**, and serving them
      would be a separate defect to fix here;
    - degrade, then a later real sync → set, and the relist's derived ring
      reaches `namespace-workloads`.
- [ ] Delete the v1 and v2 informer registrations.

### Phase 3: ReplicaSet (bespoke reflector, Job precedent)

- [ ] Red: `TestReplicaSetHealRingsHealedPodScopes` (already in the ingest
      harness, `ingest_fed_doorbell_test.go:479`) is driven by an RS **reflector**
      change. Pod-owner equivalence follows the `pod_owner_heal_test.go` shape.
- [ ] Add an RS reflector with Catalog, ObjectMap, and Aggregate (RS→Deployment
      owner) halves.
- [ ] Replace `PodOwnerSources.ReplicaSets` with a `ReplicaSetOwnerIndex`
      BundleSink. The pod projector reads that index, never the RS store. This
      copies `JobControllerOwnerIndex` (`snapshot/job_controller_owner_index.go:9-80`).
      The index implements `SeedBundles` and `ReplaceBundles` (Phase 0). Red:
      after a re-warm with a valid RV and no RS events, a new Pod resolves to
      its Deployment.
- [ ] The RS heal becomes an async BundleSink, like `jobPodOwnerHealBundleSink`
      (`owner_heals.go:93-112`). It does not seed: restored Pods and ReplicaSets
      were spilled together, so the heal reacts only to changes.
- [ ] Object-map owner resolution must still find RS records by UID
      (`object_map.go:1158-1166`), because ingest nodes carry `Owners`
      (`:446-452`).
- [ ] Delete the RS informer.

### Phase 4: Helm storage

- [ ] Red tests, using a **real reflector** against the tracker API server and
      the production `namespace-helm` registration:
  - install, upgrade, rollback, and uninstall;
  - a revision moving between releases;
  - a relist that changes several releases at once rings each affected scope
    once, after commit;
  - a relist after a watch gap in which every revision of one release was
    deleted removes that release's row. The store sends this replacer no
    per-key deletes (§2), so the removal comes from the index diff;
  - a re-warm with a valid RV and no Secret changes still serves every
    unchanged release.
- [ ] Add a Helm revision Aggregate half to the Secrets bundle, decoded once at
      intake for `owner=helm` only. The ConfigMaps half carries only the
      eviction key.
- [ ] Re-aggregate releases from an **independent revision index**, not the
      store. Calling `RowsByIndex` from the sink would self-deadlock: the sink
      holds the Secrets store's write lock, and `RowsByIndex` takes its read
      lock (`ingest/projecting_store.go:97-104`, `:632-636`).
  - **Index.** The `namespace-helm` sink owns a map from release key to
    revision summaries, guarded by its own lock. The pattern is
    `JobControllerOwnerIndex`.
  - **Upserts and deletes.** Each one updates the index, then recomputes only
    the affected releases: the current one, plus the previous one when a
    revision moved. It writes the latest non-superseded revision into the
    maintained store. It rings after that store applies the row, which is
    allowed under the source lock (`docs/architecture/data-freshness.md:121-126`).
  - **Relists.** `ReplaceBundles` rebuilds the index from the complete set and
    diffs the releases. `RelistBoundary` rings each affected scope once at
    `EndRelist`.
  - **Restore.** `SeedBundles` (Phase 0) rebuilds the index and the release
    rows from the restored set without ringing.
  - **Why not async.** The rejected alternative is ordered async aggregation
    through `AsyncBundleSink`. It would also be correct, but it adds a queue
    hop and gains nothing, because the index holds everything aggregation
    reads.
- [ ] Helm response-cache eviction moves to the same sinks.
- [ ] Delete `HelmStorageSource` and its `CanClusterWide` gate. Update
      `docs/architecture/namespace-scope.md:34-35`.
- [ ] Fix the stale "resource-stream helm-refresh signal" comments
      (`factory.go:286-289`, `informer/helm_storage.go`), which describe a
      consumer that does not exist.

### Phase 5: CRDs

- [ ] Red tests, using a real reflector:
  - A CRD create gives a `cluster-crds` row and an admitted dynamic source.
    Delete retires the source.
  - Extend `TestCRDAddWaitsForEstablishmentBeforeRecollection`
    (`objectcatalog/discovery_invalidation_test.go:183`) and
    `TestCRDUpdatesRecollectOnlyWhenDiscoveryChanges` (`:102`) through the
    sink path:
    - an add that isn't established yet requests no collection;
    - a later **status-only** `Established` transition requests one;
    - an update that changes no discovery input requests none.
  - A re-warm with a valid RV and no CRD changes keeps every dynamic source
    admitted.
- [ ] Add a CRD reflector with:
  - Table half: `ClusterCRDEntry`.
  - Aggregate half: the compact **discovery and definition inputs**. These are
    UID, group, scope, `Spec.Names`, `Status.AcceptedNames`, served and storage
    versions, and the `Established` condition. They are exactly what
    `crdChangesDiscovery` compares (`objectcatalog/watch.go:282-292`) and what
    the dynamic admission needs.
  - Catalog half.
  - Schemas are dropped at intake. Only `HasSchema` per version survives, in
    the Table half.
- [ ] Dynamic definitions split into **synchronous publication** and
      **asynchronous lifecycle**. Today, admission reads the *current*
      definition from the informer store (`dynamic_definitions.go:103-124`).
      Discovery reads it the same way (`ReconcileDiscoveredResource`, `:77-86`),
      and the permission I/O runs after `definitions.mu` is released
      (`:88-99`). A delayed admission therefore can't restore an older
      definition (`TestDelayedPermissionCannotRestoreAnOlderCRD`,
      `dynamic_definitions_test.go:110-145`). A last-seen map maintained by an
      async worker would lose that guarantee. If the worker blocked on a
      permission check, a queued replacement or deletion would leave the map
      stale, and discovery could start another admission from it.
  - **Publication (synchronous).** On every upsert, delete, relist, and seed,
    the CRD sink publishes the latest compact definition into a
    `currentDefinitions` table, under the CRD store's write lock.
    - **Storage.** The table is an immutable copy-on-write map behind an
      `atomic.Pointer`. Readers never lock, and the sink never takes `m.mu` or
      `definitions.mu`.
    - **Deletion** removes the entry, so a deleted definition is gone from the
      table before any queued work runs.
  - **Lifecycle (asynchronous).** The sink enqueues a definition-changed or
    definition-deleted event on an ordered worker. The worker runs today's
    `reconcileCachedDefinition` / `RemoveCustomResourceDefinition`. Permission
    checks and reflector start or stop happen there, never under the store
    lock. This keeps `IngestManager.mu` a leaf lock, given the earlier ABBA
    deadlock between `store.mu` and `m.mu`.
  - **Revalidation.**
    - **Selection.** `prepareDefinitionAdmission` and discovery read the
      `currentDefinitions` table in place of `informer.GetStore().GetByKey`.
    - **Today's commit check.** It only confirms that the reservation is still
      the current one (`dynamic_sources.go:93`, `:149`). A newer
      `beginDynamicAdmission` call supersedes it, and so does a deletion
      (`dynamic_crds.go:76-80`).
    - **The gap.** With lifecycle on a queue, a replacement that is still
      waiting behind the blocked worker hasn't superseded anything yet.
    - **The fix.** `dynamicAdmissionNeedsReplacement` and `admitDynamicEntry`
      also compare the reservation's definition UID and spec against the
      table's current entry. That read is a lock-free atomic load, so `m.mu`
      stays a leaf lock. A definition that was superseded, or deleted, in the
      table never commits, even before its queued event runs.
  - **Baseline and relist.** `SeedBundles` and `ReplaceBundles` (Phase 0)
    publish the new table synchronously. During a relist the store sends this
    replacer no per-key deletes (§2), so `ReplaceBundles` diffs the **previous
    table** against the replacement set before swapping. The rule, keyed by
    CRD name:
    - **Vanished:** enqueue a definition-deleted event carrying the **old
      UID**. The worker retires that incarnation through
      `RemoveCustomResourceDefinition`, which matches on UID
      (`dynamic_crds.go:71-89`).
    - **Same name, new UID:** enqueue retirement of the old UID, then a
      reconcile for the new one.
    - **Present otherwise:** enqueue a reconcile. Reconciling an unchanged
      definition is cheap (`BenchmarkUnchangedCRDReconciliation`).
    - **Seed:** the previous table is empty, so a seed only enqueues reconciles.
  - **Relist red test** (real reflector):
    1. Admit two dynamic sources.
    2. Drop the watch, and delete one CRD while it is down, so its delete
       event is missed.
    3. Let the reflector relist without that CRD.
    The removed CRD's source must be cancelled and joined (`Tracks` false, no
    further list or watch). The surviving source must be untouched: same entry,
    no restart. A variant replaces a CRD with a new UID during the gap.
  - **Red tests,** extending `TestDelayedPermissionCannotRestoreAnOlderCRD`
    through the production CRD reflector and sink. While the worker is blocked
    inside the permission filter for the old definition:
    - a replacement arriving through the reflector is visible to
      `ReconcileDiscoveredResource` right away, and admits only the
      replacement's version;
    - a deletion queued behind the blocked worker makes discovery report the
      definition unknown and start no admission;
    - after release, the old admission never commits, and no dynamic action
      uses the old GVR.
- [ ] The catalog's discovery-stale hook (`watch.go:415-455`) moves to a CRD
      sink with its own last-seen map, keyed by UID, because bundle sinks
      receive no previous row (§2). `crdChangesDiscovery` becomes a comparison
      of two compact inputs. On a relist, it diffs its last-seen map against
      the replacement. A vanished or changed definition marks discovery stale
      and requests one full collection, the same work a delete does today.
      Covered by the relist red test above.
- [ ] Delete the apiext factory and the CRD `registerMaintainedInformerHandler`.

### Phase 6: Namespaces

- [ ] Red:
  - The ingest harness rings `namespaces` on create and delete.
  - `cluster-overview` and `namespaces` declare `core/namespaces` readiness,
    which routes to ingest.
  - Cold-entry preparation still requires both ready snapshots.
- [ ] Add a bespoke cluster-scoped reflector. It keeps either a stripped
      namespace or its own fields, plus a Catalog half. Workload presence
      stays a serve-time join.
- [ ] Move the namespaces doorbell and the `afterRing` hook to the sink. That
      sink only signals. Rows are read from the store when the snapshot is
      served, so no baseline seed is needed. The Phase 6 red tests include a
      re-warm with a valid RV and no changes, confirming the restored rows are
      served.
- [ ] Scoped mode is unchanged.
- [ ] Update AGENTS.md's "informer-backed" wording (Q6).

### Phase 7: Events (go/no-go after a spike)

- [ ] Spike: measure the relist cost and memory of an events reflector against
      the informer on a dev cluster. Stop here for John's decision.
- [ ] Add one events reflector whose bundle halves feed:
  - `cluster-events` and `namespace-events` (Table);
  - an `object-events` index on the involved object (`RowsByIndex`);
  - `cluster-attention`, the namespace warning rollup, and recent events for
    `cluster-overview` (Aggregate).
- [ ] Keep per-resource readiness. Ingest kinds are already excluded from the
      global gate.
- [ ] Declare a baseline for every consumer:
  - The `cluster-attention` index is a maintained store with its own spill and
    reconcile (`cluster_attention.go:757-764`, `:1286`). Its event reconcile
    source switches from the informer indexer to ingest rows; it is read
    outside any sink.
  - The `object-events` lookup and the warning rollups read the store when the
    snapshot is served, so they need no seed.
  - Any new sink-fed index implements `SeedBundles` and `ReplaceBundles`.
- [ ] Delete the events informer.

### Phase 8: delete the second technology

- [ ] Delete:
  - `IngestOwned` and its helpers, and the informer values of `CatalogSource`.
    Event exclusion stays in `objectcatalog/discovery.go:150-153`.
  - Stream `Informer` closures, `Collector.List`, `ingestAvailabilityIndexer`,
    `registerMaintainedHandlers`, `registerMaintainedInformerHandler`,
    object-based derived publication, `ingestInformerHub` (rename it), and the
    factory's object methods.
  - Keep permission tracking: `PermissionSnapshot` and `PrimePermissions`
    (`factory.go:741-829`) move to `refresh/permissions`.
  - `ReconcileMaintainedStores` and the `addReconcileSource*` hooks exist for
    informer-fed stores. Ingest stores sweep deletions on relist instead. Delete
    them if no other reconcile source remains. **[unverified]** Check every
    caller first.
- [ ] The feed-uniqueness allowlist is empty. A grep gate finds zero
      `IngestOwned` / `SharedInformerFactory` uses in `backend` production code.
- [ ] Docs:
  - `docs/architecture/data-layer.md` "two cutover shapes" and the kept list.
  - `docs/architecture/data-freshness.md:134-147` (the informer-handler wording).
  - `docs/architecture/namespace-scope.md` "Deliberately cluster-wide".
  - `docs/architecture/refresh-system.md`, and the `refresh-subsystem` /
    `add-resource` skill references.
  - Fix the stale comments `snapshot/namespace_quotas.go:96-100` and
    `system/ingest_projectors.go:36` ("only Pod").
- [ ] Delete this plan after moving any durable guidance into its owning docs.

## 7. Open questions (recommended answers first)

1. **What replaces the global sync gate?** Recommended:
   - Every domain declares readiness keys, enforced by the Phase 0 test.
   - Delete `hub.HasSynced`.
   - `HealthHandler` reports ingest `HasSynced` for non-on-demand entries.
   - The response-cache warm-up guard becomes per GVR.
   - The metrics poller starts without waiting on object caches. It polls the
     metrics API and reads no informer **[assumed; verify in Phase 0]**.
   - Every remaining informer-fed reconcile source must have synced before
     `ReconcileMaintainedStores` runs (`refresh_generation.go:84-93`). Today
     the factory wait guarantees that. Each phase must keep that guarantee until
     Phase 8 deletes the hook.
2. **Which HPA version does the reflector watch, and which identity keys it?**
   Recommended: watch v2 only, and make v2 the descriptor identity. v2 is the
   kind's primary served version (`hpa/identity.go:7-8`), and the table row's
   ref already uses it (`hpa/streamsummary.go:29`).

   Today the same HPA has two refs: the table uses v2, while the catalog,
   detail, response cache, and `domainpermissions` use v1. The cost of the
   change is any persisted v1 HPA ref, such as favorites or Attention ignore
   rules. Whether any exist is **[unverified]**; Phase 2 checks before
   switching.

   The alternative is to keep v1 as the identity and key the v2 reflector under
   it. That needs a special case in the manager, which this plan exists to
   remove.
3. **How is Helm fed?** Recommended: a bundle half on the existing
   Secrets/ConfigMaps reflectors. Entries are keyed by GVR
   (`ingest/manager.go:180`), so a second label-filtered Secrets entry can't be
   expressed without changing the manager.
4. **Are Events in scope?** Recommended: yes, as the last phase, behind the
   Phase 7 spike.
5. **Accept namespace-scope gains?** After the cutover, HPA, RS, Events,
   Gateway and Helm partition per namespace, so scoped identities can see them.
   Recommended: yes, with `docs/architecture/namespace-scope.md` updated in
   each phase.
6. **How should AGENTS.md describe namespaces?** Recommended: change
   "informer-backed" to "ingest-backed (owned reflector)", keeping the
   permission-gated, no-catalog-fallback contract word for word.
7. **Which clusters can be used?** Recommended: John names the dev cluster and
   kubeconfig for the Phase 0 measurement, the Phase 7 spike, and native
   evidence. Separately, John approves recreating the restricted kind cluster
   for the scope checks.
8. **Should the duplicate-watch fix ship first?** Recommended: yes. Phases 0
   (presence), 1, and 2 ship as standalone PRs.
9. **Should Helm be spilled?** Recommended: keep today's no-spill for the
   `namespace-helm` store. The Secrets ingest store spills its bundles anyway,
   so revisit only if warm-paint is wanted.

## 8. Validation

**Per-source freshness, with real owners.** Every migrated kind gets a source
in the ingest-fed harness (`system/ingest_fed_doorbell_test.go`), driven through
production registrations. The harness covers:

- create, update, deletion requested, and delete, plus another scope staying
  quiet (`:237-302`);
- a scoped relist that rings once (`:304-372`);
- overlapping relists (`:374-440`);
- an unsubscribed relist that serves no stale rows (`:516-528`).

Each new bespoke reflector also gets one test that goes through a real
`cache.Reflector` against the tracker API server (`ingest/manager_test.go:69-91`
pattern). That test proves a signal-triggered read sees the change. Each source
moves out of `informer_fed_doorbell_test.go` in the phase that cuts it.

**Restore baseline.** Every consumer that depends on a sink gets a
real-reflector re-warm test with a spilled store, a valid-RV resume, and **no
object changes**. The consumer must still see the full restored set. That
covers the Job owner index (Phase 0), the RS owner index, the Helm release rows,
the CRD definitions, and the discovery hook. One more test per phase checks the
fallback: an expired RV (410) forces a full relist that reaches the same
consumers through `ReplaceBundles`.

**Relist removals.** Every new replacer sink with removal side effects gets a
real-reflector test: an object is deleted during a watch gap, and the relist
omits it. The test checks that the side effect still happens and survivors are
untouched. This covers CRD source retirement, the discovery hook, and Helm
release rows.

**Readiness is not knowledge.** A decision that treats "no rows" as an
authoritative absence must not use `HasSyncedFor`, which is true after a
deadline degrade. `RawHasSyncedFor` isn't enough either, because restore marks
the store synced before the permission filter runs.

- **Rule for HPA.** `hpaKnown` and the object-map HPA join require `Ready`
  partition readiness for every partition the request covers (Phase 2).
- **Existing precedent.** `NamespaceWorkloadTracker` already reports a degraded
  store as `Degraded` (`namespace_tracker.go:77-84`). It deliberately counts a
  permission skip as `Ready`, and this plan leaves that unchanged.
- **Tests.** One test covers each state (pending, degraded, skipped, restore
  then denial), plus recovery.

**Byte identity.** `…MatchesListPath` sink variants cover every migrated table
domain. The Helm, HPA, and CRD equivalence tests are listed in their phases.
Object-map node equivalence covers Gateway, RS, and HPA.

**Red proof.** Each new test is shown failing against the pre-change code,
using a scratch `-overlay` or a copy/edit/restore. No `git stash` or checkout.

**data-freshness acceptance** (`docs/architecture/data-freshness.md:235-258`):

- Run the native app on the dev cluster from Q7 with each view open.
- Exercise create, update, and completed delete without a manual refresh, for:
  - HTTPRoute and GatewayClass;
  - HPA, including the workloads "HPA managed" flag and the object map warning;
  - a Deployment rollout (RS);
  - a Helm install, upgrade, and uninstall;
  - a CRD create and delete, including its CRs appearing in Browse;
  - a namespace create and delete;
  - a Warning event.
- Record which seams automated tests cover and which only native evidence
  covers.
- Under a namespace scope with a restricted identity, confirm the newly scoped
  kinds appear.

**Gates.**

- `mise exec -- wails3 task qc:prerelease`
- `test:backend-coverage` on the touched packages, with an 80% target
- complexity of 12 or lower on changed functions
- Sonar on each PR
- `qc:docs` for docs changes

## 9. Self-review

### 9.1 Review findings (2026-10-21)

A review after approval found four gaps. Each was checked against the code
before the plan changed.

1. **Helm aggregation would deadlock (P1).** The plan called `RowsByIndex` from
   a sink. The sink runs under the store's write lock, and `RowsByIndex` takes
   its read lock (`ingest/projecting_store.go:97-104`, `:632-636`). Fixed:
   Phase 4 aggregates from an independent revision index, and §2 states the
   no-read-back rule for every sink.
2. **New sink consumers had no restore baseline (P1).** `RestoreBundles` does
   not fan rows to sinks (`:977-985`). Restore runs after sinks register and
   before `Start` (`backend/refresh_setup.go:312-333`). A valid-RV resume then
   sends only later changes. Fixed with these changes:
   - Phase 0 adds an opt-in `SeedBundles` delivered during restore, plus
     re-warm tests per consumer.
   - The same gap already affects the shipped `JobControllerOwnerIndex`, which
     Phase 0 fixes first.
3. **HPA settlement must not mean knowledge (P1).** `HasSyncedFor` is true after
   a deadline degrade (`ingest/manager.go:1093-1112`). A `false` "HPA managed"
   offers ordinary scaling (`objectActionPolicy.ts:195-200`). The first draft
   also wrongly counted permission-skipped as known. Fixed: Phase 2 requires
   actual readiness, with tests for timeout, denial, and recovery; the second
   review (5 below) tightened this to partition readiness. The same hole exists
   today with the informer lister.
4. **CRD projection dropped discovery inputs (P2).** The discovery hook compares
   `Status.AcceptedNames` and `Established` (`objectcatalog/watch.go:282-292`).
   Bundle sinks receive no previous row. Fixed: Phase 5 keeps both fields,
   compares against a last-seen map, and extends the establishment tests
   through the sink path.

A second review on the revised plan found two more gaps, also verified first:

5. **Restore marks synced before the permission filter (P1).**
   - **Why `RawHasSyncedFor` fails.** It reports `store.HasSynced()` only
     (`ingest/manager.go:1147-1153`). `RestoreBundles` marks the store synced
     (`ingest/projecting_store.go:1011`) before `Start` applies the permission
     filter. So a restored baseline followed by a denial still read as known.
   - **Why `ResourceReadinessFor` alone fails.** It catches a denial only when
     every partition is skipped.
   - **Fixed.** Phase 2 requires `Ready` partition readiness for every
     partition the request covers. It adds a restore-then-denial regression
     test, run unscoped and with one denied namespace.
6. **An async definitions map can lag (P1).**
   - **The guarantee today.** Admission and discovery read the current
     definition from the informer store (`dynamic_definitions.go:77-124`).
     Permission I/O runs outside `definitions.mu`.
     `TestDelayedPermissionCannotRestoreAnOlderCRD`
     (`dynamic_definitions_test.go:110-145`) depends on the replacement being
     visible while the older admission is blocked.
   - **Fixed.** Phase 5 publishes the latest compact definition synchronously,
     under the CRD store lock, into a lock-free table. Lifecycle and permission
     work stay on an ordered worker. The commit check also compares against
     that table.
   - **Tests.** The delayed-permission test is extended through the production
     sink, with a blocked worker and a queued replacement or deletion.

A third review found one more gap, verified first:

7. **Relist removals never retired CRD sources (P1).**
   - **Cause.** During an unpartitioned relist, a `BundleReplacer` sink gets no
     `DeleteBundle` for vanished keys (`ingest/projecting_store.go:823-834`,
     `:866-876`). The plan rebuilt the definitions table from the new set and
     reconciled only what was present. A CRD deleted during a watch gap would
     leave the table, but its source would never reach the retirement path
     (`dynamic_crds.go:71-89`).
   - **Fixed.** Phase 5's `ReplaceBundles` diffs the previous table and queues
     retirement with the old UID. The discovery hook diffs the same way.
   - **Generalized.** §2 now states the rule for every replacer with removal
     side effects. A relist-removal test covers CRD retirement, the discovery
     hook, and Helm. The existing replacer sinks were checked, and none has a
     per-object removal side effect.

### 9.2 Adversarial pass

These are the points an adversarial pass checked. Each lists the remaining risk.

- **"Ingest runs orphan reflectors" is a construction-time proof.** It rests on
  the probe plus `Start`, which launches every entry. Actual API traffic and
  the 404 loop on a partial Gateway install were **not observed**. Phase 0 must
  confirm them with a request log before the release note claims a fix.
- **Memory claims are qualitative.** No figure appears in this plan, and none
  may appear in a PR without the Phase 0 measurement.
- **The 15 s detail-cache eviction is inferred** from code
  (`response_cache_invalidation.go:47-77` only skips warm-up). It has not been
  measured.
- **The readiness-gate change is the riskiest cross-layer edit.** Undeclared
  domains silently lose their wait as kinds leave the factory. That is why it
  is in Phase 0 and not Phase 8. A first draft also overstated the factory as
  blocking generation activation. It only holds back `Manager.Start` and the
  spill reconcile that follows it (§4.5).
- **CRD and dynamic-definition locking.** A sink runs under the CRD store lock
  and calls into `IngestManager`, which reacquires `m.mu`. The async sink is
  mandatory, not optional. A lock-order test is required.
- **Events can regress.** A churny, high-volume kind loses client-go's
  DeltaFIFO coalescing semantics if the projector is wrong. Phase 7 has an
  explicit stop.
- **HPA row equivalence.** Field-level evidence is strong
  (`hpa/streamsummary.go:22-37` reads no v1-only field), but the Phase 2
  equivalence test is what proves it.
- **HPA GVR keying.** A first draft missed that a v2 reflector falls out of
  every v1-keyed lookup (§4.4). Q2 and the Phase 2 red test now cover it.
  Other kinds whose stream GVR could differ from their descriptor identity
  should be checked the same way when they are cut.
- **Counts differ from the brief** (97/24 versus 49/22). The difference is
  explained in §3.1 with the command. The branch-site table is the
  authoritative list.
