# Frontend Resource Surfaces

Read this reference when a kind needs first-class object-panel rendering,
derived detail sections, actions, or frontend built-in identity.

## Detail payload composition

The object-details refresh payload flows through one `detailPayload` into
`ObjectDetailModel.activeDetail`; Overview consumes that raw DTO. Do not add
per-kind detail slots to `ObjectPanel.tsx` or `DetailsTabProps`, and do not
prop-drill one field per kind through `DetailsTab.tsx`.

Update `DETAIL_KIND_CONFIG` only for an existing derived sibling section such as
containers, ConfigMap/Secret data, RBAC rules, active pods, scaling,
port-forward, or CronJob suspension. Add focused model/composition tests for a
new derivation. Overview-only fields stay in the descriptor.

## Overview descriptor and registration

Create or extend an `OverviewDescriptor<KindDetails>` under
`Details/Overview/descriptors`. The generic `OverviewRenderer` renders ordered
field, status, and widget items from the Wails DTO.

- Use fields for ordinary values and `derivedFrom` when a renderer consumes
  additional keys.
- Use widgets only for irreducible UI and declare every consumed key.
- List deliberately omitted or sibling-rendered fields in `coveredElsewhere`.
- Reuse shared render helpers; do not add per-kind branching to the renderer.

Register built-ins in `Details/Overview/descriptorRegistry.ts`. The separate
`Overview/registry.ts` is only the fallback for custom or unregistered kinds.
Add a focused render test and keep `driftCheck.test.ts` aligned with every
generated DTO field.

## Built-in GVK and panel capabilities

For first-class built-in frontend support, add the canonical group/version to
`frontend/src/shared/constants/builtinGroupVersions.ts`. Never add custom
resources there.

Update `ObjectPanel/constants.ts` capabilities only for implemented workflows:
delete, restart, scale, logs, shell, debug, trigger, suspend, or node logs.
When an action needs different verbs, subresources, or targets, update
`useObjectPanelCapabilities.ts` and the backend permission/action path together.

YAML, apply, navigation, and actions use the panel object's full identity from
the root contract; never reconstruct it from display labels.
