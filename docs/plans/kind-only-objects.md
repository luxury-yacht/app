⏺ Investigation Report: Kind-Only Object Identification Bug

Summary

Confirmed: the app identifies Kubernetes objects by bare Kind (e.g. "DBInstance") almost everywhere, and the "View YAML" failure you hit is a direct symptom of a much larger, app-wide problem that also affects permission
(SSAR) checks, the object-panel registry, refresh scoping, and caching. The fix is non-trivial and touches both backend and frontend.

The catalog layer actually does store the full GVR on the backend and does ship group and version to the frontend — so the information exists, it's just dropped repeatedly as soon as you leave the catalog browse table.

Real-world collision confirmed. At least two widely-deployed operators define dbinstances as a plural:

- AWS Controllers for Kubernetes (ACK) — rds.services.k8s.aws/v1alpha1, kind DBInstance
- db-operator (kinda.rocks) — kinda.rocks/v1beta1, kind DbInstance
  Both map to lowercased dbinstance and both resolve to plural dbinstances, so case-insensitive kind matching cannot tell them apart. Common colliding kinds across the ecosystem include Certificate, Issuer, Cluster,
  Database, Instance, Backup, Workflow.

---

The View-YAML flow, end to end

1. Catalog row click — full GVK is present

frontend/src/modules/browse/components/BrowseView.tsx:134 passes group, version, resource into openWithObject(...) along with kind. The CatalogItem type (frontend/src/core/refresh/types.ts:273) carries all of them. So
far, so good.

2. Panel state context — GVK partially survives, then is ignored

frontend/src/core/contexts/ObjectPanelStateContext.tsx:17
export function objectPanelId(ref: KubernetesObjectReference): string {
const c = ref.clusterId?.trim() ?? '';
const k = (ref.kind ?? '').toLowerCase();
const ns = ref.namespace?.trim() ?? '\_';
const n = ref.name?.trim() ?? '';
return `obj:${c}:${k}:${ns}:${n}`;
}
The panel registry key is cluster:kind:namespace:name. Two distinct DBInstance objects with the same name/namespace collide to the same panel id and cannot be open simultaneously.

The KubernetesObjectReference type (frontend/src/types/view-state.ts:31) has kind, name, namespace, etc. but no typed group/version. It does have [key: string]: unknown catch-all, which is why the values from BrowseView
"slip through" untyped — and get dropped by everything downstream.

3. Object panel narrows to PanelObjectData

frontend/src/modules/object-panel/components/ObjectPanel/types.ts:8
export type PanelObjectData = {
kind?: string | null;
kindAlias?: string | null;
name?: string | null;
namespace?: string | null;
clusterId?: string | null;
clusterName?: string | null;
};
No group, no version. At this point the GVK is gone.

4. Scope builder — kind-only

frontend/src/modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind.ts:41
const detailScope = buildClusterScope(clusterId, `${scopeNamespace}:${objectKind}:${objectData.name}`);
The refresh-domain scope that feeds the object-yaml domain is namespace:kind:name — literally no place to put a group/version.

5. Frontend → backend Wails call

frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx:339
const latestYamlRaw = await GetObjectYAML(
resolvedClusterId,
identity.kind, // only kind
identity.namespace ?? '',
identity.name,
);
frontend/wailsjs/go/backend/App.d.ts:125 — GetObjectYAML(arg1, arg2, arg3, arg4) is a 4-string signature with no GVK hook.

Interestingly, identity: ObjectIdentity on the frontend (from YAML parsing) does have apiVersion. The apiVersion sits in the caller and is thrown away at the call site.

6. Backend receiver — signature has no GVK

backend/object_yaml.go:142
func (a \*App) GetObjectYAML(clusterID, resourceKind, namespace, name string) (string, error) {
deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
if err != nil {
return "", err
}
return a.getObjectYAMLWithCache(deps, selectionKey, resourceKind, namespace, name)
}

7. The ambiguity point — first-match-wins discovery

