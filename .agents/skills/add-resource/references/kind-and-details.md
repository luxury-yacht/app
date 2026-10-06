# Kind, Identity, Model, and Detail Steps

For a first-class kind package, model projection, detail DTO/service, or
generated binding. Rules live in
[resource-kind-registry](../../../../docs/architecture/resource-kind-registry.md)
and [shared-resource-model](../../../../docs/architecture/shared-resource-model.md).

## Per-kind package (`backend/resources/<kind>/`)

- `identity.go`: `resourcekind.Identity{Group, Version, Kind, Resource,
  Namespaced}`, the single identity declaration.
- `descriptor.go`: one `kindspec.Descriptor` selecting only supported facets
  (`CatalogSource`, `Stream`, `Collector`, `Edges`, `Binding`, `Graph`,
  `Workload`, `PortForward`, and detail cache behavior).
- `model.go`: status presentation, facts, and `ResourceLink` relationships on
  `backend/resourcemodel` primitives. Project the model into details, rows,
  event/link payloads, and graph nodes instead of re-deriving per consumer.
- `facts.go`: typed semantic facts, no placeholder fields.
- `dto.go`: the Wails detail wire shape; shared cross-kind fragments stay in
  `backend/resources/types`.
- Register `<kind>.Descriptor` once in `backend/kind/kindregistry/registry.go`.

## Built-in identity

- Add `fromIdentity(<kind>.Identity)` to
  `backend/resourcecontract/builtin_resources.go` and the matching row to
  `backend/resourcecontract/builtin-resource-identities.json`. The catalog
  derives its built-in seed from this contract; keep no second identity table.
  First-class frontend support also needs the frontend built-in GVK
  ([frontend surfaces](frontend-surfaces.md#built-in-gvk-capabilities-and-yaml)).
- Never add CRDs or custom resources; discovery supplies their group/version.
  `backend/resources/common/resource_identity.go` stays an interface, not a
  resolver table.

## Detail service and DTO

- `details.go` takes `common.Dependencies` and uses its context, cluster ID,
  Kubernetes client, and metrics client; never construct clients or use an
  unscoped background context. Namespaced methods take namespace and name;
  cluster-scoped methods take name.
- Fetch related objects through Kubernetes-native relationships or selectors and
  return a display-ready `<Kind>Details`. Raw, sensitive, or tab-specific
  payloads stay detail-only. Embed `restypes.StatusProjection` when the kind has
  primary status.
- After Go DTO changes, refresh or verify the generated `models.ts` under
  `frontend/bindings/github.com/luxury-yacht/app/backend` and run frontend
  typecheck; Wails generation may be unavailable locally.

## Generated detail binding

Declare `backend/resources/<kind>/appbinding.go`:

```go
var DetailBinding = appbinding.Spec{
    Identity: Identity,
    Service:  "<kind>.NewService(deps)",
    Import:   "github.com/luxury-yacht/app/backend/resources/<kind>",
}
```

- Attach it to the descriptor and run `mise exec -- go generate ./backend`.
  Generation owns `ResourceGateway.Get<Kind>` and `objectDetailFetchers`;
  `objectDetailFetcherGVKs` derives from that dispatch plus
  `resourcecontract.BuiltinResources`. Never hand-edit either map or generated
  wrappers.
- Add a `detailFetcherVersionPins` entry (`backend/object_detail_provider.go`)
  only when the built-in contract intentionally lists more than one version of
  the same kind.
- Never add per-kind fallbacks to `backend/refresh/snapshot/object_details.go`;
  it delegates typed resolution to the app provider and supplies generic details
  for unsupported kinds.

## Tests

Adjacent package tests for identity, status, facts, refs, relationships, service
output, and at least one retrieval/error boundary, using `backend/testsupport`
fixtures and dependency options.
