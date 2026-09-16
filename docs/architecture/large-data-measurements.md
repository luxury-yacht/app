# Large Data Measurements

Use when measuring scale, comparing payload costs, or reconsidering a recorded
optimization decision. These dated measurements are evidence for their stated
fixtures and environments, not current system-wide performance guarantees.
Shared contracts live in [large data](large-data.md).

## Current Browse Budget

Measured on 2026-05-31 with Apple M2 Max using the synthetic catalog benchmark:

- 100k first page: 4.32 ms, 160 KB allocated.
- 100k cursor page: 7.07 ms, 151 KB allocated.
- 100k per-cluster catalog index residency: 26.75 MB.
- 250k first page: 11.45 ms, 161 KB allocated.
- 250k cursor page: 17.67 ms, 151 KB allocated.
- 250k per-cluster catalog index residency: 66.80 MB.
- 3 x 100k multi-cluster catalog index residency: 80.19 MB aggregate.

Anchored jump (measured 2026-07-06 on Apple M2 Max, engine microbenchmark
`BenchmarkStoreQueryAround`, limit 50 — one counted O(rank + limit) walk per
user-initiated jump, a one-shot action, not a per-page cost):

- 100k anchor at rank N/2: 3.24 ms; at rank N-1 (worst case): 6.92 ms.
- 250k anchor at rank N/2: 14.35 ms; at rank N-1 (worst case): 33.16 ms.

The deep-anchor worst case exceeds the per-page serve budget above (b-tree
iteration costs more per entry than the flat match-value scan); that is
accepted for a one-shot jump. Order-statistics indexes stay not-built; revisit
only on a measured UX regression.

Per-Build page turns (measured 2026-07-06 on Apple M2 Max,
`BenchmarkPerBuildPageTurn`, 100k rows): uncached rebuild 618.9 ms per page
turn; single-slot store cache hit 0.024 ms; churn (version bump per request,
always a miss) 627.6 ms — identical to uncached, so the cache's win is
quiet-domain-only by design (the key is the domain's refetch identity: source
version watermark + metric revision + matched-set inputs).

## Resource-Row Efficiency Measurements

Measured 2026-07-21 on Apple M2 Max / arm64. The producer benchmark is
`BenchmarkRepresentativeResourceRowWireEncode` in
`backend/refresh/snapshot/resource_row_wire_benchmark_test.go`; each value below
is a 1,000-row JSON array. The before shape is commit `eb5edf70`, immediately
before the ref-only migration.

| Family | Before | Ref-only | Reduction |
| --- | ---: | ---: | ---: |
| Config | 372,001 B | 244,001 B | 34.4% |
| Events | 787,894 B | 656,894 B | 16.6% |
| Pods | 598,001 B | 492,001 B | 17.7% |
| Workloads | 605,001 B | 472,001 B | 22.0% |
| Nodes | 703,001 B | 608,001 B | 13.5% |
| Custom resources | 642,001 B | 462,001 B | 28.0% |

The frontend benchmark
`frontend/src/core/refresh/canonicalResourceRowWire.bench.ts` scales the
producer-marshaled fixture to 1,000 rows. Its measured means were 0.492 ms for
JSON parse plus envelope validation, 1.019 ms for parse/validation plus static
whole-row sharing, and 1.433 ms for parse/validation plus dynamic ref-only
sharing. The isolated sharing benchmark measured 0.579 ms for static whole-row
comparison and 0.375 ms for dynamic ref-only comparison.

A five-run, alternating-order V8 retained-heap comparison loaded 100,000 Config
rows shaped exactly like `eb5edf70` and the ref-only row into the same rendered
app process, forcing collection between phases. The old shape retained 29.21 MB
p50 / 29.40 MB p95; ref-only retained 18.74 MB p50 / 18.98 MB p95, reductions of
35.8% and 35.5%. The corresponding JSON strings were 36,466,671 B and
23,527,781 B. This isolates row storage; it is not an estimate of total app
heap.

On a real two-cluster Browse surface, a 250-row input retained 40.08 MB total JS
heap after forced collection, with 22 virtualized DOM rows. GridTable diagnostics
recorded two applies, zero ref changes, and 7.47 ms average React render time.
The static 11-row Config surface likewise recorded zero ref changes across two
applies and 5.28 ms average render time. The metric-bearing 19-row Nodes surface
recorded 16 ref changes across 18 applies and 23.84 ms average render time; this
is why dynamic families use ref-only sharing.

The native macOS Wails WebKit capture sent `Accept-Encoding: gzip, deflate` on
all 170 observed loopback snapshot requests. The server returned no
`Content-Encoding`; 100 requests carried `200` bodies, 64 were `204`, and 6
were `304`. A representative 250-item Browse response was 99,981-99,982 B;
ten loopback fetch/parse samples measured 8.2 ms p50 / 15.8 ms p95 total, of
which JSON parsing was 0.2 ms p50 / 0.3 ms p95. A stable Config validator
returned an empty `304` in 1.2 ms p50 / 3.9 ms p95.

Custom metadata projection was measured on 2026-08-25 with the canonical wire
fixture. Adding one small label to each of its 16 metadata-capable synthetic
rows increased the compact document from 20,527 B to 21,247 B: 720 B total, or
45 B per metadata-bearing row. At the 250-row page limit, the same shape adds
about 11.25 KB to the measured Browse baseline. This is a small-value fixture,
not a maximum: label and annotation values remain variable-size Kubernetes
metadata, and the app adds no byte cap below the upstream object limit. The
ingest boundary strips managed fields and
`kubectl.kubernetes.io/last-applied-configuration` before projection so the
known full-object annotation is never retained or serialized by this path.

Best-speed gzip remains rejected. At 1,000 rows it reduced Events to 48,921 B,
Pods to 16,333 B, and custom resources to 16,396 B, but increased encode time
from roughly 0.68-0.86 ms to 1.42-2.02 ms and allocations from roughly
0.50-0.68 MB to 1.77-2.39 MB. No response compression middleware or page
dictionary is present; the measured ref-only payload meets the current target
without their CPU, allocation, protocol, or version-skew costs.