backend/object*yaml.go:306 in getGVRForDependencies:
for *, apiResourceList := range apiResourceLists {
gv, _ := schema.ParseGroupVersion(apiResourceList.GroupVersion)
for _, apiResource := range apiResourceList.APIResources {
if strings.EqualFold(apiResource.Kind, resourceKind) {
gvr := schema.GroupVersionResource{
Group: gv.Group, Version: gv.Version, Resource: apiResource.Name,
}
storeGVRCached(cacheKey, gvrCacheEntry{gvr: gvr, namespaced: apiResource.Namespaced})
return gvr, apiResource.Namespaced, nil // ← first match wins
}
// ...also matches SingularName and resource plural, same pattern
}
}
// CRD fallback, same bug:
for \_, crd := range crds.Items {
if strings.EqualFold(crd.Spec.Names.Kind, resourceKind) {
// ...
return gvr, isNamespaced, nil // ← first match wins
}
}
This is the exact line that bites you. When two resources share Kind, the function returns whichever happens to come first out of ServerPreferredResources() (non-deterministic across clusters) or out of the CRD list
(alphabetical-ish by name). There is no disambiguation at all, and no error/warning is emitted when multiple matches exist.

8. Cache key collision amplifies the bug

backend/object_yaml.go:41
func gvrCacheKey(selection, resourceKind string) string {
kind := strings.ToLower(strings.TrimSpace(resourceKind))
if selection == "" { return kind }
return selection + "|" + kind
}
Once dbinstance is cached to (say) the ACK GVR for a cluster, every subsequent request for any DBInstance in that cluster hits the same cache entry. So the bug is sticky: the user may see the right YAML once and then
silently wrong YAML forever (or vice versa) depending on which kind was queried first.

---

Same bug, repeated across the app

These are all independent sites that lose GVK or resolve by bare kind. They would all need to be fixed together for a consistent model.

Backend

- backend/object_yaml.go:143 — `GetObjectYAML(clusterID, resourceKind, namespace, name)` signature lacks group/version. Feeds the read path only.
- backend/object_yaml.go:306 — `getGVRForDependencies` is the single discovery function used by view-YAML and the capability path; first-match wins. Note the `SingularName` and plural-name matchers at 378 and 394 also return on first hit, and the CRD fallback at 415 is equally non-disambiguating.
- backend/object_yaml.go:41 — `gvrCacheKey` collides on kind-only, so once a wrong GVR resolves it sticks for the whole TTL.
- backend/app_permissions.go:38 — `QueryPermissions` loops over `PermissionQuery` items and calls `a.getGVR(clusterId, q.ResourceKind)` to build the SSAR, so every `get/update/patch/delete` capability check on a colliding kind is resolved against whichever GVR was cached first. The RBAC check for "can I view this DBInstance" can silently be the wrong question.
- backend/capabilities/query.go:11 — `PermissionQuery` struct has `ResourceKind string` only. No `Group`/`Version` fields, so the protocol itself cannot express disambiguation.
- backend/refresh/snapshot/object_details.go:125 — `parseObjectScope` parses `namespace:kind:name`; the shared scope format used by multiple object-panel refresh domains has no place for group/version. Called from three snapshot builders: `object_details.go:73`, `object_events.go:85`, and `object_content.go:91`.
- backend/refresh/snapshot/object_content.go:18-20 — **This is the primary path hit by the YAML tab** (not the direct Wails `GetObjectYAML` call). The `ObjectYAMLProvider.FetchObjectYAML(ctx, kind, namespace, name)` interface has no apiVersion; `ObjectYAMLBuilder.Build` at `:90` calls the shared `parseObjectScope` and then hands kind-only params to the provider. The panel's initial YAML hydration and all subsequent refreshes flow through here.
- backend/object_detail_provider.go:311-321 — concrete implementation of `ObjectYAMLProvider.FetchObjectYAML`. Delegates to `getObjectYAMLWithDependencies` / `getObjectYAMLWithCache`, which ultimately calls the buggy `getGVRForDependencies`. This is the backend function that actually serves the wrong DBInstance bytes to the panel.
- backend/refresh/snapshot/object_events.go:84 — the object-events domain builder calls the same `parseObjectScope(scope)` as object-details, so the events tab in the object panel is vulnerable to the same collision. Any fix to `parseObjectScope` must cover all three callers (details, events, yaml).
- backend/refresh/logstream/handler.go:325 — **independent parser.** Logs do NOT feed `parseObjectScope`. `parseOptions` does its own `strings.Split(scope, ":")` and enforces `namespace:kind:name`. Since logs are keyed by Pod (a built-in, no collisions) this is currently safe, but any scope-format change on the frontend logScope builder must also update this parser or logs will break.
- backend/resources_generic.go:12 — `DeleteResource(clusterID, resourceKind, namespace, name)` signature lacks group/version. Routes straight into `generic.NewService(deps).Delete(...)`.
- backend/resources/generic/generic.go:30 — `Service.Delete` resolves GVR from bare kind via a hardcoded builtins table at `:72`, then falls back to `discoverGroupVersionResource` at `:194`, which at `:224-225` matches the first discovery entry whose Kind/Name/SingularName equals the requested string. Same first-match-wins bug as `getGVRForDependencies`, but re-implemented in its own file. A colliding CRD can be deleted against the wrong GVR — the k8s API would most likely return 404 rather than delete the wrong object, but if the wrong-group CRD happens to have an object of the same name and namespace, deletion hits the wrong one.
- backend/objectcatalog/types.go:52 — This is the one exception: `objectcatalog.Summary` correctly stores `Group`, `Version`, `Resource`, `Kind` and backend/objectcatalog/helpers.go:127 keys catalog items by full GVR. So the data exists, it just never propagates out of the catalog.
- backend/object_yaml_mutation.go:521 — **NOT broken.** `getGVRForGVKWithDependencies` takes a full `schema.GroupVersionKind` and does precise resolution. The edit/apply path at `:222-223` already uses this by calling `schema.FromAPIVersionAndKind(req.APIVersion, req.Kind)` with the apiVersion shipped from the frontend. This helper should be reused by the read, capability, events, and delete paths rather than inventing another resolver.

