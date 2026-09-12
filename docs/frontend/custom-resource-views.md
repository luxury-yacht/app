# Custom-resource views

Use the existing catalog, GridTable and Overview infrastructure when giving a
discovered CRD family dedicated presentation. Discovery, identity, visibility,
query boundaries and projection ownership follow the
[catalog contract](../architecture/catalog.md#discovered-resource-families).

## Presentation contracts

- Keep a single family table with the existing Kind filter. Do not introduce
  per-kind tabs to accommodate different fields.
- Give columns specific names and one fact per cell; CSV values must represent
  the same field. Put long configuration lists in Details.
- Use the shared Overview frame, kind-specific summaries and labeled sections.
  Omit empty sections and preserve meaningful zero values.
- Resource identifiers and values must remain selectable and copyable, including
  repeated lists and tooltip content. Check selection under the production
  `.app` CSS reset, including text-bearing descendants.
- Follow the Node panel's shared `StatusChip` pattern for Conditions and taints.
  Preserve condition-dependent colors and message/reason tooltips, and retain
  taint key/value/effect casing.

## Karpenter requirements

Keep the name **Requirements** to match YAML. Render source requirements,
including custom keys; do not hide a requirement because its key looks like a
metadata label. Show readable labels while keeping the exact key available in
the shared interactive Tooltip. Preserve operators and minimum-value constraints;
only the redundant `In` prefix is omitted. Taints and startup taints remain
separate groups, with long values allowed to wrap.

## Karpenter capacity

- The table Usage column sits before NodePool. For NodePools, show capacity divided
  by configured limits as `CPU n% / Mem n%`, using the same calculation as the Capacity section. Each
  percentage strictly above 80% uses the warning text color. Other kinds show `-`.
  A missing usage or missing/zero limit leaves that percentage unavailable.
- Use shared quantity parsing and formatting for memory and ephemeral storage,
  including Kubernetes milli-byte quantities.
- Compare CPU values using whole cores when both values are whole CPUs; otherwise
  use millicores for both. Apply this to total/allocatable and total/limit pairs.
- For NodePool CPU and memory with configured limits, show `usage / limit (n%)`.
  Calculate the percentage from parsed source quantities before display rounding,
  using up to one decimal place. Keep values over 100% visible. Omit the percentage
  when usage is unavailable or the limit is zero; without a limit, show usage alone.
- Show `n of n` (allocatable, then total) when the displayed values differ; when
  they match, show only the allocatable number. For other resource limits with no
  allocatable value, show `n (limit n)`; otherwise show the total alone. Do not add
  legends.
- Keep the header **Capacity**. The explanation tooltip belongs to the claim
  overview; pools and overlays do not supply it.
- Order resources as CPU, memory, storage, nodes, pods, pod-eni, hugepages, then
  other resources alphabetically. Display `ephemeral-storage` as `storage` and
  `vpc.amazonaws.com/pod-eni` as `pod-eni`; retain hugepage size suffixes.

The owning implementations are
[KarpenterSections.tsx](../../frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/KarpenterSections.tsx),
the [overview descriptor](../../frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/karpenter.tsx)
and [column factory](../../frontend/src/modules/cluster/components/karpenterColumns.tsx).

## Validation

Use realistic long values, sparse objects and narrow panels to review layout.
Exercise selection, copy and tooltip keyboard access directly; screenshots do not
prove those interactions. Keep regression tests focused on application behavior,
rather than adding assertions for individual labels or CSS properties. Follow the
[completion evidence contract](../workflows/completion.md) and distinguish
Storybook fixture previews from live-cluster and native Wails validation.
