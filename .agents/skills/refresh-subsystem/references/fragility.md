# Refresh Fragility Reference

Failure-prone refresh paths. Each section names the owning contract to read
first plus warnings not recorded there. Load only the section the task touches.

## Teardown

Contracts: `docs/architecture/refresh-system.md` "Construction, publication,
and teardown" and "Backend subscription lifetime".

- Cancel informer contexts before `Shutdown()` clears references.
- Every teardown, cooling, replacement, and stop path calls
  `Subsystem.StopDoorbellNotifiers()` (`backend/refresh/system/manager.go`).

## Doorbell-backed snapshot domains

Applies to `namespaces`, `namespace-metrics`, the three Events domains,
`cluster-overview`, and any new doorbell-backed snapshot domain. Ordering rules
(invalidate before broadcast, `stream-signal` reason, `signalVersions` with a
first-signal sentinel, one trailing latch, echo skipping, conditional polling)
are in `docs/architecture/data-freshness.md` "Signals and source clocks";
server-owned namespace readiness is in `docs/architecture/refresh-system.md`
"Permission and readiness".

## Governor and retained state

Contracts: `docs/architecture/data-layer.md` "Lifecycle & governor" and
`docs/architecture/data-freshness.md` "Retention and leases".

## Stream health and consumers

Contracts: `docs/architecture/refresh-system.md` "Resource-stream protocol";
consumer wiring in [domain wiring](domain-wiring.md) "Frontend".

## Debugging

- Pair backend doorbell broadcast logs with frontend receipt/signal logs. When
  both occur but UI data does not move, inspect cache invalidation ordering
  first.
- Metric chain: collection observer → broadcast → contract source clock →
  frontend signal version → refetch. Retained-sample staleness is a separate
  client timer (collection time plus stale threshold).