Frontend

- frontend/src/types/view-state.ts:31 — KubernetesObjectReference has no typed group/version. (Catch-all [key: string]: unknown allows them through informally, then nothing consumes them.)
- frontend/src/modules/object-panel/components/ObjectPanel/types.ts:8 — PanelObjectData has no group/version at all.
- frontend/src/core/contexts/ObjectPanelStateContext.tsx:17 — objectPanelId uses cluster:kind:namespace:name — panel IDs collide for same-name objects of same-name kinds in different groups.
- frontend/src/modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind.ts:41 — detailScope format is namespace:kind:name.
- frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx:339 — calls `GetObjectYAML(cluster, kind, ns, name)` with bare kind. The local `identity: ObjectIdentity` does carry `apiVersion` (parsed from YAML at yamlValidation.ts:65) but it's not passed through.
- frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx:97 — builds `eventsScope` as `${scopeNamespace}:${objectData.kind}:${objectData.name}`, feeding the same shared `parseObjectScope` on the backend. Same collision as view-YAML. Also builds `logScope` on 106 using lowercase kind; logs are keyed by Pod, so the collision bites only if a non-Pod CRD ever routed here.
- frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts:69-222 — every single capability descriptor (`view-yaml`, `edit-yaml`, `delete`, `restart`, `scale`, `view-logs`, `shell-exec-*`, `debug-ephemeral`, `view-manifest`, `view-values`) is built with `resourceKind` derived from `objectData.kind` with no group/version. Every permission gate in the object panel is vulnerable.
- frontend/src/core/capabilities/types.ts:14 — `CapabilityDescriptor` type only has `resourceKind`. The protocol itself can't carry group/version.
- frontend/src/core/capabilities/hooks.ts:28,130 — `QueryPayloadItem` sent over the Wails bridge to `QueryPermissions` has no group/version.
- frontend/src/modules/object-panel/components/ObjectPanel/constants.ts:11 — `WORKLOAD_KIND_API_NAMES` is a hand-maintained map `{ deployment: 'Deployment', daemonset: 'DaemonSet', ... }`. Used by the restart capability and by pod fetching. Works only for built-ins; falls back to bare kind for CRDs.
- frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabUtils.ts:55-85 — **NOT broken.** `validateYamlOnServer` and `applyYamlOnServer` both pass `apiVersion: identity.apiVersion` to the backend's `ValidateObjectYaml` / `ApplyObjectYaml`. The write path is already GVK-correct; only the read path drops `apiVersion`.
- frontend/src/modules/browse/components/BrowseView.tsx:134 — one of the few places that still has `group`/`version` from the catalog row; it passes them into `openWithObject` but they are not preserved past `ObjectPanelStateContext`. This is the cleanest place to start a fix.
- frontend/src/ui/modals/ObjectDiffModal.tsx:230-261 — `useObjectYamlSnapshot` is a **second, non-panel subscriber** of the `object-yaml` refresh domain. At `:239` it builds `${namespaceSegment}:${kindSegment}:${selection.name}` — the same bare `namespace:kind:name` scope — wraps it via `buildClusterScope` at `:240`, and calls `useRefreshScopedDomain('object-yaml', ...)` at `:244`. Any change to `parseObjectScope` that doesn't also update this modal will break YAML diff loading. Upside: the modal takes a `CatalogItem` as input, which already carries `group` and `version` on the frontend — no type-threading work is needed, only the scope-format update.

