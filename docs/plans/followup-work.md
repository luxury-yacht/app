P0 — Blockers

1. ✅ Snapshot requests can hang forever — backend/refresh/snapshot/service.go:209 — new sync gate polls a factory-wide one-shot HasSynced with no deadline anywhere in the chain; one never-syncing informer (e.g.
   namespace-scoped RBAC user → Forbidden Secrets watch) hangs every snapshot for that cluster; cluster never reaches Ready, no error shown.
   FIXED: waitForInformerSync now bounded by config.RefreshInformerSyncTimeout (30s); timeout returns errInformerSyncTimeout (→ HTTP 500 with message) and records failure telemetry; poll interval unified on config.RefreshInformerSyncPollInterval.
2. ✅ Streamed changes never reach 10 query-backed views — frontend/src/core/refresh/streaming/resourceStreamManager.ts:746 — row updates don't bump version/checksum, queries refetch only on that version, and a
   healthy stream disables snapshot polls; cluster rbac/storage/config/crds + namespace config/network/rbac/storage/autoscaling/quotas go stale until manual refresh.
   FIXED: applyRowUpdates bumps a new DomainSnapshotState.streamRevision on real row changes; liveDomainVersion includes it as a third identity component (timestamps still excluded — no churn).
3. ✅ Errors render as "No data available" — frontend/src/modules/resource-grid/ResourceInventoryTable.tsx:105 — render.error is rendered nowhere; ~14 of 17 query-backed views show a generic empty table on
   permission/query failure (regression vs main on cluster views; only NsViewPods/Workloads escape).
   FIXED: ResourceInventoryTable renders a role="alert" error banner from render.error (all views inherit it; per-view duplicate banners removed); errored empty tables say "Unable to load data"; hasLoaded accounts for errors so they can't hide behind the boundary spinner.
4. ✅ Replay cache masks persistent failures and is never evicted — frontend/src/modules/resource-grid/useResourceInventoryTable.ts:196 — any zero-row error replays cached rows as healthy "ready" forever; cache
   survives cluster close, replays prior-session rows on reopen, grows unbounded (reset is test-only).
   FIXED: errors surface after a 5s grace while cached rows stay visible (immediately when nothing to show); cache is LRU-capped at 64 entries, evicted per cluster on the new refresh:cluster-pruned event (emitted by orchestrator prune), and cleared on kubeconfig:changing.
5. ✅ Persisted namespace filters destroyed — frontend/src/modules/resource-grid/queryBackedTableState.ts:99 (+ write-back at useResourceGridTable.tsx:337) — a cluster blip or tab switch-back while an
   all-namespaces view is mounted empties the option list, clears the selection, and persists the wipe.
   FIXED: an empty option list (availability unknown) now preserves the selection identity-stable, so the write-back effect persists nothing.
6. ✅ Failed page-nav latches pagination — frontend/src/modules/resource-grid/useTypedResourceQuery.ts:304 — requestToken never rolls back: retry is a same-value no-op with isRequestingMore stuck true (both
   buttons disabled); next live refetch reuses the stale cursor and renders page 2 labeled page 1; retry-then-refetch corrupts previousTokens. (Empirically reproduced.)
   FIXED: pendingNavigation carries a revertToken; all three failure paths roll requestToken back (current page refetches, retry issues a real fetch, previousTokens stay consistent); catch path now also identity-guarded.

P1 — Major

7. ✅ Kinds multi-select collapses to the selected kind — useResourceGridTable.tsx:425 + typed_table_query.go (facets computed post-kind-filter) — 8 views visibly affected; namespaces have a protective merge,
   kinds don't.
   FIXED: queryBackedNamespaceFilterOptions generalized to queryBackedFacetFilterOptions and applied to kinds — the static per-view kind vocabulary wins over collapsed facets, mirroring namespaces.
8. ✅ Default sort dropped on every NsView — useResourceGridTable.tsx:105 — defaultSort.key never forwarded; queries go out unsorted, no header arrow anywhere; NsViewEvents shows name-asc instead of newest-first.
   Test passes only because the inner hook is mocked.
   FIXED: useNamespaceResourceGridTable forwards defaultSortKey; unmocked test pins sortConfig + onTableStateChange publication.
9. ✅ ClusterViewCustom shows a false "Name ↑" arrow — ClusterViewCustom.tsx:205 — sortConfig null → backend kind-grouped default order under a lit name-ascending indicator (NsViewCustom is unaffected).
   FIXED: persistence sortConfig defaults to name-asc (the same default the binding displays), so the catalog query and the header arrow agree — matching NsViewCustom's seed.
