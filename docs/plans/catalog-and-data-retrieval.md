# Catalog and Data Retrieval

## Intent

This document captures the desired relationship between the object catalog and
the rest of the app's data-retrieval model.

The core idea is:

- the catalog is the canonical per-cluster index of all Kubernetes objects
- object identity and existence come from the catalog
- richer screens build on top of catalog identity instead of duplicating it

This is a data-architecture note, not a phased implementation plan.

## Core Position

The app should have a unified canonical source of truth for object identity:
the catalog.

That does **not** mean every screen should consume one universal payload shape.
It means:

- one canonical object index per cluster
- one shared object identity model across the app
- multiple retrieval shapes built on top of that canonical index

Unify the source of truth, not the consumer contract.

## What the Catalog Is

The catalog is the canonical list of all live objects in a cluster.

It should contain a minimal, durable object record for each object instance:

- `clusterId`
- `clusterName`
- `group`
- `version`
- `kind`
- `resource`
- `namespace`
- `name`
- `uid`
- `scope`
- `resourceVersion`
- `creationTimestamp`

The catalog record should stay intentionally small. It exists to answer:

- does this object exist?
- what is its canonical identity?
- what namespace/kind/scope is it in?
- can the app find it again reliably?

The catalog is not the full object payload and should not become a dumping
ground for feature-specific fields.

## Catalog Freshness

The catalog should update in near real time.

Changes to any object should be reflected in the catalog quickly enough that the
catalog can be trusted as the app's live object index.

That means:

- informer/watch-driven updates where practical
- incremental maintenance of catalog state
- explicit degraded/dirty state when watch confidence is lost
- explicit repair/rebuild paths when required

The app should not quietly continue as though the catalog is exact when it has
already lost confidence.

## What Uses the Catalog

All object-facing parts of the app should use the catalog as the source of
object identity and object existence.

That includes:

- Browse and other generic object lists
- object opening
- object panel routing
- object actions
- command palette object search
- object diff matching
- namespace/kind metadata derived from the object set

The catalog should be the place where the app agrees on:

- what object is being referred to
- whether it still exists
- which cluster it belongs to
- which exact GVK it has

## How Data Retrieval Should Work

The retrieval model should be layered.

### 1. Catalog Layer

The catalog owns canonical object identity and the live object set.

It supports:

- exact lookup by canonical identity
- bounded queries for object identities
- metadata queries for kinds, namespaces, counts, and groupings

### 2. Query / Projection Layer

The backend should expose query surfaces built on top of the catalog, depending
on consumer needs.

Examples:

- row queries for generic object tables
- metadata queries for sidebar and filters
- bounded search queries for command palette
- exact-match queries for diff and object routing
- typed projections for screens that need richer server-shaped rows

These are different views over the same canonical object index.

### 3. Hydration Layer

Consumers fetch richer data only after they have the catalog identity they need.

Examples:

- the object panel resolves an object from catalog identity, then fetches full
  details/YAML
- a typed table resolves the candidate object set, then fetches richer fields
  for the visible or bounded set
- object diff resolves exact object matches, then fetches YAML/details for those
  specific objects

## Important Constraint

Using the catalog as the canonical source does **not** mean:

- shipping the entire catalog to every screen
- forcing every screen to consume one shared row shape
- fetching one extra request per row
- rebuilding every typed screen entirely on the client from minimal catalog rows

Those would be the wrong consequences.

The correct consequences are:

- identity comes from one place
- candidate object sets can come from one place
- richer retrieval happens in bounded, batched, consumer-specific ways

## Generic Object Views

Generic object views such as Browse should be able to render directly from
catalog-backed row queries, because their job is to show a large, generic object
set.

Those views should primarily need:

- canonical identity
- scope
- namespace
- name
- kind
- a small number of sortable/filterable fields

If a generic list needs a small amount of enrichment, that enrichment should be
added deliberately and in bounded form.

## Typed Views

Typed views should still anchor themselves to catalog identity, but they do not
need to be limited to generic catalog rows.

Typed views may require:

