# Large Data Measurements

Dated evidence for the stated fixture (Apple M2 Max / arm64 unless noted), not a
system-wide guarantee. Use when measuring scale or reconsidering a recorded
decision. Shared contracts live in [large data](large-data.md).

## Current Browse Budget

Synthetic catalog benchmark, 2026-05-31:

| Rows | First page | Cursor page | Per-cluster index residency |
| ---: | ---: | ---: | ---: |
| 100k | 4.32 ms, 160 KB | 7.07 ms, 151 KB | 26.75 MB |
| 250k | 11.45 ms, 161 KB | 17.67 ms, 151 KB | 66.80 MB |

Three 100k clusters: 80.19 MB aggregate index residency.

- Anchored jump (`BenchmarkStoreQueryAround`, limit 50, 2026-07-06): one counted
  O(rank + limit) walk per user-initiated jump. 100k: 3.24 ms at rank N/2,
  6.92 ms at N-1; 250k: 14.35 ms / 33.16 ms. The deep worst case exceeds the
  page-serve budget (b-tree iteration costs more per entry than the flat scan);
  accepted for a one-shot jump. Order-statistics indexes stay unbuilt until a
  measured UX regression.
- Per-Build page turn (`BenchmarkPerBuildPageTurn`, 100k, 2026-07-06): uncached
  618.9 ms; single-slot store cache hit 0.024 ms; churn (version bump per
  request) 627.6 ms. The cache helps quiet domains only, by design; its key is
  the domain's refetch identity (source version watermark + metric revision +
  matched-set inputs).

## Resource-Row Efficiency Measurements

Ref-only rows (one complete `ref`, no flat identity copies) versus the prior
shape (commit `eb5edf70`), 2026-07-21. Producer benchmark
`BenchmarkRepresentativeResourceRowWireEncode`
(`backend/refresh/snapshot/resource_row_wire_benchmark_test.go`), 1,000-row
JSON array:

| Family | Before | Ref-only | Reduction |
| --- | ---: | ---: | ---: |
| Config | 372,001 B | 244,001 B | 34.4% |
| Events | 787,894 B | 656,894 B | 16.6% |
| Pods | 598,001 B | 492,001 B | 17.7% |
| Workloads | 605,001 B | 472,001 B | 22.0% |
| Nodes | 703,001 B | 608,001 B | 13.5% |
| Custom resources | 642,001 B | 462,001 B | 28.0% |

- Frontend (`canonicalResourceRowWire.bench.ts`, 1,000 rows): static (catalog)
  parse and validation 0.492 ms, plus whole-row sharing 1.019 ms; dynamic
  (Nodes) parse, validation, and ref-only sharing 1.433 ms. The fixtures
  differ; on identical rows (`structuralShareResourceRows.bench.ts`) whole-row
  comparison costs 0.579 ms and ref-only 0.375 ms. Retained heap for 100,000
  Config rows: 29.21 → 18.74 MB p50 (row storage only, not total app heap).
- Rendered surfaces: static Browse (250 rows) and Config (11 rows) recorded
  zero ref changes across two applies (7.47 / 5.28 ms average render);
  metric-bearing Nodes (19 rows) recorded 16 ref changes across 18 applies
  (23.84 ms). This is why dynamic families use ref-only sharing.
- Native macOS WebKit loopback: WebKit sends `Accept-Encoding: gzip, deflate`
  and the server returns no `Content-Encoding`; a ~100 KB 250-item Browse page
  fetches and parses in 8.2 ms p50 (JSON parse 0.2 ms); a stable Config `304`
  takes 1.2 ms p50.
- Custom metadata (2026-08-25): one small label adds ~45 B per metadata-bearing
  row, ~11.25 KB per 250-row page. A small-value fixture, not a maximum.
- Rejected: best-speed gzip, response compression middleware, and page
  dictionaries. At 1,000 rows gzip shrank Events to 48,921 B, Pods to 16,333 B,
  and custom resources to 16,396 B, but raised encode time from 0.68–0.86 ms to
  1.42–2.02 ms and allocations from 0.50–0.68 MB to 1.77–2.39 MB; ref-only
  payloads meet the target without CPU, allocation, protocol, or version-skew
  costs.

## Catalog full resync

Local Kind, 2026-09-22: production ingest and catalog with real clients, 10,000
extra Widget CRs, default catalog options. A CRD short-name change triggered a
warm full resync publishing 10,336 objects across 64 resource types in 155 ms
(385 ms update-to-publication), with 29 non-CRD LISTs, 64 permission reviews,
two discovery requests, and no custom-resource LIST. This supports the shared
full-resync contract for this fixture only; remote clusters and aggregated
extension APIs were absent. Re-measure them before justifying partial
recollection.
