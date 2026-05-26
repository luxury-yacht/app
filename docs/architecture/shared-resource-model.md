# Shared Resource Model Contracts

The shared resource model is the backend source of truth for Kubernetes object
identity, primary status, relationship links, and reverse-link materialization.
New resource work must follow these rules before adding frontend interpretation
or parallel DTO shapes.

The implementation lives primarily in:

- `backend/resourcemodel` for semantic builders, facts, status, links, and
  validation
- `backend/refresh/snapshot` for refresh, table, stream, and object-map
  projections
- `backend/resources` and `backend/resources/types` for projections into
  existing rich-detail DTO contracts
- `frontend/src/shared/utils/backendStatusPresentation.ts` for status CSS token
  selection
- `frontend/src/shared/utils/resourceLinkIdentity.ts` for frontend relationship
  navigation and catalog-backed reference resolution

This document is the standing contract for new work. Historical phase plans and
completion tracking are not the source of truth for resource-model behavior.

## Scope

Use the shared model when code needs to decide what a Kubernetes object means:
canonical identity, primary status presentation, lifecycle, relationship links,
and durable resource-specific facts.

It applies to Kubernetes resource surfaces such as namespace and cluster tables,
resource streams, object-panel summaries and overviews, object-map nodes and
edges, event involved-object links, Helm release summary/status and manifest
links, and dynamic custom-resource status extraction. The frontend consumes DTO
fields projected from the shared model; it does not import
`backend/resourcemodel` directly.

The shared model covers these app-supported Kubernetes and app-synthetic
resources:

`BackendTLSPolicy`, `ClusterRole`, `ClusterRoleBinding`, `ConfigMap`,
`CronJob`, `CustomResourceDefinition`, `DaemonSet`, `Deployment`,
`EndpointSlice`, `Event`, `GRPCRoute`, `Gateway`, `GatewayClass`, `HTTPRoute`,
`HelmRelease`, `HorizontalPodAutoscaler`, `Ingress`, `IngressClass`, `Job`,
`LimitRange`, `ListenerSet`, `MutatingWebhookConfiguration`, `Namespace`,
`NetworkPolicy`, `Node`, `PersistentVolume`, `PersistentVolumeClaim`, `Pod`,
`PodDisruptionBudget`, `ReferenceGrant`, `ReplicaSet`, `ResourceQuota`, `Role`,
`RoleBinding`, `Secret`, `Service`, `ServiceAccount`, `StatefulSet`,
`StorageClass`, `TLSRoute`, and `ValidatingWebhookConfiguration`.

Dynamic custom resources use `CustomResourceFacts` unless a kind is promoted to
explicit first-class support.

Do not force non-resource or workflow-specific surfaces through
`backend/resourcemodel` unless they are rendering Kubernetes resource
semantics:

- Browse/catalog discovery views and backend object-catalog services. The
  object catalog remains the source of truth for what objects exist, GVK/GVR,
  scope, and exact catalog lookup.
- Cluster overview aggregate health, counts, capacity, usage, and summary
  charts.
- Refresh diagnostics, stream health, broker-read diagnostics, and telemetry.
- Settings, kubeconfig selection, app lifecycle, app logs, auth, update, and
  persistence screens.
- Raw or workflow-specific object-panel tabs such as YAML, logs, shell, node
  logs, Helm manifest, and Helm values. These may use shared identity or links
  where useful, but their payloads remain workflow-specific.
- Port-forward sessions, shell sessions, node maintenance, drain progress,
  workload actions, rollback, scale, delete, and other operation state.
- Capability and permission models. Those depend on RBAC, discovery, action
  options, selected cluster, and in-flight operations, so they stay contextual
  and separate from intrinsic resource facts.

These names are not first-class resource facts: `Eviction`, `PodMetrics`, and
`NodeMetrics` are action/subresource or metrics API objects; RBAC `User` and
`Group` subjects are identities and should stay display-only; node log sources
such as `path` and `service` are node-log discovery records; fixture/custom
examples such as `Widget`, `Gadget`, `DBCluster`, `DBInstance`, `DbInstance`,
and `Rollout` are covered by dynamic custom-resource handling unless promoted
later.

## Modeling

For every resource family, decide the shared model from Kubernetes API
semantics, not from the current table or detail DTO shape.

