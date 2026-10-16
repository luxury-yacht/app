# Object Map Kind Identity

Temporary plan from the 2026-10-15 object-map review. Phases 1-3 are
independent of the other object-map plans.

## Decision

The map-supported GVKs are published as a facet on the existing
`builtin-resource-identities.json` rows, not a separate file (John,
2026-10-15). One contract, already imported by the frontend and guarded by the
Go parity test.

## Target Model

- Map support is declared once per group/version/kind, by the backend kind
  registry (`Collector`, `GatewayCollector`, and the HPA collector).
- The frontend map gate, the backend permission policy for `object-map`, and
  the documented scope contract all derive from that registry or are checked
  against it.
- Matching uses complete identity, never the kind name alone.

## Non-goals

- Map support for custom resources.
- Re-keying the backend's kind-keyed maps (`objectMapGraphByKind`,
  `objectMapEdgeBuilders`) on their own. Once Phase 1 stops custom resources
  from opening maps, no observable failure remains. Re-key them only when
  other work touches those lines.

## Inventory

- **Frontend gate is a name-only list.** `MAP_SUPPORTED_KINDS` holds 33 names
  ([objectPanelRef.ts:62](../../frontend/src/modules/object-panel/objectPanelRef.ts)),
  and `isObjectMapSupportedKind` (`:154`) matches on kind name only. It gates:
  - `hasCompleteObjectMapReference` (`:157`), which yields the panel's
    `mapScope` (`:257`) and the map context menu;
  - the Open Map action
    ([useObjectActionController.tsx:279](../../frontend/src/shared/hooks/useObjectActionController.tsx)).

  Custom resources with clashing names (Istio `Gateway`, Calico
  `NetworkPolicy`, Knative `Service`) get map actions. The backend then seeds
  them from catalog-only rows that have no edges. Runtime behavior is
  [unverified].
- **Existing backend→frontend identity contract:**
  - `builtin-resource-identities.json` is imported as
    `@builtin-resource-identities`
    ([tsconfig.json:62](../../frontend/tsconfig.json)).
  - A Go table parity test guards it
    ([builtin_resources_test.go:44](../../backend/resourcecontract/builtin_resources_test.go)).
  - The JSON has rows for both HPA v1 and v2. The backend seeds HPA maps with
    the v2 identity
    ([hpa/identity.go](../../backend/resources/hpa/identity.go)).
- **Backend permission list has drifted.** The hand list for `object-map`
  ([domainpermissions/spec.go:481](../../backend/refresh/domainpermissions/spec.go))
  is missing six kinds the registry collects: NetworkPolicy,
  PodDisruptionBudget, Role, RoleBinding, ClusterRole, and ClusterRoleBinding.
  - No drift test covers it.
    [registry_drift_test.go](../../backend/refresh/snapshot/registry_drift_test.go)
    covers collectors and edges only.
  - `go list -deps ./backend/kind/kindregistry` doesn't include
    `domainpermissions`, `refresh/permissions`, or `resourcecontract`, so
    either package can import the registry without a cycle.
- **Scope contract metadata is stale.** The `object-map` entry
  ([refresh-domain-contract.json:485](../../backend/refresh/domain/refresh-domain-contract.json)):
  - lists an unused `?debug=1`;
  - omits `namespace:<ns>` and `maxDepth`/`maxNodes`;
  - names `clusterScope.ts:buildObjectScope` instead of `objectMapScope.ts`;
  - names `ObjectMapBuilder`, but the type is `objectMapBuilder`.

  It is regenerated through `backend/generate.go` (`go generate ./backend`).
  Tests check only that the fields are non-empty.

## Phases

Status (2026-10-15): Phases 1-3 done on branch `object-map-fixes`. Notes on
how the work landed:

- HPA versions: kind-only callers get `autoscaling/v2` (the last contract row
  wins). Table and Browse rows carry the backend's version, and a v1 reference
  the catalog holds resolves to the collected v2 node (build-cost Phase 3). So
  both served HPA versions are flagged.
- HPA moved from a bespoke snapshot collector to a registry `Collector`
  (`resources/hpa/objectmapnode.go`). The registry then lists every map kind
  (`kindregistry.ObjectMapIdentities`). `hpaListed` became a generic
  `listedGVRs` set. The existing HPA map tests stayed green.
- `BuiltinResource` is now a struct that embeds `resourcekind.Identity` plus
  the `ObjectMap` facet. The facet is derived from the registry at init (every
  served built-in version of a map kind), and the JSON parity test guards the
  34 flagged rows. `TestEveryObjectMapKindHasAMapRow` guards completeness.
- The frontend gate is `isObjectMapSupportedRef` (complete GVK).
  `MAP_SUPPORTED_KINDS` is gone, and the Open Map action uses the same gate.
- Permissions: the `object-map` runtime list is derived from the registry,
  and the dead `resources(...)` helper is removed.
- Contract metadata:
  - `payloadOwner` keeps the `package.Type` convention, now naming the real
    unexported `objectMapBuilder`;
  - `frontendBuilder` names `getObjectPanelScopes`, which builds the panel's
    map scope;
  - `objectMapScope.ts` `buildObjectMapScope` has no production callers. It is
    pre-existing dead code, left for a separate cleanup.

### Phase 1: A registry-derived map gate

- [x] Red: a frontend test asserting:
  - custom resources with clashing names (`networking.istio.io` Gateway,
    `crd.projectcalico.org` NetworkPolicy, `serving.knative.dev` Service) are
    not map-supported and get no Open Map item;
  - the built-in GVKs still are.
- [x] Verify which HPA version panel and table references carry. The supported
      set must equal what the backend's `findIdentity` resolves.
- [x] Green: add the map-support facet to the `BuiltinResource` rows and
      `builtin-resource-identities.json`, sourced from the kind registry. Add a
      Go test that the flagged rows equal the registry's map collectors, next
      to `TestBuiltinResourceJSONContractMatchesGoTable`. Then match group,
      version, and kind in `isObjectMapSupportedKind` and rename it to say it
      takes a reference. Remove `MAP_SUPPORTED_KINDS`.
- [x] Update the add-resource skill's object-map row so new kinds need no
      frontend list edit.

### Phase 2: Permission policy from the registry

- [x] Red: a test that the `object-map` runtime resources equal the registry's
      map collectors by group and resource. It fails today on six kinds.
- [x] Green: derive the list from `kindregistry` in `spec.go`, keeping HPA's
      group/resource semantics.

### Phase 3: Contract metadata

This is metadata and exempt from TDD.

- [x] Fix the `object-map` scope contract entries listed in the inventory.
- [x] Run `go generate ./backend` and the contract tests in
      `refresh_contract_generated_test.go` and `domainContract.test.ts`.

## Open Questions

None. See Decision.

## Validation

- `go test ./backend/resourcecontract ./backend/refresh/domainpermissions ./backend/refresh/snapshot`
- `mise exec -- npm run test --prefix frontend -- object-panel object-map refresh`
- `mise exec -- npm run typecheck --prefix frontend`
- `mise exec -- wails3 task qc:prerelease`
- App check: a custom resource such as an Istio Gateway shows no Map tab or
  Open Map, while a Gateway API Gateway still does.