---

Failure modes, by operation

**Note:** The original version of this table had two inaccuracies that have been corrected below after direct code verification: the Edit-YAML row (the mutation path already threads apiVersion and uses exact GVK on the backend) and the Delete row (it has its own independent kind-only resolver in `backend/resources/generic/generic.go`, not the same path as `QueryPermissions`). The Object-events refresh domain has also been added to the list.

| Operation | Bug | What the user experiences |
|---|---|---|
| **View YAML** (the reported bug) | `backend/object_yaml.go:306` `getGVRForDependencies` returns the first kind match; the `gvrCacheKey` at `:41` then pins it. | Wrong YAML returned, or "resource not found", depending on which GVR resolved first and whether an object of the same name exists under that GVR. No error explains "ambiguous kind". |
| Edit / Apply YAML | **Not broken in isolation.** `frontend/.../Yaml/yamlTabUtils.ts:55` sends `apiVersion: identity.apiVersion` to `ValidateObjectYaml`/`ApplyObjectYaml`; `backend/object_yaml_mutation.go:222-223` resolves exact GVK via `getGVRForGVKWithDependencies`. The mutation hits the correct target provided the user was shown the correct YAML to begin with. Listed here only because the upstream View-YAML bug can populate the editor with a wrong-group object, which the user would then unknowingly edit. Once View YAML is fixed, Edit is automatically correct. | Currently safe given valid input. Becomes fully correct once View YAML is fixed. |
| Delete | `backend/resources_generic.go:12` `DeleteResource(clusterID, resourceKind, namespace, name)` → `backend/resources/generic/generic.go:30` `Service.Delete` → hardcoded builtins map at `:72` → fallback `discoverGroupVersionResource` at `:194` → first-match-wins at `:224-225`. This is a **second, independent** kind-only resolver, not reached via `getGVRForDependencies`. The SSAR permission gate is separately wrong via `QueryPermissions`. | For a builtin kind (Deployment, Pod, etc.) the hardcoded table always resolves the same GVR, so safe. For a colliding CRD, delete targets whichever group discovery yields first; most likely 404 from the wrong group, but if an object of the same name/namespace exists there, the wrong object is deleted. |
| Restart / Scale | Capability descriptor built with bare kind; `WORKLOAD_KIND_API_NAMES` only covers built-ins. | Restart/scale are only invoked on built-in workload kinds (no collisions today). Pattern is the same and will break the day a CRD workload is added. |
| Shell / Debug | Hardcoded `'Pod'` in the descriptor. | Safe. Pod is a built-in, no collisions. |
| SSAR / permission gate | `backend/app_permissions.go:71` calls `a.getGVR(clusterId, q.ResourceKind)`, i.e. the same broken resolver as View YAML. | SSAR is asked about the wrong resource; buttons may appear enabled when the user is actually forbidden, or disabled when they are allowed. Security-relevant. |
| Object-details refresh domain | `parseObjectScope` can't carry group/version; scope is `namespace:kind:name`. | Panel body content may be sourced from wrong object. |
| Object-events refresh domain | Same `parseObjectScope`, driven by `frontend/.../ObjectPanelContent.tsx:97` `eventsScope` builder. | Events tab shows events for the wrong DBInstance. Fixing details scope without also fixing events scope would break the events tab. |
| Panel registry | `objectPanelId` collides on `cluster:kind:namespace:name`. | User cannot open two different-group DBInstances with the same name/namespace at the same time; the second click is a no-op. |

---

Why the catalog is a good anchor for a fix

Everything the fix needs already exists at the source:

