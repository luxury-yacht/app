# The Task: one place per kind

> **STATUS 2026-06-16 — DONE (gate-green).** The one registry exists:
> `backend/refresh/kindregistry.All` ([]`kindspec.Descriptor`, one entry per
> built-in kind). Every dispatch subsystem now loops/derives from it and names no
> kind itself: object catalog (informer/list/watch), resource-stream, snapshot
> stream-summary, object-map (collectors + edges), App bindings + generated detail
> dispatch, and response-cache invalidation. Domain permissions reference each
> kind's canonical `Identity` (the domain→kind composition is irreducible policy,
> not a registry-derivable facet). Capability vocabularies reference
> `<kind>.Identity.Kind`. Adding a kind = create `resources/<kind>/` + one entry in
> `kindregistry.All`. Remaining kind-name occurrences are only: the kind's own
> package, that one registry entry, legitimate cross-kind relationships (e.g. a
> workload→ConfigMap edge), per-kind operations (scale/rollback/port-forward), Go
> type switches, documented exceptions (workload-metrics + HPA bespoke streaming),
> shared leaf types, comments, and tests — none of which is a subsystem spelling a
> kind out for dispatch.
>
> Step 1 (literal) is now done: **each kind package exports exactly one
> `Descriptor`** (`resources/<kind>/descriptor.go`) bundling its identity + facets,
> and `kindregistry.All` is just the list of those. Each kind's `StreamDescriptor`
> now sources its group/version/kind/resource from `Identity` (no literal second
> copy). Adding a kind = create `resources/<kind>/` (with its `descriptor.go`) +
> one line in `kindregistry.All`.
>
> Object-map internals also moved off hard-coded kind names: the graph-role
> classifications (scalable-workload / directional-traversal / stops-reverse-
> expansion) are now a `kindspec.ObjectMapGraph` facet on each kind's Descriptor,
> and the StorageClass/IngressClass byName edge targets are declared by the source
> kinds (PVC/PV/Ingress) via a `CoreRef{Group,…}` instead of resolvers hard-coded in
> `object_map.go`.
>
> **What is NOT registry-driven (deliberately — these are not "kind definition", so
> not among the 9 surfaces):** per-kind *operations* (`workload_actions.go`/
> `workload_rollback.go` scale/restart/trigger, port-forward, log streaming — each a
> distinct typed K8s API call); cross-kind *relationship* helpers (`resourcemodel`
> reverse-link index, and the object-map selector/slice resolution primitives where
> the target kind is intrinsic to the relationship type); the catalog's
> `buildSummaryActionFacts` projection (overlaps the object-map's registry-driven
> action facts — a feature-projection done in two places); and workload-metrics
> streaming (no shared informer for metrics). Converting operations and unifying the
> action-facts projection are tractable follow-ups but are larger refactors outside
> the plan's 9 named surfaces.



## The goal, in one sentence

Every Kubernetes kind is defined in **one** place — its own package — and **every
other part of the app reads from that one place**. To add or change a kind, you
edit one package. Nothing else.

## Why

Right now one kind (e.g. Pod) is defined and re-listed by hand in about 9
different places. To add a kind you edit ~13 files and it's easy to forget one,
so the pieces drift out of sync. We want: edit one place, done, nothing can drift.

## The one place

`backend/resources/<kind>/` — it holds the kind's identity, model, facts, DTO,
detail builder, object-map status, stream summary, and one **Descriptor** that
hands the rest of the app everything it needs.

## The test for "done"

Pick any kind. Grep the whole backend for its name.

**The only place that names or defines that kind is its own package.** Every other
subsystem gets the kind from the shared registry — it never spells the kind out
itself.

Adding a brand-new kind = create `resources/<newkind>/` with its Descriptor and
register it **once**. Zero edits anywhere else. Gate stays green.

If adding a kind would make you touch any file outside its package, **it is not
done.**

## These must ALL be driven from the registry (no per-kind code left in them)

- identity — `resourcecontract`
- object catalog — informer / list / watch
- object-map collector + status — `refresh/snapshot/object_map.go`
- stream summary — `refresh/snapshot/streaming_helpers.go`
- resource-stream registration — `refresh/resourcestream`, `refresh/system`
- App binding — `resources_*.go` / generated
- detail dispatch — `object_detail_provider.go`
- DTOs + aliases — `resources/types`, `backend/types.go`
- domain permissions

If any of these still has a hand-written entry per kind, the task is not finished.

## How it works

1. Each kind package exports one `Descriptor`: its identity **plus** its typed
   behaviours (model builder, summary builder, detail service, object-map info,
   refresh domain, permission verbs).
2. One registry collects every kind's Descriptor.
3. Every subsystem loops over the registry. It never lists kinds by hand.
4. A test fails if any subsystem's set of kinds disagrees with the registry — so
   it can never silently drift.

## DO NOT do these (this is exactly how it got screwed up before)

- **DO NOT** move a kind's files into a `resources/<kind>/` folder and call it
  done. If the kind is still listed by hand in object_map / streaming / bindings /
  catalog / etc., you have only rearranged the mess. That is **not** progress
  toward the goal.
- **DO NOT** treat `mage qc:prerelease` passing as "done." Green only means nothing
  broke. A kind can be scattered across 9 files and still pass green. Green is not
  the goal; one-place-per-kind is the goal.
- **DO NOT** make a second copy of anything. Every kind package already has an
  `Identity` — the registry must use it, not a separate literal copy. Two copies =
  failure.
- **DO NOT** do the easy file-moving and skip the hard part. The hard part —
  making every subsystem read from one registry — **is** the task. Moving files is
  only the setup for it.