10. ✅ PodsTab metrics read the wrong cluster — PodsTab.tsx:74 — banner and per-pod staleness come from the globally selected cluster while rows query the panel object's cluster; violates the clusterId critical
    rule; the deleted hook's payload-scoped metrics are still produced but unread.
    FIXED: the typed query now exposes its payload (queryPayload through the wrapper); PodsTab reads payload.metrics — same snapshot as the rows, same cluster; global metrics hook removed from the panel.
11. ✅ Custom views' error channel severed — useBrowseCatalog.ts:464 → useCatalogBackedCustomResourceRows.ts:73 → error: null hardcoded — first-load failure spins forever; mid-session failure silently freezes the
    page.
    FIXED: useBrowseCatalog exposes error (domain.error + page-nav failures); plumbed through useCatalogBackedCustomResourceRows into both Custom views' sources AND BrowseView; renders via the P0-3 wrapper banner.
12. ✅ Custom views auto-advance pages on scroll — ClusterViewCustom.tsx:295 / NsViewCustom.tsx:334 — {...pagination} without autoLoadMore={false} arms the scroll sentinel on page-replacing cursor pagination;
    chains pages; advances with no scroll on short pages.
    FIXED: the shared pagination object carries autoLoadMore: false.
13. ✅ Custom views still cold-spin on revisit — same files (no cacheKey; rows die with the hook) — contradicts the release-note "every table" claim.
    FIXED: cluster-custom/namespace-custom sources carry cacheKeys ('|'-segmented for the P0-4 cluster eviction).
14. ✅ Custom filter banner shows "N of N" — unfilteredTotal returned by useBrowseCatalog.ts:615 but never plumbed; useGridTableFiltersWiring.tsx:265 falls back to the filtered total.
    FIXED: unfilteredTotal plumbed through useCatalogBackedCustomResourceRows into both Custom views' filterOptions.
15. ✅ Export-all silently truncates with a success toast — useTypedResourceQuery.ts:345 + useBrowseCatalog.ts:576 — any failed page breaks the walk (orchestrator never rethrows); partial/header-only CSV saved as
    success; same for clipboard "all" scope.
    FIXED: both fetchAllRows walks throw on blocked/missing pages (and on a non-advancing cursor); the Copy/Export actions already surface rejections as error feedback.
16. ✅ Collector re-sorts the whole buffer per row — typed_table_query.go:286 — full sort.SliceStable per Add with allocating, undecorated comparators (fmt.Sprintf/metric re-parse per comparison at :452, matchers
    rebuilt per row at :330); ~100× the work of one sort at 100k pods, per tick and per keystroke; no benchmark covers it.
    FIXED: prebuilt per-query matcher, decorated (value,key) candidates, sorted bounded insert with O(1) out-of-window reject; apply path decorates once + binary-search cursor boundary. Parity pinned by a characterization test; new benchmark: collector at 100k pods 524ms→15ms (name) / 1.93s→21ms (cpu, 52M→400k allocs).
17. ✅ Catalog index rebuilt from scratch per publish — catalog_index.go:229 — every initial-sync emit (quadratic for dynamic types) and every 200ms watch flush re-sorts and re-indexes all N items, with Browse
    closed; the benchmark excludes this via b.StopTimer().
    FIXED: query index (and the watch-flush sort) built lazily on first query, memoized until the next publish; per-query index clones removed; emit shares immutable chunk pointers instead of deep-copying. New publish benchmark: 231ms→37ms per flush at 100k (1.46M→542 allocs). Also repaired the broken churn benchmark (svc.items was never populated).
18. ✅ No search debounce on typed queries — useTypedResourceQuery.ts:227 chain — every keystroke runs a full backend build (Browse debounces at 250ms); out-of-order guard exists so it's waste, not wrong rows.
    FIXED: 250ms search debounce mirroring Browse (seeded so persisted searches fire immediately; only the search string is deferred).