1. backend/objectcatalog/types.go:52 — Summary has Group, Version, Resource, Kind.
2. frontend/src/core/refresh/types.ts:273 — CatalogItem mirrors that.
3. frontend/src/modules/browse/hooks/useBrowseColumns.tsx:42 — BrowseTableRow carries group, version, resource, and the full item: CatalogItem.
4. frontend/src/modules/browse/components/BrowseView.tsx:134 — already passes group, version, resource into the panel opener.

The fix fundamentally needs to thread these through four boundaries that currently drop them:

- `KubernetesObjectReference` / `PanelObjectData` typings (so they survive the panel state context).
- **All three frontend scope builders that feed `parseObjectScope`**: `detailScope` in `getObjectPanelKind.ts:41` (panel, drives the object-details and object-yaml refresh domains), `eventsScope` in `ObjectPanelContent.tsx:97` (panel, drives object-events), and `useObjectYamlSnapshot` in `frontend/src/ui/modals/ObjectDiffModal.tsx:230-261` (non-panel, also drives object-yaml — builds the bare scope at `:239`). These three producers are ultimately parsed by the shared `parseObjectScope` at `backend/refresh/snapshot/object_details.go:125` via three snapshot builders (`object_details.go:73`, `object_events.go:85`, `object_content.go:91`). All three frontend producers and the backend parser must migrate atomically, or one of the panel tabs or the diff modal will break.
- **`logScope` is separate.** `logScope` in `ObjectPanelContent.tsx:106` is parsed independently by `backend/refresh/logstream/handler.go:325` `parseOptions`, not by `parseObjectScope`. Since logs are always keyed on Pod (built-in, no collisions) the log path is not broken today. It only needs to change if we want a single canonical scope format across all panel tabs — in which case `logstream/handler.go:325` has to be updated at the same time.
- The Wails-bound function signatures `GetObjectYAML` (post-edit hydration path) and `DeleteResource`, and the `QueryPermissions` RPC — plus the `CapabilityDescriptor` / `PermissionQuery` / `ObjectIdentity` types that describe them.
- **The refresh-domain provider interface for YAML.** `snapshot.ObjectYAMLProvider.FetchObjectYAML(ctx, kind, namespace, name)` at `backend/refresh/snapshot/object_content.go:20` is the primary path feeding the panel YAML tab; its signature has to grow a GVK parameter, and its concrete implementation at `backend/object_detail_provider.go:312` has to thread that through to `getGVRForGVKWithDependencies`. Updating the Wails `GetObjectYAML` call without this gets you the post-edit refresh right but not the initial panel load.
- The backend resolver layer: `getGVRForDependencies` (read path, package `backend`) and `Service.groupVersionResource` / `Service.discoverGroupVersionResource` (delete path, package `generic`) should both ultimately resolve via the same exact-GVK logic currently implemented as `getGVRForGVKWithDependencies` at `backend/object_yaml_mutation.go:521`. That helper already takes a full `schema.GroupVersionKind` and does precise resolution. **But note:** it is unexported in package `backend`, and `backend/resources/generic` cannot import `backend` (package `backend` already imports `generic` at `backend/resources_generic.go:10`, so a back-import would be a cycle). The plan must either (a) move the helper to a neutral shared package such as `backend/resources/common`, or (b) leave it in `backend` and resolve the GVR at the `backend` layer inside `DeleteResource` before handing an already-resolved GVR to `generic.Service.Delete`. The `gvrCacheKey` must also include group/version so cached entries don't cross-contaminate.

---

Recommended triage order (if you decide to fix)

Sequenced to maximize user-visible fix per step. Each step is meant to land atomically so no intermediate state is more broken than the current state.

