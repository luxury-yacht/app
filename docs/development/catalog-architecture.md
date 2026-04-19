# Catalog Architecture

## Intent

This note captures the durable architecture rule for the relationship between
the object catalog and the rest of the app's data-retrieval model.

The short version is:

- the catalog is the canonical per-cluster object index
- identity and existence come from the catalog
- richer screens build on top of catalog identity instead of duplicating it

Keep `catalog-first`. Avoid `catalog-only`.

## Core Rule

The catalog owns object identity and the live object set.

That does **not** mean every screen should consume one universal row shape or
render directly from catalog summaries. It means the app should agree on one
canonical answer to:

- what object is being referred to
- whether it still exists
- which cluster it belongs to
- which exact GVK it has

Consumer-specific retrieval should then decide what richer data is needed.

## Layered Retrieval Model

### 1. Catalog Layer

The catalog owns canonical object identity and the live object set.

It should answer:

- exact lookup by canonical identity
- bounded queries for object identities
- metadata queries for kinds, namespaces, counts, and groupings

### 2. Query / Projection Layer

Backend query surfaces should shape catalog-backed data for consumer needs.

Examples:

- generic object-table row queries
- sidebar/filter metadata queries
- bounded command-palette search queries
- exact-match queries for object open/diff/navigation
- typed projections for richer domain-specific screens

These are different views over the same canonical catalog.

### 3. Hydration Layer

Consumers fetch richer payloads only after they have the catalog identity they
need.

Examples:

- object panels resolve catalog identity, then fetch details/YAML
- diff flows resolve exact objects, then fetch YAML/details for those objects
- typed screens fetch richer data for bounded visible sets instead of treating
  typed payloads as a separate identity system

## Constraints

Using the catalog as the canonical source does **not** mean:

- shipping the full catalog to every screen
- forcing every screen onto one shared payload shape
- rebuilding every typed screen from minimal catalog rows on the client
- adding one extra fetch per row

The correct consequence is narrower:

- use the catalog to decide **what object** the app is talking about
- use consumer-specific retrieval to decide **what data about that object** is
  needed next

## Metadata Rule

Metadata-driven controls should come from explicit catalog-derived metadata, not
from whichever rows happened to be loaded most recently.

That is especially important for:

- sidebar cluster/namespace listings
- kind filters
- namespace filters
- counts and groupings

## Freshness and Confidence

The catalog should update in near real time, but the app should not quietly act
as though the catalog is exact when confidence has been lost.

Required behavior:

- maintain the catalog incrementally where practical
- expose explicit degraded/dirty state when watch confidence is lost
- provide explicit repair/rebuild paths when necessary

## Relationship to Typed Views

Typed views are allowed to use typed refresh domains and richer projections.

They are still expected to remain consistent with catalog identity:

- rows carry canonical identity
- object opening uses canonical identity
- actions remain `clusterId` + GVK aware
- typed payloads are enrichments, not competing identity systems