- richer computed fields
- domain-specific aggregates
- feature-specific action state
- server-side shaping that would be awkward or expensive to reconstruct from the
  minimal catalog record alone

So typed views can use typed projections or typed refresh domains, as long as
they remain consistent with catalog identity.

That means:

- rows still carry canonical identity
- object opening still uses canonical identity
- actions still remain `clusterId` + GVK aware
- typed payloads are enrichments, not alternate object identity systems

## Object Panels and Object Actions

Object panels and object actions should be downstream of catalog identity.

The normal flow should be:

1. identify the object canonically
2. resolve or confirm it through the catalog
3. fetch the richer object payload required by the workflow
4. execute the workflow against the exact object identity

`uid` should be preserved for lifecycle-sensitive workflows such as:

- edit/apply safety
- stale object detection
- delete/recreate detection
- diff safety

But the primary object key remains canonical identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace`
- `name`

with empty `namespace` for cluster-scoped objects.

## Metadata Retrieval

The catalog should also be the basis for metadata retrieval.

Metadata consumers should not infer their state from whichever object rows
happened to be loaded most recently.

Instead, they should query explicit metadata derived from the catalog, such as:

- available namespaces
- available kinds
- kind scope information
- counts
- namespace groups
- degraded-state indicators

This is especially important for sidebar and filter UIs.

## Streaming Model

The catalog should be maintained in real time, but consumers should not be
forced into fragile full-list client merges.

The preferred model is:

- maintain the canonical catalog continuously
- stream invalidation or freshness signals to consumers
- refetch windows, projections, or metadata deliberately

This keeps the catalog live without making every UI surface responsible for
merging large object lists under churn.

## Design Rule

The design rule for the app should be:

- the catalog owns object identity and the live object set
- query/projection layers shape that data for consumers
- hydration layers fetch richer data only where needed

Or more simply:

Use the catalog to decide **what object** the app is talking about.
Use consumer-specific retrieval to decide **what data about that object** is
needed next.

## Comparison With Other Kubernetes Apps

Two adjacent apps are useful reference points:

- Headlamp (CNCF)
- Freelens (Lens fork)

Both use reusable abstractions for Kubernetes data access, but neither uses a
canonical all-object catalog as the primary cross-kind backend truth layer.

Headlamp's model is primarily:

- generic `KubeObject` classes
- per-resource list/get/watch hooks
- client-side combination of resource-specific results
- cross-kind features implemented as fan-out queries across resource types

Freelens' model is primarily:

- typed `KubeObjectStore` instances per resource type
- per-store load/watch/update pipelines
- object routing through a store registry
- watch-event merging into typed stores keyed by `metadata.uid`

Those designs show that typed per-resource stores can work, but they also show
the limitations of relying on typed stores alone:

- generic cross-kind browse/search tends to fan out across many resource types
- there is no single canonical cross-kind object index
- object routing and object lookup require extra registry layers
- object identity and existence checks are spread across many consumers

## Findings

The comparison does **not** argue against a global catalog. It argues against
making typed stores the only foundation for the app.

The useful takeaway is:

- Headlamp demonstrates strong generic list/get/watch primitives
- Freelens demonstrates strong typed-store and store-registry mechanics
- neither solves the "one canonical answer to what objects exist" problem in a
  clean cross-kind way

That is the gap the catalog is meant to close.

## Recommendation

Do **not** abandon the global catalog.

Instead, keep the catalog narrowly scoped to the things it is uniquely good at:

- canonical object identity
- live object existence
- exact object lookup
- namespace/kind/scope metadata
- real-time cross-kind indexing

Do **not** require the catalog to be the final payload for every screen.

The correct architecture is:

- the catalog is the canonical object index
- generic object features query the catalog directly
- richer screens use typed projections, typed stores, or hydration flows on top
  of catalog identity

In other words:

- keep `catalog-first`
- avoid `catalog-only`

The catalog should answer:

- what objects exist?
- what is this object's canonical identity?
- can the app still find the same object?

Consumer-specific retrieval should answer:

- what extra fields does this screen need?
- what richer shape does this workflow require?
- what bounded follow-up fetch or projection is appropriate?