1. **Thread GVK through the panel identity layer.** Add `group`/`version` to `PanelObjectData` and `KubernetesObjectReference`, update `objectPanelId` to include them (fixes panel-registry collisions as a side effect), and update `BrowseView.tsx:134` → `openWithObject` → `ObjectPanelStateContext` so group/version actually survives instead of falling through the `[key: string]: unknown` catch-all. This is the foundation every other step depends on. No behavior change yet.
2. **Fix the scope format used by the three `parseObjectScope` callers.** Update `backend/refresh/snapshot/object_details.go:125` `parseObjectScope` to parse the new format, then update every frontend site that builds a scope for any of the three snapshot domains (`object-details`, `object-events`, `object-yaml`) together:
   - `detailScope` in `frontend/.../getObjectPanelKind.ts:41` — drives *both* the object-details and object-yaml refresh domains for the object panel.
   - `eventsScope` in `frontend/.../ObjectPanelContent.tsx:97` — drives object-events for the object panel.
   - `useObjectYamlSnapshot` in `frontend/src/ui/modals/ObjectDiffModal.tsx:230-261` — a second, non-panel subscriber of the `object-yaml` refresh domain; builds a bare `namespace:kind:name` scope at `:239` and must migrate at the same time. Conveniently, the modal's input is a `CatalogItem` that already carries `group`/`version`, so the change is localized (no upstream type-threading needed, unlike the panel).
   
   All three snapshot builders (`object_details.go:73`, `object_events.go:85`, `object_content.go:91`) pull from the shared parser, so they land together with the frontend producers above. Options for the encoding: `namespace:group/version:kind:name` or an opaque JSON/URL-encoded payload — either works as long as backwards-compat with empty group for core types is preserved (helps core-type test fixtures and existing saved state). *Deliberately leave `logScope` alone:* `backend/refresh/logstream/handler.go:325` `parseOptions` is a separate parser, and logs are keyed on Pod (no collisions). Touching it would force a logstream parser change in the same landing, which is unnecessary churn.
3. **Fix the primary view-YAML read path end-to-end.** This has two legs:
   - (a) **Refresh-domain leg (the one the user is hitting):** `backend/refresh/snapshot/object_content.go:20` `ObjectYAMLProvider.FetchObjectYAML(ctx, kind, namespace, name)` interface grows a GVK parameter (either a full `schema.GroupVersionKind` or `apiVersion, kind`). `ObjectYAMLBuilder.Build` at `:90` extracts the new fields from the parsed scope (thanks to step 2) and passes them to the provider. The concrete implementation at `backend/object_detail_provider.go:312` `FetchObjectYAML` resolves via **the existing** `getGVRForGVKWithDependencies` helper at `object_yaml_mutation.go:521` instead of going through `getObjectYAMLWithDependencies` → `getGVRForDependencies`. This leg fixes the user-facing bug in the YAML tab's initial load and all refresh cycles, and because `ObjectDiffModal` subscribes to the *same* `object-yaml` refresh domain, it fixes diff YAML loading at the same time (provided the modal's scope builder was already migrated in step 2).
   - (b) **Post-edit hydration leg (secondary):** `YamlTab.tsx:339` `hydrateLatestObject` calls the Wails `GetObjectYAML` directly to re-read after an edit. Change `GetObjectYAML` signature in `backend/object_yaml.go:143` and the Wails binding to accept `apiVersion`, and route it through `getGVRForGVKWithDependencies` too. Update the call site to pass `identity.apiVersion` (already available on the frontend `ObjectIdentity` via `yamlValidation.ts:65`).
   - Update `gvrCacheKey` at `backend/object_yaml.go:41` to include group/version so cached entries don't cross-contaminate.
   - *Do not delete `getGVRForDependencies` in this step — it still has kind-only callers via capabilities.*
4. **Fix the capability/SSAR path.** Add `group`/`version` to `CapabilityDescriptor`, `QueryPayloadItem`, and `backend/capabilities/query.go:11` `PermissionQuery`. Update every descriptor-building site in `useObjectPanelCapabilities.ts` to pass the new fields (now available on `PanelObjectData` after step 1). In `backend/app_permissions.go:71`, call `getGVRForGVKWithDependencies` when the new fields are set; fall back to `getGVR` when they're not (for legacy callers). This fixes silent wrong permission gates.
5. **Fix the delete path, resolving the package-cycle constraint.** `backend/resources/generic` cannot call `getGVRForGVKWithDependencies` directly because `backend` already imports `generic` (at `resources_generic.go:10`) and the helper is unexported. Pick **one** of:
   - (a) *Resolve at the caller.* Leave `generic.Service.Delete` alone as a GVR-based primitive and add a new `generic.Service.DeleteGVR(gvr, namespace, name)` (or extend the signature). Move all kind-to-GVR resolution into `backend/resources_generic.go` `DeleteResource`, where it can freely call `getGVRForGVKWithDependencies`. This is the smallest change and keeps `generic` package-ignorant of GVK resolution.
   - (b) *Move the resolver to a shared package.* Extract `getGVRForGVKWithDependencies` from `backend/object_yaml_mutation.go:521` into `backend/resources/common` (or a new `backend/resources/gvk` package). Both `backend` and `generic` can import it. This is cleaner long-term but a larger refactor and also affects the mutation path.
   - Either way: update `DeleteResource` at `backend/resources_generic.go:12` to accept `apiVersion` (or group+version), update the frontend delete call site to thread the new fields, and add a fallback to the existing hardcoded/discovery path only when a GVK is not supplied. Recommend (a) as the first-iteration fix — it's the minimum change — with (b) queued as cleanup in step 7.