19. ✅ Catalog has no permission signal — backend/objectcatalog/collect.go:245 — Forbidden lists are skipped with a debug log and a healthy return; an RBAC-blocked catalog is indistinguishable from an empty
    cluster (root cause beneath #11's "No custom objects found").
    FIXED: Forbidden lists are recorded per sync (reset on each sync start), exposed via HealthStatus.DeniedResources, and surfaced as a "Catalog permissions" issue → existing partialDataLabel on Browse/Custom.

P2 — Moderate

20. ✅ Object-panel pods windows retained until cluster close — useQueryBackedResourceGridTable.ts:208 lease + pods absent from every cleanup list — one uncapped window snapshot per workload/node ever visited
    (main reset on unmount).
    FIXED: getObjectPanelScopeEvictions now includes the pods window scope (workload:/node:, same builder the wrapper subscribes), so closing the panel evicts it like the other five panel domains.
21. ✅ Age sort inverted between catalog and typed tables — backend/objectcatalog/helpers.go:236 — Age-ascending = oldest-first in Browse/Custom, newest-first everywhere else; identical gesture, opposite
    chronology.
    FIXED: the catalog comparator flips the age field's effective direction (asc = newest first), matching typed tables; one ordering authority covers page sorts and keyset cursor walks.
22. ✅ Previous-page dead end in Browse — backend/objectcatalog/query.go:307 — predecessors deleted → empty page, no tokens, no cursorInvalid; static fallback clamps to page 1 instead; self-heals only on the next
    catalog event.
    FIXED: an empty previous page (predecessors deleted) reports cursorInvalid; the frontend's existing handling resets to page 1 immediately.
23. ✅ Export walk is O(pages × full backend scan), uncapped — useTypedResourceQuery.ts:325 — 100k-row export ≈ 100 full builds; catalog export pages at 1000 vs the 10000 the backend accepts (10× extra scans);
    full CSV string held in memory.
    PARTIALLY FIXED: catalog export now pages at the backend max (10000, was 1000 → 10× fewer scans); item 16 cut per-scan cost ~10-90×; typed export already used its backend max. The full-CSV-in-memory model is unchanged (see P3 #49 class).
24. ✅ 13 families materialize + full-sort the entire set per request — e.g. namespace_events.go:161, cluster_events.go:142 (which models every event before discarding non-cluster-scoped) — events cardinality
    makes this the worst; right fix is one shared bounded top-K insert.
    FIXED (worst offenders): both events families now stream rows through the shared bounded collector (item 16's engine — the prescribed top-K insert), and cluster events skip namespaced events BEFORE building the resource model. The remaining 11 families use the now-decorated single sort (item 16) — the shared engine exists for converting them as needed.
25. ✅ No in-flight indicator on user sort/search — useQueryBackedResourceGridTable.ts:93 — controller's refresh overlay exists but is starved (loading forced false with rows visible); sort arrow flips before
    data; stale counts shown meanwhile.
    FIXED: the typed query exposes resetPending (user-initiated filter/sort/page-size changes + search debounce); rows-visible user refetches now drive the controller's refresh overlay, while background live refetches stay silent (anti-flicker contract preserved).
26. ✅ Duplicate stale-filters fetch on hydration commit — useQueryBackedResourceGridTable.ts:228 — queryEnabled flips a render before hydrated filters publish; fetch #1 (wrong filters) executes and is discarded.
    (Empirically reproduced; narrow trigger.)
    FIXED: tableStateReady is only set by post-hydration publishes (the publish effect now re-fires on hydration commit), so the first query always carries the hydrated filters — fetch #1 never happens.
27. ✅ Single-namespace error copy says "All Namespaces …" — labels hardcoded in all 10 NsViews (e.g. NsViewConfig.tsx:147), rendered in NsViewPods/Workloads error banners; latent in the other eight.
    FIXED: all 10 NsViews pass their namespace-aware label (the diagnosticsLabel) as the query label, so error copy says "Namespace X …" for single namespaces.
28. ✅ Events views lost stream-latency delivery — eventStreamManager.ts:699 — streamed events can't trigger refetch; ~3s poll lag vs immediate on main; SSE stream is dead weight for row delivery, and typed-query
    scopes can churn the singleton events SSE connection (orchestrator.ts:567 shouldStreamScope only filters resource-stream domains).
    FIXED: the events stream manager bumps streamRevision on deliveries (typed events queries refetch at stream latency), and shouldStreamScope rejects ?-parameterized one-shot scopes for ALL domains so typed queries can no longer churn the singleton events SSE.
29. ✅ Unknown sort field silently name-sorts under a lit arrow — static_table_query.go adapters' default: return row.Name; published sortable-fields capability consumed by nothing; conformance test only checks
    non-emptiness. Three unlinked places must stay in lockstep per new column.
    FIXED: typedQueryEnvelope validates the requested sort field against the published SortableFields capability and surfaces a "Catalog/Sort" issue when unsupported — the capability finally has a real consumer; withDegraded/withIssues now append instead of clobbering.
30. ✅ nodes.go discards the query-scope parse error — nodes.go:248 — lone outlier of 16 call sites; malformed query silently serves defaults under the requested identity (unreachable from the shipped frontend,
    but a boundary contract hole).
    FIXED: buildNodeSnapshot(FromUsage) returns the parse error; both Build paths propagate it like the other 15 call sites.
31. ✅ Release note "every resource table has Copy · Export" unmet — object-panel JobsTab is Copy-only; object-panel EventsTab has no actions at all.
    FIXED: JobsTab gets fetchAllRows + exportFilename (full trio); the release note now scopes the claim precisely (object-panel Events tab named as the bare-presentation exception).
32. ✅ Max rows setting removed silently — AdvancedSection.tsx / app_settings.go — user-visible setting and persisted values dropped, not in release notes.
    FIXED: the removal is claimed in docs/release/pending.md (server-side pagination made it dead; persisted values ignored).
33. ✅ Browse default page size changed 1000 → 50 — frontend/src/modules/browse/pagination.ts — unclaimed user-visible change.
    FIXED: claimed in docs/release/pending.md.
34. ✅ Track A acceptance A1 unmet — the required liveness-latency contract was never documented in docs/architecture/large-data.md.
    FIXED: "Liveness Contract for Query-Backed Tables" section added to docs/architecture/large-data.md (refetch-on-identity, latency bound, keyset stability, user-vs-background indicator split); A1 doc checkbox marked done.

P3 — Tech debt / cleanup

35. Abandoned backend-export vestiges + doc drift — QuerySelectionDescriptor (resource_query_contract.go:312), QueryWideExport: true (catalog.go:157), types.ts:565 field — zero production consumers, pinned in
    place by the conformance test; large-data.md:40,92 and refresh-system.md:102 describe the nonexistent backend export.
36. Dead source-pagination channel — backendQuerySource.ts:22/useResourceInventoryTable.ts:61/ResourceInventoryTable.tsx:73 — every production source sets pagination: null; tests assert behavior nothing
    renders.
37. Query-or-window envelope block copy-pasted across ~16 builders — e.g. namespace_config.go:177, namespace_storage.go:134 — already drifting on exactness/issues handling; wants one generic helper.
38. Two cursor codecs, already diverged — typed_table_query.go:411 vs query.go:707 — catalog decoder trims whitespace, typed doesn't.
39. buildQueryBackedSource hand-duplicates backendQuerySource — useQueryBackedResourceGridTable.ts:118 — 16 typed views bypass the adapter the controller doc names; includes a dead Local Partial branch.
40. fetchAllRows duplicated typed vs catalog — useTypedResourceQuery.ts:317 / useBrowseCatalog.ts:551 — any walk fix must land twice.
41. selectRows boilerplate repeated in 12 views; payload→row mappings duplicated between views and namespaceResourceDescriptors.ts (double-edit proven in commit 0effd65f); descriptor row-mappings are near-dead
    — consolidate or delete.
42. Catalog pagination footer assembled by hand 3× — BrowseView.tsx:374, ClusterViewCustom.tsx:244, NsViewCustom.tsx:284 — plus CatalogPaginationControls is a re-typing passthrough of QueryPaginationControls;
    the drift already produced #12.
43. NsViewCustom inlines a 17-line persistence remap — NsViewCustom.tsx:199 — sibling ClusterViewCustom gets the shape from the hook directly.
44. useBrowseCatalog page-limit state mirror — useBrowseCatalog.ts:176 — six variables + sync effect collapse to a controlled prop.
45. Dead keyExtractor fallback + useKubeconfig subscription — useResourceGridTable.tsx:64 — unreachable duplicate resolution chain (verified not a bug; identity guard throws).
46. requestKey dead memo — useHydratedCustomCatalogRows.ts:121 — can never affect the effect; misleadingly implies content-keyed dedupe.
47. showResultCount no-op flag — GridTable.types.ts:98 — only setter sets the default.
48. Dead backgroundClusterRefresher custom map entries — backgroundClusterRefresher.ts:69,82 — correctly unreachable (upstream nulled), should be deleted; no test pins the Custom-tab skip.
49. SaveCsvFile re-implements atomic write minus fsync, leaves 0600 perms — app_csv_export.go:57 — (the suspected Windows rename failure was refuted; modern Go replaces on rename).
50. HydrateCatalogCustomRows ctx-cancel returns silent partial with nil error — app_object_catalog.go:613 — latent contract wart only; frontend merge guard prevents row loss (refuted as user-facing).
51. queryWithoutCache omits UnfilteredTotal — query.go:487 — real contract gap on the fallback path; "N of 0" banner effectively unreachable.
52. Node age adapter inlines -float64 instead of the −Inf sentinel helper — static_table_query.go:472 — convention violation; trigger unreachable on real clusters.
53. mergeQueryBackedFilterOptions unmemoized — useQueryBackedResourceGridTable.ts:260 — per-render option-model rebuild; sub-ms typically, material only at pathological namespace counts.
54. .claude/hooks/impact-gate.sh matches by basename with a global 60-minute window — one analysis unlocks edits to every same-named file repo-wide for an hour.

Cross-cutting (tracked as architecture follow-ups, not single fixes)

55. One shared bounded page engine would resolve #16/#24/#38 and the three-engine drift at once; descriptor-driven view config would resolve #27/#41 and most of the per-view copy-paste class.
56. A controller-level error/staleness surface is the single fix point behind #3/#4/#11/#25 — the data is already on the source; the render contract just has no slot for it.
