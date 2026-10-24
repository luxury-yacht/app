# Frontend Resource Surfaces

For first-class object-panel rendering, derived detail sections, actions,
YAML/permissions, or frontend built-in identity. The Overview contract lives in
[component-structure](../../../../docs/frontend/component-structure.md#object-panel-overview-rendering-descriptor-driven).

## Overview and detail sections

- The object-details payload is a tagged union (`ObjectDetail`, narrowed on
  `detailType`). It flows through one `detail` into
  `ObjectDetailModel.activeDetail`; Overview renders `details` through that
  `detailType`'s descriptor.
  Never add per-kind detail slots to `ObjectPanel.tsx` or `DetailsTabProps`, or
  prop-drill per-kind fields through `DetailsTab.tsx`.
- Create or extend the kind's `OverviewDescriptor<KindDetails>` under
  `Details/Overview/descriptors` and add built-ins to `BUILTIN_DESCRIPTORS` in
  `Details/Overview/descriptorRegistry.ts` (required: a new detail fetcher
  without a descriptor fails typecheck). Use `derivedFrom` when a field
  renderer reads extra keys, widgets only for irreducible UI with every consumed
  key declared, and `coveredElsewhere` for omitted or sibling-rendered fields.
  Reuse shared render helpers; no per-kind branching in the renderer.
- Update `DETAIL_DERIVATIONS` only for an existing presentation section
  (containers, container names, ConfigMap/Secret data, RBAC rules, Namespace
  finalization). Sections that exist because of a kind facet (active pods,
  scale replicas, port-forward, suspend, owned Jobs) are mapped types over the
  facet in `objectDetailModel.ts`: set the facet in the backend descriptor, then
  add the accessor TypeScript asks for. Overview-only fields stay in the
  descriptor.
- Add a focused render test and keep `driftCheck.test.ts` aligned with every
  generated DTO field.

## Built-in GVK, capabilities, and YAML

- The frontend built-in GVK lookup (`shared/constants/builtinGroupVersions.ts`)
  reads the identity contract JSON; never add custom resources there.
- Per-kind frontend behavior is the kind's descriptor facets, generated into
  `frontend/src/shared/kinds/kindFacets.generated.ts` by `go generate ./backend`:
  panel tabs and the shell (`Panel`), container logs (`Logs`, a `logspec.Target`)
  or node logs (`Panel.NodeLogs`), metrics (`Metrics`), list navigation
  (`ListDomain` for kinds without a stream descriptor), and display names
  (`Display`, required). Never add a frontend kind list or kind-name branch.
  When an action needs different verbs, subresources, or targets, change
  `useObjectPanelCapabilities.ts` and the backend permission/action path
  together ([permissions](../../../../docs/architecture/permissions.md)).
- YAML, apply, navigation, and actions use the panel object's full identity,
  never one reconstructed from display labels. YAML read/apply follows
  [yaml-editing](../../../../docs/architecture/yaml-editing.md).
