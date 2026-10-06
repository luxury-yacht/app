# Frontend Resource Surfaces

For first-class object-panel rendering, derived detail sections, actions,
YAML/permissions, or frontend built-in identity. The Overview contract lives in
[component-structure](../../../../docs/frontend/component-structure.md#object-panel-overview-rendering-descriptor-driven).

## Overview and detail sections

- The object-details payload flows through one `detailPayload` into
  `ObjectDetailModel.activeDetail`, which Overview consumes as the raw DTO.
  Never add per-kind detail slots to `ObjectPanel.tsx` or `DetailsTabProps`, or
  prop-drill per-kind fields through `DetailsTab.tsx`.
- Create or extend the kind's `OverviewDescriptor<KindDetails>` under
  `Details/Overview/descriptors` and register built-ins in
  `Details/Overview/descriptorRegistry.ts`. Use `derivedFrom` when a field
  renderer reads extra keys, widgets only for irreducible UI with every consumed
  key declared, and `coveredElsewhere` for omitted or sibling-rendered fields.
  Reuse shared render helpers; no per-kind branching in the renderer.
- Update `DETAIL_KIND_CONFIG` only for an existing derived sibling section
  (containers, ConfigMap/Secret data, RBAC rules, active pods, scaling,
  port-forward, CronJob suspension), with focused model/composition tests for a
  new derivation. Overview-only fields stay in the descriptor.
- Add a focused render test and keep `driftCheck.test.ts` aligned with every
  generated DTO field.

## Built-in GVK, capabilities, and YAML

- Add the canonical group/version to
  `frontend/src/shared/constants/builtinGroupVersions.ts` for first-class
  built-in support; never add custom resources there.
- Update `ObjectPanel/constants.ts` capabilities only for implemented workflows:
  delete, restart, scale, logs, shell, debug, trigger, suspend, or node logs.
  When an action needs different verbs, subresources, or targets, change
  `useObjectPanelCapabilities.ts` and the backend permission/action path
  together ([permissions](../../../../docs/architecture/permissions.md)).
- YAML, apply, navigation, and actions use the panel object's full identity,
  never one reconstructed from display labels. YAML read/apply follows
  [yaml-editing](../../../../docs/architecture/yaml-editing.md).