Use this decision process:

1. Start from the typed Kubernetes object and object-catalog GVK/GVR/scope.
2. Put identity, metadata, lifecycle, primary status, owners, and relationships
   in common `ResourceModel` fields.
3. Put durable, resource-specific Kubernetes semantics in that kind's facts
   type.
4. Put large, raw, sensitive, tab-specific, or workflow-specific payloads in
   detail-only DTOs.
5. Represent object relationships with `ResourceLink`; use `DisplayRef` when
   the source does not provide enough identity for safe navigation.
6. Preserve semantic values such as quantities, int-or-string fields,
   conditions, refs, and typed action options until the final table/detail DTO
   formatting boundary.
7. Reject a shared field when its only purpose is to mimic today's frontend
   display string.

Current backend detail structs are useful as an inventory of what users can see
today, but they are not the source of truth for the shared model. When they
contain flattened strings, kind-only references, or large payloads, the shared
model should correct the shape and the consumer DTO should adapt.

Resource-specific facts should stay typed. Shared structs are allowed only for
genuinely common substructure such as pod templates, rules, subjects, ports,
conditions, metrics, and route common fields. Do not use one generic facts
bucket for GVKs with different lifecycle, status, relationship, or action
semantics. New fact slots are allowed only when a migrated consumer reads them;
do not add empty slots to reserve future space.

## Identity