6. **Write regression tests with colliding CRDs.** Install two CRDs with kind `DBInstance` in different groups in a test env (ACK `rds.services.k8s.aws` and db-operator `kinda.rocks` are the concrete ones). Add unit tests in `object_yaml_test.go` and `resources/generic/generic_test.go` that exercise the resolvers with a fake discovery client returning both kinds, and assert that when a GVK is supplied the caller's choice wins, and when it isn't the behavior is deterministic.
7. **Converge the resolvers.** Once all callers route through `getGVRForGVKWithDependencies`, fold `getGVRForDependencies` and `Service.discoverGroupVersionResource` into thin wrappers over the shared helper, or delete them. Retire `WORKLOAD_KIND_API_NAMES` — the restart path can read the workload kind's GVK directly off `PanelObjectData`. Retire `Service.groupVersionResource`'s hardcoded builtins table in favor of discovery once there's cache coverage for the common case.

Steps 1-3 are the minimum to fix the reported user-facing bug. Note that step 3 is *not* just a one-function change — it has to cover both the scope-driven refresh-domain path (which is what the panel actually uses for initial load) and the direct Wails call (post-edit hydration). Step 4 is required before presenting the fix as "production-ready" because without it the RBAC gates in the object panel are silently asked about the wrong resource, which is security-relevant. Step 5 closes the orthogonal delete-path hole. Together steps 1-5 are a meaningfully large, multi-file change spanning ~20 files across backend and frontend. Steps 6-7 are cleanup and test debt; they can land after step 5 without user impact.

**What the Edit / Apply YAML path does NOT need in this fix:** the mutation path at `object_yaml_mutation.go:222-223` and `yamlTabUtils.ts:55` already threads `apiVersion` and already uses `getGVRForGVKWithDependencies`. It is the reference implementation, not a site to change. Its only dependency on the above work is that the user must have been shown the correct YAML in step 3 before editing, otherwise they'd unknowingly edit a correct copy of a wrong-group object.

---

What the data said vs. what I verified

The four lines of investigation (backend map, frontend map, end-to-end YAML trace, DBInstance CRD research) all independently converged on the same failure at `backend/object_yaml.go:306` and the same chain of dropped fields. Cross-referenced file:line citations above are from direct code reads. The DBInstance collision between ACK and db-operator is verified against their upstream CRD YAMLs. Crossplane AWS providers do not define a `DBInstance` kind (they use `RDSInstance` and `Instance`), contrary to what I had initially assumed — corrected in the summary above.

### Follow-up review corrections (verified 2026-04-05)

A second pass reviewed the plan against the actual code and flagged four inaccuracies in the original draft. All four are verified and the plan above has been updated accordingly:

- **Edit / Apply YAML is not in scope.** The mutation path already threads `apiVersion` (`frontend/.../Yaml/yamlTabUtils.ts:55-85`) and resolves exact GVK on the backend (`backend/object_yaml_mutation.go:222-223` via `getGVRForGVKWithDependencies` at `:521`). Earlier draft implied it had the same wrong-target-write risk as View YAML; it does not.
- **Object-events refresh domain must be in scope.** The events tab has its own scope builder at `frontend/.../ObjectPanelContent.tsx:97` that produces the same bare `namespace:kind:name` format and is parsed by the same `parseObjectScope`. Fixing details scope without also fixing events scope would break the events tab.
- **Delete has its own independent kind-only resolver.** `backend/resources_generic.go:12` → `backend/resources/generic/generic.go:30` → hardcoded builtins map at `:72` and first-match discovery at `:194` / `:224-225`. Earlier draft said it was "likely also keyed by kind"; it is, but in its own separate implementation that must be fixed independently.
- **`ObjectYAMLSnapshotPayload` does not need to ship GVR back to the frontend.** The frontend already reconciles identity by parsing `apiVersion`/`kind` out of the YAML body itself (`frontend/.../Yaml/yamlValidation.ts:65` `parseObjectIdentity`). Earlier draft asserted the frontend "cannot reconcile" without a GVR field in the payload; it can.
- **Use the existing resolver.** `getGVRForGVKWithDependencies` at `backend/object_yaml_mutation.go:521` already takes a full `schema.GroupVersionKind` and resolves precisely. The fix should converge every caller onto this helper rather than teaching `getGVRForDependencies` new tricks or inventing a second exact-GVK resolver.

