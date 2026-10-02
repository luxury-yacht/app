# Metrics tab: live metrics over time

A **Metrics** tab in the object panel charts CPU and memory for the panel's
object from the Kubernetes metrics API, over the time the panel has been open.

## Scope (decided 2026-10-02)

- **Live metrics only.** Samples come from the metrics API through the existing
  poller and `useResourceMetrics`. There is **no external metrics provider**
  (Prometheus or anything else) and **no storage**.
- **Kept only while the panel is visible.** Samples live in the tab's component
  state. Switching to another tab of the same visible panel keeps them, because
  the tab stays mounted like Logs and YAML. Hiding the panel (another panel
  active in its dock group, a cluster switch, closing it) or pausing
  auto-refresh discards them. The next visit starts a new chart, never a gap.
- **Why.** Supporting external stores turned the feature into a multi-platform
  dashboard: per-store auth, cluster scoping, query languages, and Settings UIs.
  Live metrics over time stay useful without any of that.

## What exists

- Tab registered after Events for Pods (`TABS.METRICS`, `onlyForKinds: ['pod']`).
- `Metrics/useLiveMetricSamples.ts` collects one sample per poller collection
  (`freshness.collectedAt` advances), ignores data cached from an earlier visit,
  keeps the last hour, and releases the metrics lease when disabled.
- `Metrics/MetricsTab.tsx`: a "Live · since 14:02" badge with "Not kept: cleared
  when you leave this panel", CPU and memory tiles (current, peak, limit), and
  a chart card per graph. It also has collecting, paused, and unavailable states.
- `Metrics/MetricChart.tsx`: Recharts 3.10.1 (with `react-is` 19.3.0, which the
  Recharts README requires to match React). Usage is solid, and requests and
  limits are dashed. Colors come from theme tokens, and the charts in a panel
  share one crosshair.

## Removed in the rescope

Settings → Metrics; named sources and per-cluster assignments; the in-cluster
Service-proxy and external HTTP transports; encrypted credentials and their key
file; the default source and label filters; query overrides; the Prometheus
provider and its Phase 0 fixtures; export/import of metrics settings; and the
`--prometheus` Kind flag. Phases 1–2 of that work are in commit `a9472c98`; the
Phase 3 work was never committed.

## Open

- Whether Node, Deployment, StatefulSet, and DaemonSet get the tab.
  `useResourceMetrics` already resolves those kinds (`pods`, `nodes`, and
  `namespace-workloads` scopes).
- When the feature is done: move the durable contract into
  [resource-metrics.md](../architecture/resource-metrics.md) and delete this plan.