Every object reference that crosses a package, API, cache, event, action,
navigation, or refresh boundary must carry:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace` and `name` when the reference points to a concrete object

Do not pass kind-only, name-only, or namespace/name-only references. Backend
GVK/GVR/scope resolution goes through the object catalog's `ResourceResolver`;
its built-in seed list lives in `backend/objectcatalog/identity.go` and hydrates
from discovery and CRDs. Frontend built-in permission/view keys use
`frontend/src/shared/constants/builtinGroupVersions.ts`. For CRDs, thread the
actual group/version from discovery, owner references, HPA targets, event
involved objects, CRDs, Helm manifests, or the object catalog.

The Kubernetes plural `resource` field is useful descriptor metadata and is
required for RBAC permission attributes, but it must not be guessed from `kind`.
Populate it only when discovery, typed code, or the object catalog supplies it.
An empty Kubernetes `apiVersion` is unknown; do not silently treat it as core
`v1`.

Synthetic app resources must still use stable identity. Helm releases use the
shared synthetic identity `helm.sh/v3`, `HelmRelease`; lowercase legacy values
such as `helmrelease` are DTO compatibility details, not canonical identity.

## Status

The backend owns primary Kubernetes resource status semantics. Frontend code
renders these DTO fields directly:

- `status`: display label
- `statusState`: raw/source state for diagnostics and parity checks
- `statusPresentation`: CSS/status presentation token
- `statusReason`: optional source reason

Frontend code must not derive the primary status class from Kubernetes status
strings, phases, condition statuses, Helm status strings, or `statusState`.
Missing `statusPresentation` must render as `unknown`, which makes missing
backend projection visible during testing. The frontend may adapt backend
presentation tokens to CSS or color lookups only at the rendering boundary.

`statusState` preserves the selected Kubernetes source value. It is not an app
health vocabulary and is not a styling fallback. Do not replace source state
with invented app health vocabulary such as `healthy`, `degraded`, or
`unhealthy`.

Lifecycle states from `metadata.deletionTimestamp` take precedence over
reason-derived labels. For example, a deleting Pod should render as
`status: "Terminating"` and `statusPresentation: "terminating"` even if an
init or regular container still reports `CrashLoopBackOff`, while
`statusState` continues to preserve the source phase such as `Running` or
`Pending`.

When migrating a resource family, project status from the shared model into
every DTO surface that renders that resource: refresh/table rows,
resource-stream rows, rich detail DTOs, object-map nodes or edges, and
object-panel overview data. After migration, delete duplicated frontend or
service-layer status interpretation on those paths.

Use these source-state rules for migrated resource families:

- Namespace status starts from the Kubernetes namespace phase and may add
  workload-presence facts separately.
- Node status starts from the `NodeReady` condition status. Cordon and deletion
  affect the label and presentation without replacing the raw ready state.
- Pod status starts from `status.phase`. Waiting/terminated reasons, init
  container state, restart counts, readiness, eviction, and deletion affect the
  display label and presentation.
- Deployment, StatefulSet, DaemonSet, and ReplicaSet status starts from
  source-derived replica counts and controller conditions, not from a synthetic
  phase.
- Job status starts from selected job conditions or source counts such as
  active, succeeded, and failed. CronJob status starts from source fields such
  as `spec.suspend` and active job count.
- PersistentVolume and PersistentVolumeClaim status starts from
  `status.phase`. StorageClass status starts from the default-class annotation
  value because StorageClass has no phase.
- ConfigMap status starts from the data item count. Secret status starts from
  the Kubernetes Secret type, using Kubernetes' `Opaque` default when the type
  field is empty.
- Service status starts from `spec.type`; EndpointSlice status starts from
  endpoint readiness/address counts; Ingress status starts from
  load-balancer/address state; IngressClass status starts from the default-class
  annotation; NetworkPolicy status starts from effective policy types and rule
  counts.
- Gateway API status is condition-driven. Preserve relevant conditions such as
  `Accepted`, `Programmed`, `Ready`, and `ResolvedRefs` as source condition
  facts and summarize them once in the shared model.
- RBAC resources do not invent object status. Role refs and subjects should
  preserve only the identity the source safely provides.
- HPA status must preserve `scaleTargetRef.apiVersion` when present. The app
  has both autoscaling/v1 and autoscaling/v2 paths, so builders may differ by
  API version while projecting to the same facts shape.
- ResourceQuota, LimitRange, and PodDisruptionBudget status should keep
  quantities, percentages, int-or-string values, disruption state, and
  conditions semantic until DTO formatting.
- CRD version status derives from storage version plus additional served-version
  count. Webhook status preserves service or URL client config, selectors,
  rules, policies, side effects, timeout, and admission-review versions.
- HelmRelease status starts from Helm's release status and uses synthetic
  identity. Managed manifest resources become links only when their manifest
  identity is complete enough.
- Event status preserves type, reason, timestamps, count, source, and involved
  object identity. Missing or partial involved-object identity stays
  display-only.
- Dynamic custom resources extract only tested status conventions:
  `status.conditions[]`, `status.phase`, `status.state`, `status.ready`, and
  `status.observedGeneration`. If no convention applies, use unknown or neutral
  presentation instead of guessing application-specific health.

## Links And Navigation

Use `resourcemodel.ResourceLink` for relationship-bearing facts. Openable links
contain `ref` only. Display-only links contain `display` only. Never emit both
`ref` and `display` in the same `ResourceLink`; that is an ambiguous hybrid.

Use openable `ref` only when the source has a complete object identity:
`clusterId`, `group`, `version`, `kind`, `namespace` when namespaced, and
`name`. Use display-only `display` for unresolved, external, stale, deleted, or
partial references. If the source does not even provide a kind and name, do not
emit a link.

Construct links through the shared constructors:

- `resourcemodel.NewNamespacedResourceLink`
- `resourcemodel.NewClusterResourceLink`
- `resourcemodel.NewDisplayResourceLink`
- `resourcemodel.NewResourceRef`
- `resourcemodel.NewDisplayRef`

Validate exported links with `resourcemodel.ValidateResourceLink` when adding a
new relationship-bearing builder. Project into rich detail DTOs with
`backend/resources/types` helpers: `types.RefOrDisplayFromResourceLink`,
`types.RefOrDisplaySliceFromResourceLinks`, `types.ObjectRefFromResourceRef`,
and `types.DisplayRefFromResourceDisplay`. These projection helpers
intentionally do not infer `resource` from `kind`.

Reference-specific rules:

- Gateway API refs can omit names or use custom groups. Emit openable refs only
  when the source supplies a safe name and the app can know the version, such
  as core `v1` or Gateway API `v1`; keep unknown custom groups and nameless
  refs display-only.
- RBAC `roleRef` and subjects do not carry Kubernetes `apiVersion`. Emit real
  object refs only for safe built-in shapes: `Role`, `ClusterRole`, and
  `ServiceAccount`. `User` and `Group` subjects stay display-only. A
  RoleBinding ServiceAccount subject may inherit the binding namespace; a
  ClusterRoleBinding ServiceAccount subject needs an explicit namespace.
- IngressClass parameter references are not shared `ResourceLink` values when
  the Kubernetes source omits a version. Detail DTOs may display source fields,
  but shared object refs must not invent missing identity.
- HPA scale targets are openable refs only when `scaleTargetRef.apiVersion`
  parses into a real group/version. Invalid or missing API versions stay
  display-only.
- Admission webhook service client configs become core/v1 Service links. URL
  client configs remain literal URL facts because they are not Kubernetes
  objects.
- Helm manifest resources become links from each manifest object's
  `apiVersion`, `kind`, `namespace`, and `name`. Missing or empty `apiVersion`
  remains unknown.

Object-catalog-backed lookup is allowed only when the source already provides
stable identity such as UID or a full GVK + namespace/name. Catalog resolution
must not guess group, version, or resource from kind. Frontend relationship
navigation should use `frontend/src/shared/utils/resourceLinkIdentity.ts`.
That helper opens `ResourceLink.ref` values directly, treats
`ResourceLink.display` values as non-openable, resolves catalog objects by UID
only when UID and clusterId are present, and resolves exact catalog matches only
when full GVK + name are present. Do not fall through from a display-only
`ResourceLink` to older heuristic navigation.

Event involved-object identity must stay intact across every event surface:
snapshot payloads, live per-cluster SSE streams, aggregate SSE streams, and
resume-buffered aggregate events. Event payloads that expose an involved object
must preserve both `involvedObject` as a `ResourceLink` and the flat
compatibility fields `objectUid` and `objectApiVersion`. Per-cluster event
stream managers must build involved-object links with the real `clusterId`.
Aggregate stream handlers may fill missing cluster metadata from the selected
cluster, but they must emit and buffer the decorated event so normal delivery
and reconnect/resume delivery have the same object identity. Frontend stream
transforms must pass `involvedObject` through instead of falling back to legacy
flat fields for navigation.

## Materialization And Relationships

Shared builders must not make every consumer pay to build detail-heavy facts.
Use explicit materialization options:

- summary/table paths should request summary facts only
- detail paths may request detail facts, child lists, or container templates
- relationship paths may request relationship facts
- reverse-link paths must request `MaterializeReverseLinks`

Reverse relationships that feed shared facts belong in
`resourcemodel.ResourceRelationshipIndex`. Build the index once for the
available per-cluster snapshot or detail inputs, pass it into migrated builders,
and request reverse-link facts explicitly with `MaterializeReverseLinks`.

The object map may still own graph traversal, filtering, deduplication, edge
construction, and edge layout, but it should consume shared `ResourceLink` facts
instead of inventing parallel relationship semantics.

New reverse-link work must account for stale catalog data, partial
RBAC/list-watch failures, resource stream invalidation, cluster lifecycle, and
clusterId isolation. Do not add relationship-index inputs ahead of the resource
family that consumes them.

## Sensitive Data

Keep sensitive and large fields out of summary facts and non-detail payloads.
Examples include Secret values, literal environment values, command and args
arrays, raw YAML/spec/status, Helm manifests and values, credential-like storage
parameters, cloud-provider volume handles, keyrings, webhook CA bundles, and
certificate/key material.

Summary and relationship materialization should expose references, names,
counts, sizes, types, conditions, and status signals. Detail-only DTOs may
continue to expose data that an existing explicit workflow already surfaces
with the same access controls and user intent. Adding a field to a shared facts
struct is not permission to include that field in table refreshes, object-map
payloads, or diagnostics snapshots.

## Capabilities

Capabilities are contextual, not intrinsic resource facts. Continue to route
actions through the existing permission/action infrastructure:

- stable action IDs from `OBJECT_ACTION_IDS`
- frontend `CapabilityDescriptor`
- backend `capabilities.PermissionQuery`
- existing SSRR/SSAR diagnostics and active-operation state

Do not add a second capability model beside that path. If a future resource
needs additional contextual capability data, extend the existing descriptor and
document the source of each field.

Capability IDs and Kubernetes authorization attributes are stable external
contracts for UI behavior and permission diagnostics. Preserve them when moving
resource facts into `backend/resourcemodel`. Active operations such as drain,
delete, restart, rollback, and scale affect capabilities through in-flight
state and reasons; they are not resource facts. Permission checks must preserve
Kubernetes authorization attributes exactly: `clusterId`, group, version,
resource plural, subresource, namespace, name, verb, and scope.

## Consumers

The shared resource model layer owns Kubernetes semantics, including node
ready/not-ready/unknown/cordoned/terminating interpretation; pod phase,
waiting/terminated reason, readiness, and restart interpretation; workload
ready/paused/progress-deadline/rollout interpretation; job and cronjob complete,
failed, suspended, running, and pending interpretation; PV/PVC phase
interpretation; service, endpoint, ingress, and route readiness; owner and
relationship references; and resource-state signals consumed by contextual
capability builders.

Table builders select table-specific fields from shared resource models. They
may still add compact metric strings, aggregate resource usage, compact counts,
and sort-friendly values. They must not rederive primary status, ownership
identity, or relationships when those are already available from the shared
model.

Detail builders select detail-specific fields from shared resource models. They
may still expose raw YAML, decoded Secret values where explicitly allowed,
event summaries, Helm values/manifests/notes/history, log/exec/port-forward
discovery payloads, and unstructured raw status for custom resources. They
should use shared identity, metadata, primary status, relationships, and common
semantic facts whenever those facts exist.

Object-map builders use shared resource models for object references, status
presentation, creation timestamp, labels, and relationship references. They may
still own graph traversal, graph filtering, deduplication, and edge layout.

Frontend code owns layout, sorting, filtering, badge rendering, menus, and
click behavior. It must not independently reinterpret Kubernetes semantics such
as whether a node is cordoned, a pod is degraded, a workload rollout is
unhealthy, or a PVC state should render as warning or error.

Generated Wails TypeScript models must stay in sync with DTO changes. If
`wails generate` cannot update bindings in the local environment, update the
generated model file and validate it with typecheck before calling the work
complete.

If shared facts are ever exposed directly through Wails, document the
TypeScript shape before shipping that payload. Prefer projecting into existing
DTOs unless a frontend consumer genuinely needs typed shared facts. Acceptable
exported facts shapes are a discriminated payload or an `omitempty` pointer
union with ergonomic TypeScript narrowing.

## Migration Checklist

For each resource family:

1. Add or update the `backend/resourcemodel` builder, facts, status, lifecycle,
   and relationship links.
2. Project from that model into existing refresh, detail, stream, and object-map
   DTO contracts instead of introducing parallel wire types.
3. Use shared projection helpers for `ResourceLink` and status presentation.
4. Remove old duplicate semantic derivation from migrated backend and frontend
   paths.
5. Add parity tests that prove table/detail/object-map/stream surfaces agree on
   primary status and identity where those surfaces exist.

## Testing And Performance

Each migrated resource family should include unit tests for the shared resource
model builder, tests proving full object identity is preserved, tests for
important Kubernetes edge cases, parity tests proving applicable consumers
select the same primary status presentation from the shared resource model,
tests proving `ResourceLink` values are either openable refs or display-only
refs, frontend tests proving components consume backend-emitted status
presentation instead of recomputing it when frontend rendering changes, and
capability tests for RBAC checks, discovery errors, option-dependent failures,
and in-flight operation state once capability builders exist.

Regression tests should specifically prevent per-surface status drift from
returning.

Before changing a table, object-map, streaming, or reverse-link path with
non-trivial fanout, name the fixture or benchmark used and the acceptable
threshold. Relationship reverse links should use
`ResourceRelationshipIndex`, built once from available per-cluster
snapshot/detail inputs and queried by migrated builders. The current benchmark
entry point is:

```text
mage qc:benchmark
```

That target runs:

```text
go test ./backend/resourcemodel ./backend/refresh/snapshot -run '^$' -bench 'Benchmark(ResourceRelationship|SharedModel)' -benchtime=20x
```

The large relationship fixture in `backend/testsupport/relationship_fixtures.go`
contains 1,000 Pods, 500 RoleBindings, and 250 ClusterRoleBindings with
ConfigMap, Secret, PVC, ServiceAccount, Role, and ClusterRole reverse-link
lookups. The fixture should stay below 5 ms/op on the recorded developer
hardware and must not add Kubernetes API calls.

Before presenting non-documentation implementation work as complete, run
`mage qc:prerelease`. Documentation-only changes do not require that check.
