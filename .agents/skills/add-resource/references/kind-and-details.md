# Kind, Identity, Model, and Detail Contracts

Read this reference when adding or changing a first-class kind package, shared
resource model projection, detail DTO/service, or generated app binding.

## Per-kind package

Create or extend `backend/resources/<kind>/`:

- `identity.go`: `resourcekind.Identity{Group, Version, Kind, Resource,
  Namespaced}` is the single identity declaration.
- `descriptor.go`: one `kindspec.Descriptor` selects only the facets this kind
  supports (`CatalogSource`, `Stream`, `Collector`, `Edges`, `Binding`, `Graph`,
  `Workload`, `PortForward`, and detail cache behavior).
- `model.go`: build status presentation, facts, and `ResourceLink`
  relationships on shared `backend/resourcemodel` primitives.
- `facts.go`: keep typed semantic facts without placeholder fields.
- `dto.go`: define the Wails detail wire shape; shared cross-kind DTO fragments
  stay in `backend/resources/types`.

Register `<kind>.Descriptor` once in `backend/kind/kindregistry/registry.go`.
Catalog, stream, snapshot summary, object-map, detail binding, and cache
invalidation paths loop that registry by facet. Fix a generic dispatch gap
instead of adding another kind list. See
`docs/architecture/resource-kind-registry.md`.

The model owns primary status and relationships. Project it into details,
snapshot rows, stream rows, event/link payloads, and graph nodes instead of
re-deriving semantics in each consumer.

## Built-in identity

For a built-in kind, add `fromIdentity(<kind>.Identity)` to
`backend/resourcecontract/builtin_resources.go` and the matching row to
`builtin-resource-identities.json`. The object catalog derives its built-in
seed from this contract; do not maintain a second identity table.

Do not add CRDs or custom resources to the built-in contract. Discovery and CRD
data supply their real group and version. Keep
`backend/resources/common/resource_identity.go` as an interface rather than a
resolver table.

## Detail service and DTO

`backend/resources/<kind>/details.go` accepts `common.Dependencies`. Use its
context, cluster ID, Kubernetes client, and metrics client; do not construct
clients or use an unscoped background context. Namespaced service methods accept
namespace and name; cluster-scoped methods accept name.

Fetch related objects with Kubernetes-native relationships or selectors and
return a display-ready `<Kind>Details`. Keep raw, sensitive, or tab-specific
payloads detail-only; keep durable facts, links, and status in the model. Embed
`restypes.StatusProjection` when the kind exposes primary status.

After changing Go DTOs, refresh or verify the relevant generated `models.ts`
under `frontend/bindings/github.com/luxury-yacht/app/backend` and run frontend
typecheck. Wails generation may be unavailable in some local environments.

## Generated detail binding

Declare `backend/resources/<kind>/appbinding.go`:

```go
var DetailBinding = appbinding.Spec{
    Identity: Identity,
    Service:  "<kind>.NewService(deps)",
    Import:   "github.com/luxury-yacht/app/backend/resources/<kind>",
}
```

Attach it to the kind descriptor and run `mise exec -- go generate ./backend`.
Generation owns the `App.Get<Kind>` wrapper and `objectDetailFetchers` dispatch.
`objectDetailFetcherGVKs` is derived from generated dispatch plus the built-in
resource contract; do not hand-edit either map or generated wrapper files.

Do not add per-kind fallbacks to
`backend/refresh/snapshot/object_details.go`; it delegates typed resolution to
the app provider and supplies generic details for unsupported kinds.

## Tests

Add adjacent package tests for identity, status, facts, refs, relationships,
service output, and errors. Use `backend/testsupport` fixtures and dependency
options. Each service behavior starts with a failing test and covers at least
one retrieval/error boundary relevant to the implementation.