### Follow-up review corrections, round 2 (verified 2026-04-05)

A third review pass caught three remaining gaps in the implementation plan (the diagnosis was sound; the *how-to-fix* was wrong). All three are verified and the plan has been updated:

- **Step 3 had to cover the refresh-domain YAML path, not just the Wails call.** The panel YAML tab gets its content from `useRefreshScopedDomain('object-yaml', effectiveScope)` at `frontend/.../Yaml/YamlTab.tsx:86`, which on the backend flows through `snapshot.ObjectYAMLProvider.FetchObjectYAML(ctx, kind, namespace, name)` at `backend/refresh/snapshot/object_content.go:20` → `backend/object_detail_provider.go:312` → `getObjectYAMLWithDependencies` → the buggy `getGVRForDependencies`. Earlier step 3 only called out the direct Wails `GetObjectYAML` call (which is only used by `hydrateLatestObject` for post-edit re-hydration). Step 3 now explicitly names both legs, and a new bullet in the backend list at the top documents `object_content.go` and `object_detail_provider.go`.
- **`logScope` does not feed `parseObjectScope`.** The earlier "four boundaries" list claimed that `logScope` (at `ObjectPanelContent.tsx:106`) "all feed `parseObjectScope`" together with details and events scopes. That is false. `backend/refresh/logstream/handler.go:325` `parseOptions` has its own independent `strings.Split(scope, ":")` parser and enforces `namespace:kind:name`. The correction: steps 1-5 should *deliberately leave `logScope` alone*. Logs are keyed on Pod (built-in, no collisions) so there is no bug to fix there; touching it would only force a parallel change to the logstream parser for no user-visible benefit. Documented in a new dedicated backend bullet for `logstream/handler.go:325`.
- **The delete-path convergence plan had a package-cycle hole.** Earlier step 5 said to "change `backend/resources/generic/generic.go:30` `Service.Delete` to resolve GVR via `getGVRForGVKWithDependencies`". That is not implementable: `getGVRForGVKWithDependencies` is unexported in `package backend`, and `package backend` already imports `package generic` at `backend/resources_generic.go:10`, so a back-import would create a cycle. Step 5 now presents two alternatives — (a) resolve the GVR in `backend/resources_generic.go` `DeleteResource` before handing an already-resolved GVR into `generic.Service.Delete`, which is the smallest change; or (b) extract the helper into `backend/resources/common` or a new shared package so both sides can import it. Option (a) is recommended as the first-iteration fix.

### Follow-up review corrections, round 3 (verified 2026-04-05)

One more non-panel caller of the broken scope format was missing from the plan. Verified against the code and added:

- **`ObjectDiffModal` is a second subscriber to the `object-yaml` refresh domain.** `frontend/src/ui/modals/ObjectDiffModal.tsx:230-261` defines a `useObjectYamlSnapshot` hook that builds `${namespaceSegment}:${kindSegment}:${selection.name}` at `:239`, wraps it via `buildClusterScope` at `:240`, and calls `useRefreshScopedDomain('object-yaml', scope)` at `:244`. Earlier step 2 enumerated only the object-panel scope builders (`detailScope`, `eventsScope`), which would have left diff YAML loading either ambiguous or outright broken after the `parseObjectScope` format change. Step 2 has been updated to include the modal in the scope-migration set. Step 3's refresh-domain leg automatically covers the modal once its scope builder is migrated, because both the panel and the modal share the same backend `object-yaml` domain. A new frontend bullet documents the modal as the second subscriber. Note: the modal's input is a `CatalogItem`, which already carries `group`/`version` on the frontend, so no type-threading is needed — just the scope-format update.
