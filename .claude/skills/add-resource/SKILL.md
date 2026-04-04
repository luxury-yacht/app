---
name: add-resource
description: Add support for a new Kubernetes resource type across all layers (backend service, types, detail routing, frontend panel, tests)
---

# Add Resource

Add full support for a new Kubernetes resource type. This spans the backend service, type definitions, detail routing, frontend overview panel, and tests.

## Arguments

`/add-resource <Kind>` — e.g., `/add-resource CronJob`, `/add-resource Ingress`

## Before Starting

1. **Identify the resource's API group and package.** Look at existing resources in `backend/resources/` to find the right category directory (workloads, network, storage, config, policy, etc.). If none fits, create a new one.
2. **Read the existing pattern.** Read at least one complete example in the same category — e.g., `backend/resources/workloads/deployments.go` for workloads, `backend/resources/network/` for networking resources.
3. **Identify related resources.** Deployments relate to ReplicaSets and Pods. What does the new resource relate to? This determines what data the detail view should aggregate.

## Files to Create or Modify

### 1. Backend Service — CREATE

**File:** `backend/resources/<category>/<resource>.go`

Follow this pattern:

```go
package <category>

import (
    "github.com/luxury-yacht/app/backend/resources/common"
    restypes "github.com/luxury-yacht/app/backend/resources/types"
    // k8s API imports for the resource
)

type <Kind>Service struct {
    deps common.Dependencies
}

func New<Kind>Service(deps common.Dependencies) *<Kind>Service {
    return &<Kind>Service{deps: deps}
}

// <Kind> returns the detailed view for a single resource.
func (s *<Kind>Service) <Kind>(namespace, name string) (*restypes.<Kind>Details, error) {
    client := s.deps.KubernetesClient
    if client == nil {
        return nil, fmt.Errorf("kubernetes client not initialized")
    }
    // Fetch the resource and related resources
    // Build and return the Details struct
}
```

Key points:
- Accept `common.Dependencies` — never construct clients directly
- For namespaced resources, accept `(namespace, name string)`
- For cluster-scoped resources, accept `(name string)` only
- Aggregate related resources (pods, events, etc.) to build a rich detail view
- Use label selectors to find related pods when applicable
- Collect metrics via `s.deps.MetricsClient` when the resource manages pods

### 2. Type Definition — MODIFY

**File:** `backend/resources/types/types.go`

Add a `<Kind>Details` struct. Include:
- Basic metadata: Kind, Name, Namespace, Age, Labels, Annotations
- Resource-specific fields from the Kubernetes spec/status
- Related resource summaries (pods, events, etc.)
- Computed display strings (e.g., "Ready: 2/3")

Look at neighboring types in the same file for field naming conventions — they use plain strings for display values, not raw Kubernetes types.

### 3. Detail Provider Dispatch — MODIFY

**File:** `backend/object_detail_provider.go`

Add an entry to the `objectDetailFetchers` map:

```go
"<kind-lowercase>": {
    withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
        detail, err := <category>.New<Kind>Service(deps).<Kind>(namespace, name)
        return detail, "", err
    },
},
```

The key must be lowercase (e.g., `"cronjob"`, `"ingress"`). The `lookupObjectDetailFetcher` function normalizes input to lowercase.

### 4. Snapshot Detail Fetcher (Optional) — MODIFY

**File:** `backend/refresh/snapshot/object_details.go`

Add a raw-object fallback in the `objectDetailFetchers` map. This is the fallback path that returns the raw Kubernetes object when the rich detail service isn't available:

```go
"<kind-lowercase>": func(ctx context.Context, b *ObjectDetailsBuilder, namespace, name string) (interface{}, string, error) {
    obj, err := b.client.<APIGroup>().<Resources>(namespace).Get(ctx, name, metav1.GetOptions{})
    if err != nil {
        return nil, "", err
    }
    return wrapKubernetesObject(obj)
},
```

### 5. Frontend TypeScript Types — MODIFY

**File:** `frontend/src/modules/object-panel/components/ObjectPanel/Details/detailsTabTypes.ts`

Add the new details type to `DetailsTabProps`:

```typescript
<kind>Details: types.<Kind>Details | null;
```

Check how the types are generated or defined — look in `frontend/src/types/` or the wailsjs bindings for the TypeScript equivalent of the Go struct.

### 6. Frontend Overview Component — CREATE or REUSE

**Directory:** `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/`

If the resource is similar to an existing kind (e.g., another workload), extend the existing component with conditional rendering:

```tsx
const is<Kind> = normalizedKind.toLowerCase() === '<kind-lowercase>';

{is<Kind> && (
    <OverviewItem label="SomeField" value={someValue} />
)}
```

If the resource is substantially different, create a new `<Kind>Overview.tsx` component following the same prop pattern as `WorkloadOverview.tsx`.

### 7. Overview Registry — MODIFY

**File:** `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.ts`

Register the component for the new kind:

```typescript
overviewRegistry.register({
  kinds: ['<kind-lowercase>'],
  component: <OverviewComponent>,
  capabilities: {
    delete: true,   // Can the user delete this resource?
    restart: false,  // Only for workloads
    scale: false,    // Only for scalable workloads
    edit: true,      // Can the user edit the YAML?
  },
});
```

### 8. Backend Tests — CREATE

**File:** `backend/resources/<category>/<resource>_test.go`

Follow the established test pattern:

```go
func Test<Kind>Service<Kind>(t *testing.T) {
    // 1. Create fixtures
    resource := &<apiType>{...}
    
    // 2. Create fake client
    client := cgofake.NewClientset(resource)
    
    // 3. Create deps with testsupport helpers
    deps := testsupport.NewResourceDependencies(
        testsupport.WithDepsContext(context.Background()),
        testsupport.WithDepsKubeClient(client),
    )
    
    // 4. Instantiate service and call method
    service := <category>.New<Kind>Service(deps)
    details, err := service.<Kind>("namespace", "name")
    
    // 5. Assert
    if err != nil {
        t.Fatalf("unexpected error: %v", err)
    }
    // Assert specific fields...
}
```

Check `backend/test/testsupport/` for available fixture helpers and option functions.

### 9. Streaming Priority (Optional) — MODIFY

**File:** `backend/objectcatalog/service.go`

If the resource should appear quickly in the catalog, add it to `streamingResourcePriority`. Lower numbers = higher priority. Most resources don't need this — only add it if the resource is commonly viewed.

## Checklist

Before marking done:
- [ ] Backend service fetches the resource and related resources
- [ ] Detail struct defined in `types.go` with display-ready fields
- [ ] Detail provider dispatches to the new service
- [ ] Frontend type added to `DetailsTabProps`
- [ ] Overview component renders resource-specific fields
- [ ] Registry entry maps the kind to the component with correct capabilities
- [ ] Tests cover the happy path and at least one error case
- [ ] `mage qc:prerelease` passes
